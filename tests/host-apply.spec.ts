/** Host apply: the health route is registered and answers loopback probes. */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { apply, ROUTES } from '../src/index.ts'

describe('host apply', () => {
  it('registers the health route', async () => {
    const routes: Array<{ path: string; handler: (req: IncomingMessage, res: ServerResponse) => void }> = []
    const ctx = {
      webServer: { register: vi.fn((route: (typeof routes)[number]) => { routes.push(route); return () => {} }) },
      effect: vi.fn((fn: () => unknown) => { fn() }),
    } as never
    apply(ctx)
    expect(routes.map(route => route.path)).toEqual([ROUTES.health])

    const state = { status: 0, body: '' }
    const res = {
      writeHead(status: number) { state.status = status },
      end(body: string) { state.body = body },
    } as unknown as ServerResponse
    routes[0].handler({ method: 'GET' } as IncomingMessage, res)
    expect(state.status).toBe(200)
    expect(JSON.parse(state.body)).toEqual({ ok: true, plugin: 'drawio-inline' })
  })
})
