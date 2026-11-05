/**
 * Host tools: create/read/apply/undo operate on one native `.drawio` file,
 * with workspace path policy, revisions and atomic writes.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { apply, ROUTES, TOOL_NAMES } from '../src/index.ts'

interface RegisteredTool {
  name: string
  execute: (args: Record<string, unknown>, exec: Record<string, unknown>) => Promise<unknown>
}

/** Fake host context capturing routes, tools and the working directory face. */
function fakeHost(tmp: string): { ctx: never; routes: Array<{ path: string; handler: (req: IncomingMessage, res: ServerResponse) => void }>; tools: RegisteredTool[] } {
  const routes: Array<{ path: string; handler: (req: IncomingMessage, res: ServerResponse) => void }> = []
  const tools: RegisteredTool[] = []
  const ctx = {
    webServer: { register: vi.fn((route: (typeof routes)[number]) => { routes.push(route); return () => {} }) },
    tools: { register: vi.fn((definition: RegisteredTool) => { tools.push(definition); return () => {} }) },
    get: vi.fn((name: string) => name === 'workingDirectory' ? { ensure: async () => tmp } : undefined),
    effect: vi.fn((fn: () => unknown) => { fn() }),
  } as never
  return { ctx, routes, tools }
}

const NODE_XML = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="n1" value="Login" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="1"><mxGeometry x="40" y="40" width="120" height="60" as="geometry"/></mxCell></root></mxGraphModel>'

/** Find one registered tool. */
function tool(host: ReturnType<typeof fakeHost>, name: string): RegisteredTool {
  const found = host.tools.find(candidate => candidate.name === name)
  if (found === undefined) throw new Error(`missing tool ${name}`)
  return found
}

describe('host apply', () => {
  it('registers the health route and all tools', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'drawio-chat-'))
    try {
      const host = fakeHost(tmp)
      apply(host.ctx)
      expect(host.routes.map(route => route.path)).toEqual([ROUTES.health])
      expect(host.tools.map(registered => registered.name)).toEqual([
        TOOL_NAMES.create,
        TOOL_NAMES.read,
        TOOL_NAMES.apply,
        TOOL_NAMES.undo,
        TOOL_NAMES.reference,
      ])
      const state = { status: 0, body: '' }
      const res = { writeHead(status: number) { state.status = status }, end(body: string) { state.body = body } } as unknown as ServerResponse
      host.routes[0].handler({ method: 'GET' } as IncomingMessage, res)
      expect(state.status).toBe(200)
      expect(JSON.parse(state.body)).toMatchObject({ ok: true, plugin: 'drawio-chat' })
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('creates a diagram and reports path + revision; invalid XML is rejected', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'drawio-chat-'))
    try {
      const host = fakeHost(tmp)
      apply(host.ctx)
      const created = await tool(host, TOOL_NAMES.create).execute({ title: 'Login flow', xml: NODE_XML }, { agent: {}, signal: undefined }) as { path: string; revision: string; bytes: number }
      expect(created.bytes).toBeGreaterThan(0)
      expect(created.revision).toMatch(/^[0-9a-f]{40}$/u)
      expect(created.path).toContain(join(tmp, 'diagrams'))
      expect(readFileSync(created.path, 'utf8')).toBe(NODE_XML)
      await expect(tool(host, TOOL_NAMES.create).execute({ xml: '<svg/>' }, {})).rejects.toThrow(/mxGraphModel/u)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('reads structure by id and keeps the revision stable', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'drawio-chat-'))
    try {
      const host = fakeHost(tmp)
      apply(host.ctx)
      const created = await tool(host, TOOL_NAMES.create).execute({ title: 'Login flow', xml: NODE_XML }, { agent: {} }) as { path: string }
      const read = await tool(host, TOOL_NAMES.read).execute({}, { agent: {} }) as { path: string; revision: string; nodeCount: number; pages: Array<{ nodes: Array<{ id: string; label: string }> }> }
      expect(read.path).toBe(created.path)
      expect(read.nodeCount).toBe(1)
      expect(read.pages[0].nodes[0]).toMatchObject({ id: 'n1', label: 'Login' })
      const again = await tool(host, TOOL_NAMES.read).execute({ path: created.path }, { agent: {} }) as { revision: string }
      expect(again.revision).toBe(read.revision)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('applies ops atomically, bumps the revision and rejects stale expectRevision', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'drawio-chat-'))
    try {
      const host = fakeHost(tmp)
      apply(host.ctx)
      const created = await tool(host, TOOL_NAMES.create).execute({ title: 'Login flow', xml: NODE_XML }, { agent: {} }) as { path: string }
      const read = await tool(host, TOOL_NAMES.read).execute({ path: created.path }, { agent: {} }) as { revision: string }
      const applied = await tool(host, TOOL_NAMES.apply).execute({
        path: created.path,
        expectRevision: read.revision,
        ops: [
          { op: 'setLabel', ids: ['n1'], label: '登录' },
          { op: 'addNode', id: 'n2', label: 'Home', x: 260, y: 40 },
          { op: 'addEdge', source: 'n1', target: 'n2', label: 'ok' },
        ],
      }, { agent: {} }) as { revision: string; changed: string[]; nodeCount: number; edgeCount: number }
      expect(applied.changed.length).toBe(3)
      expect(applied.revision).not.toBe(read.revision)
      expect(applied.nodeCount).toBe(2)
      expect(applied.edgeCount).toBe(1)
      expect(readFileSync(created.path, 'utf8')).toContain('登录')
      await expect(tool(host, TOOL_NAMES.apply).execute({ path: created.path, expectRevision: read.revision, ops: [{ op: 'remove', ids: ['n1'] }] }, { agent: {} })).rejects.toThrow(/revision conflict/u)
      // The failed batch must not have touched the file.
      expect(readFileSync(created.path, 'utf8')).toContain('登录')
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('undoes the last apply and refuses to undo when there is no snapshot', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'drawio-chat-'))
    try {
      const host = fakeHost(tmp)
      apply(host.ctx)
      const created = await tool(host, TOOL_NAMES.create).execute({ title: 'Login flow', xml: NODE_XML }, { agent: {} }) as { path: string }
      const before = readFileSync(created.path, 'utf8')
      await tool(host, TOOL_NAMES.apply).execute({ path: created.path, ops: [{ op: 'setLabel', ids: ['n1'], label: '登录' }] }, { agent: {} })
      expect(readFileSync(created.path, 'utf8')).toContain('登录')
      const undone = await tool(host, TOOL_NAMES.undo).execute({}, { agent: {} }) as { restored: boolean }
      expect(undone.restored).toBe(true)
      expect(readFileSync(created.path, 'utf8')).toBe(before)
      await expect(tool(host, TOOL_NAMES.undo).execute({}, { agent: {} })).rejects.toThrow(/no recorded version/u)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('refuses paths outside the workspace', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'drawio-chat-'))
    try {
      const host = fakeHost(tmp)
      apply(host.ctx)
      await expect(tool(host, TOOL_NAMES.read).execute({ path: '../escape.drawio' }, { agent: {} })).rejects.toThrow(/inside the session workspace/u)
      await expect(tool(host, TOOL_NAMES.read).execute({ path: '/etc/passwd' }, { agent: {} })).rejects.toThrow(/\.drawio/u)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})
