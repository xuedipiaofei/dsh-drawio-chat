/**
 * Host apply: the health route and both model tools are registered, and the
 * diagram tool validates/writes the XML through the working-directory face.
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

const XML = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>'

describe('host apply', () => {
  it('registers the health route and both tools', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'drawio-chat-'))
    try {
      const host = fakeHost(tmp)
      apply(host.ctx)
      expect(host.routes.map(route => route.path)).toEqual([ROUTES.health])
      expect(host.tools.map(tool => tool.name)).toEqual([TOOL_NAMES.diagram, TOOL_NAMES.reference])

      const state = { status: 0, body: '' }
      const res = { writeHead(status: number) { state.status = status }, end(body: string) { state.body = body } } as unknown as ServerResponse
      host.routes[0].handler({ method: 'GET' } as IncomingMessage, res)
      expect(state.status).toBe(200)
      expect(JSON.parse(state.body)).toMatchObject({ ok: true, plugin: 'drawio-chat' })
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('writes the diagram into the workspace and reports its path', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'drawio-chat-'))
    try {
      const host = fakeHost(tmp)
      apply(host.ctx)
      const tool = host.tools.find(candidate => candidate.name === TOOL_NAMES.diagram)!
      const result = await tool.execute({ title: 'Login flow', xml: XML }, { agent: {}, signal: undefined }) as { title: string; path: string; bytes: number }
      expect(result.title).toBe('Login flow')
      expect(result.bytes).toBeGreaterThan(0)
      expect(result.path).toContain(join(tmp, 'diagrams'))
      expect(existsSync(result.path)).toBe(true)
      expect(readFileSync(result.path, 'utf8')).toBe(XML)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('rejects non-drawio XML', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'drawio-chat-'))
    try {
      const host = fakeHost(tmp)
      apply(host.ctx)
      const tool = host.tools.find(candidate => candidate.name === TOOL_NAMES.diagram)!
      await expect(tool.execute({ xml: '<svg/>' }, {})).rejects.toThrow(/mxGraphModel/u)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})
