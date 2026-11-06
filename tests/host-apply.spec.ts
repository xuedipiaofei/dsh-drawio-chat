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

/** The subset of JSON Schema the host tools declare for their output. */
interface ToolOutputSchema {
  type?: string
  properties?: Record<string, ToolOutputSchema>
  required?: string[]
  additionalProperties?: boolean
}

interface RegisteredTool {
  name: string
  execute: (args: Record<string, unknown>, exec: Record<string, unknown>) => Promise<unknown>
  output?: { schema?: ToolOutputSchema }
}

/** Fake host context capturing routes, tools and the working directory face. */
function fakeHost(tmp: string): { ctx: never; routes: Array<{ path: string; handler: (req: IncomingMessage, res: ServerResponse) => void }>; tools: RegisteredTool[] } {
  const routes: Array<{ path: string; handler: (req: IncomingMessage, res: ServerResponse) => void }> = []
  const tools: RegisteredTool[] = []
  const ctx = {
    webServer: { register: vi.fn((route: (typeof routes)[number]) => { routes.push(route); return () => {} }) },
    tools: { register: vi.fn((definition: RegisteredTool) => { tools.push(definition); return () => {} }) },
    get: vi.fn((name: string) => {
      if (name === 'workingDirectory') return { ensure: async () => tmp }
      if (name === 'sessions') return { get: (id: string) => id === 'sess-1' ? { header: { cwd: tmp } } : undefined }
      return undefined
    }),
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
      expect(host.routes.map(route => route.path)).toEqual([ROUTES.health, ROUTES.diagram, ROUTES.open])
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

  it('serves allowlisted diagram files through the loopback preview route only', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'drawio-chat-'))
    try {
      const host = fakeHost(tmp)
      apply(host.ctx)
      const created = await tool(host, TOOL_NAMES.create).execute({ title: 'Login flow', xml: NODE_XML }, { agent: {} }) as { path: string }
      const route = host.routes.find(candidate => candidate.path === ROUTES.diagram)!
      const request = (url: string, method = 'GET', remote = '127.0.0.1') => {
        const state = { status: 0, body: '', headers: {} as Record<string, string> }
        const res = {
          writeHead(status: number, headers?: Record<string, string>) { state.status = status; if (headers !== undefined) state.headers = headers },
          end(body: string) { state.body = body },
        } as unknown as ServerResponse
        route.handler({ method, url, socket: { remoteAddress: remote } } as unknown as IncomingMessage, res)
        return state
      }
      const ok = request(`/api/dsh-drawio-chat/diagram?path=${encodeURIComponent(created.path)}`)
      expect(ok.status).toBe(200)
      expect(ok.body).toBe(NODE_XML)
      expect(request(`/api/dsh-drawio-chat/diagram?path=${encodeURIComponent('/etc/passwd')}`).status).toBe(403)
      expect(request(`/api/dsh-drawio-chat/diagram?path=${encodeURIComponent(created.path)}`, 'POST').status).toBe(405)
      expect(request(`/api/dsh-drawio-chat/diagram?path=${encodeURIComponent(created.path)}`, 'GET', '10.0.0.9').status).toBe(403)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('serves a session-relative file for the sidebar tab', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'drawio-chat-'))
    try {
      const host = fakeHost(tmp)
      apply(host.ctx)
      const created = await tool(host, TOOL_NAMES.create).execute({ title: 'Login flow', xml: NODE_XML }, { agent: {} }) as { path: string }
      const relative = created.path.slice(tmp.length + 1)
      const route = host.routes.find(candidate => candidate.path === ROUTES.open)!
      const request = (url: string, remote = '127.0.0.1') => {
        const state = { status: 0, body: '' }
        const res = {
          writeHead(status: number) { state.status = status },
          end(body: string) { state.body = body },
        } as unknown as ServerResponse
        route.handler({ method: 'GET', url, socket: { remoteAddress: remote } } as unknown as IncomingMessage, res)
        return state
      }
      const ok = request(`/api/dsh-drawio-chat/open?session=sess-1&path=${encodeURIComponent(relative)}`)
      expect(ok.status).toBe(200)
      expect(ok.body).toBe(NODE_XML)
      expect(request(`/api/dsh-drawio-chat/open?session=missing&path=${encodeURIComponent(relative)}`).status).toBe(404)
      expect(request(`/api/dsh-drawio-chat/open?session=sess-1&path=${encodeURIComponent('../escape.drawio')}`).status).toBe(404)
      expect(request(`/api/dsh-drawio-chat/open?session=sess-1&path=${encodeURIComponent(relative)}`, '10.0.0.9').status).toBe(403)
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

  it('keeps every tool result inside its declared output schema', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'drawio-chat-'))
    try {
      const host = fakeHost(tmp)
      apply(host.ctx)
      const created = await tool(host, TOOL_NAMES.create).execute({ title: 'Login flow', xml: NODE_XML }, { agent: {} }) as Record<string, unknown>
      const read = await tool(host, TOOL_NAMES.read).execute({ path: created.path as string }, { agent: {} }) as Record<string, unknown>
      const applied = await tool(host, TOOL_NAMES.apply).execute({ path: created.path, ops: [{ op: 'addNode', id: 'n2', label: 'Home', x: 200, y: 40 }] }, { agent: {} }) as Record<string, unknown>
      const undone = await tool(host, TOOL_NAMES.undo).execute({ path: created.path }, { agent: {} }) as Record<string, unknown>
      const results: Array<[string, Record<string, unknown>]> = [
        [TOOL_NAMES.create, created],
        [TOOL_NAMES.read, read],
        [TOOL_NAMES.apply, applied],
        [TOOL_NAMES.undo, undone],
      ]
      for (const [name, value] of results) {
        const schema = tool(host, name).output?.schema
        expect(schema, `${name} declares an output schema`).toBeDefined()
        const properties = schema?.properties ?? {}
        // The GUI rejects a tool result that carries an undeclared property.
        if (schema?.additionalProperties === false) {
          for (const key of Object.keys(value)) expect(properties, `${name}.${key} is undeclared`).toHaveProperty(key)
        }
        for (const key of schema?.required ?? []) expect(value, `${name}.${key} is required`).toHaveProperty(key)
        for (const [key, spec] of Object.entries(properties)) {
          if (!(key in value)) continue
          const actual = value[key]
          if (spec.type === 'string') expect(typeof actual, `${name}.${key} is a string`).toBe('string')
          else if (spec.type === 'integer') expect(Number.isInteger(actual), `${name}.${key} is an integer`).toBe(true)
          else if (spec.type === 'boolean') expect(typeof actual, `${name}.${key} is a boolean`).toBe('boolean')
          else if (spec.type === 'array') expect(Array.isArray(actual), `${name}.${key} is an array`).toBe(true)
        }
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})
