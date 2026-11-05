/**
 * Host half of the draw.io inline plugin (skeleton).
 *
 * The plugin will register a `drawio_diagram` tool that writes a `.drawio`
 * file into the workspace and a trust-fenced vendor route that serves the
 * locally bundled draw.io viewer assets. This first commit only establishes the
 * bundle contract (row insertion + a health route) so the plugin can be
 * installed and verified before the tool/view work lands.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'

/** Stable cordis plugin name (matches the package name). */
export const name = 'drawio-inline'

/** Host services this plugin needs before it can apply. */
export const inject = ['webServer']

/** Route family served by this plugin. */
export const ROUTES = {
  health: '/api/dsh-drawio-inline/health',
} as const

/**
 * Register the plugin's host surfaces.
 * @param ctx - host context with the web server service.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ROUTES.health,
    handler: (req: IncomingMessage, res: ServerResponse) => {
      if (req.method !== 'GET') {
        res.writeHead(405, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'method not allowed' }))
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true, plugin: name }))
    },
  }), 'drawio-inline: routes')
}
