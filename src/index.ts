/**
 * Host half of the draw.io inline plugin.
 *
 * Registers two model-facing tools:
 * - `drawio_diagram`: takes draw.io XML plus an optional title, validates it,
 *   writes `<session-cwd>/diagrams/<slug>.drawio`, and returns a compact
 *   result with a presentation path. The browser half renders it inline.
 * - `drawio_reference`: fetches draw.io's own generation reference from the
 *   public MCP endpoint (`https://mcp.draw.io/mcp`, no auth) over Streamable
 *   HTTP, with a condensed local fallback. Only the reference is fetched — the
 *   diagram itself never leaves the machine.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'

/** Stable cordis plugin name (matches the package name). */
export const name = 'drawio-inline'

/** Host services this plugin needs before it can apply. */
export const inject = ['webServer', 'tools']

/** Route family served by this plugin. */
export const ROUTES = {
  health: '/api/dsh-drawio-inline/health',
} as const

/** Tool names shared with the browser half's tool views. */
export const TOOL_NAMES = {
  diagram: 'drawio_diagram',
  reference: 'drawio_reference',
} as const

/** Public draw.io MCP endpoint (model tools, no authentication). */
const MCP_URL = 'https://mcp.draw.io/mcp'

/** Diagram XML caps: large enough for real diagrams, small enough to store. */
const MAX_XML_BYTES = 512 * 1024

/** Condensed fallback when the public MCP reference cannot be reached. */
const FALLBACK_REFERENCE = `# draw.io XML reference (condensed)

Write one mxGraphModel wrapped in <mxfile> is optional; the tool accepts a bare
<mxGraphModel ...><root>...</root></mxGraphModel>.

- Every cell needs a unique id. \`<mxCell id="0"/>\` and \`<mxCell id="1" parent="0"/>\` are the roots.
- Vertices: \`<mxCell id="2" value="Login" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="1"><mxGeometry x="80" y="80" width="120" height="60" as="geometry"/></mxCell>\`
- Edges: \`<mxCell id="3" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;" edge="1" parent="1" source="2" target="4"><mxGeometry relative="1" as="geometry"/></mxCell>\`
- Decisions: style \`rhombus;whiteSpace=wrap;html=1;\`; terminals: \`ellipse;whiteSpace=wrap;html=1;\`.
- Colors: \`fillColor=#dae8fc;strokeColor=#6c8ebf;\` (blue), \`#d5e8d4/#82b366\` (green), \`#fff2cc/#d6b656\` (yellow), \`#f8cecc/#b85450\` (red).
- Never emit XML comments, DOCTYPE, or unescaped \`& < > " '\` inside attribute values.
- Space nodes on a 10px grid; keep flow left-to-right or top-to-bottom; label every decision branch.
`

/** One tool definition, structurally compatible with `ctx.tools.register`. */
type ToolDefinition = Record<string, unknown>

/** Structural view of the host services we call (no SDK type dependency). */
interface HostFaces {
  get?: (name: string) => unknown
  workingDirectory?: unknown
}

/** Working-directory face used to resolve the session cwd. */
interface WorkingDirectoryFace {
  ensure: (agent: unknown, signal: unknown) => Promise<string>
}

/** Get the optional host services without hard-depending on their packages. */
function hostFaces(ctx: Context): HostFaces {
  return ctx as unknown as HostFaces
}

/** Resolve the workspace directory a tool run belongs to. */
async function resolveCwd(ctx: Context, exec: { agent?: unknown; signal?: unknown }): Promise<string> {
  const faces = hostFaces(ctx)
  const candidate = (typeof faces.get === 'function' ? faces.get('workingDirectory') : undefined) ?? faces.workingDirectory
  const wd = candidate as WorkingDirectoryFace | undefined
  if (wd !== undefined && typeof wd.ensure === 'function' && exec.agent !== undefined) {
    try {
      return await wd.ensure(exec.agent, exec.signal)
    } catch {
      // Fall through to the process cwd; the tool still renders the diagram.
    }
  }
  return process.cwd()
}

/** kebab-ish file slug for a diagram title. */
function slug(title: string): string {
  const ascii = title.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '')
  return ascii === '' ? 'diagram' : ascii.slice(0, 60)
}

/** Basic structural validation for draw.io XML. */
function validateXml(xml: string): void {
  if (Buffer.byteLength(xml, 'utf8') > MAX_XML_BYTES) throw new Error(`diagram XML exceeds ${MAX_XML_BYTES} bytes`)
  const trimmed = xml.trim()
  if (!trimmed.startsWith('<mxGraphModel') && !trimmed.startsWith('<mxfile')) {
    throw new Error('diagram XML must start with <mxGraphModel> or <mxfile>')
  }
  if (/<!doctype|<!entity/iu.test(trimmed)) throw new Error('document type declarations are not allowed')
  if (!trimmed.endsWith('>')) throw new Error('diagram XML is not well-formed (missing closing tag)')
}

/** Write the diagram file into the session workspace; returns the path when it worked. */
async function writeDiagram(ctx: Context, exec: { agent?: unknown; signal?: unknown }, title: string, xml: string): Promise<{ path?: string; bytes: number; warning?: string }> {
  const bytes = Buffer.byteLength(xml, 'utf8')
  try {
    const cwd = await resolveCwd(ctx, exec)
    const dir = join(cwd, 'diagrams')
    mkdirSync(dir, { recursive: true })
    const digest = createHash('sha1').update(xml).digest('hex').slice(0, 8)
    const file = join(dir, `${slug(title)}-${digest}.drawio`)
    writeFileSync(file, xml, 'utf8')
    return { path: file, bytes }
  } catch (error) {
    return { bytes, warning: error instanceof Error ? error.message : String(error) }
  }
}

/** One successful MCP JSON-RPC response. */
interface McpResponse {
  result?: unknown
  error?: { message?: string }
}

/** POST one JSON-RPC message to the public draw.io MCP endpoint. */
async function mcpPost(body: Record<string, unknown>, sessionId?: string): Promise<{ sessionId?: string; payload?: McpResponse }> {
  const response = await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-06-18',
      ...(sessionId === undefined ? {} : { 'mcp-session-id': sessionId }),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  })
  const text = await response.text()
  let payload: McpResponse | undefined
  try {
    payload = JSON.parse(text) as McpResponse
  } catch {
    const data = text.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5)).join('')
    try {
      payload = JSON.parse(data) as McpResponse
    } catch {
      payload = undefined
    }
  }
  return { sessionId: response.headers.get('mcp-session-id') ?? sessionId, payload }
}

/** Cached reference so repeated calls cost one MCP round-trip per process. */
let referenceCache: Promise<string> | undefined

/** Load draw.io's XML generation reference from the public MCP server. */
async function loadReference(): Promise<string> {
  const initialize = await mcpPost({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'dsh-drawio-inline', version: '0.1.0' } },
  })
  const sessionId = initialize.sessionId
  if (sessionId === undefined) throw new Error('the MCP server did not open a session')
  await mcpPost({ jsonrpc: '2.0', method: 'notifications/initialized' }, sessionId)
  const call = await mcpPost({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: { name: 'get_drawio_reference', arguments: { format: 'xml' } },
  }, sessionId)
  const result = call.payload?.result as { content?: Array<{ type?: string; text?: string }> } | undefined
  const text = result?.content?.find(block => block.type === 'text')?.text
  if (typeof text !== 'string' || text.trim() === '') throw new Error('empty MCP reference response')
  return text
}

/**
 * Register the plugin's host surfaces.
 * @param ctx - host context with the web server and tool registry services.
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

  const tools = (ctx as unknown as { tools: { register(definition: ToolDefinition): unknown } }).tools

  tools.register({
    name: TOOL_NAMES.diagram,
    description: 'Create a draw.io diagram from XML. The diagram is rendered inline in the chat. Call drawio_reference first if you need the exact mxGraphModel syntax; keep node labels short and use a 10px grid.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        xml: { type: 'string', description: 'draw.io mxGraphModel or mxfile XML.' },
        title: { type: 'string', description: 'Optional diagram title used for the file name and card header.' },
      },
      required: ['xml'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          bytes: { type: 'integer' },
          path: { type: 'string' },
          warning: { type: 'string' },
        },
        required: ['title', 'bytes'],
      },
      render: (_args: unknown, value: { title: string; bytes: number; path?: string; warning?: string }) => [{
        type: 'text',
        text: value.path === undefined
          ? `Rendered "${value.title}" (${value.bytes} bytes); it was not saved to the workspace${value.warning === undefined ? '' : `: ${value.warning}`}.`
          : `Rendered "${value.title}" (${value.bytes} bytes) and saved it to ${value.path}.`,
      }],
      presentationMeta: (_args: unknown, value: { title: string; path?: string }) => ({ title: value.title, ...(value.path === undefined ? {} : { path: value.path }) }),
    },
    execute: async (args: { xml?: unknown; title?: unknown }, exec: { agent?: unknown; signal?: unknown }) => {
      const xml = typeof args.xml === 'string' ? args.xml.trim() : ''
      if (xml === '') throw new Error('xml is required')
      validateXml(xml)
      const title = typeof args.title === 'string' && args.title.trim() !== '' ? args.title.trim() : 'draw.io diagram'
      const written = await writeDiagram(ctx, exec, title, xml)
      return { title, bytes: written.bytes, ...(written.path === undefined ? {} : { path: written.path }), ...(written.warning === undefined ? {} : { warning: written.warning }) }
    },
  })

  tools.register({
    name: TOOL_NAMES.reference,
    description: 'Return draw.io XML generation reference (styles, shapes, layout grid, escaping rules). Call this before drawing a complex diagram. Returns markdown.',
    parameters: { type: 'object', additionalProperties: false, properties: { format: { type: 'string', enum: ['xml'], description: 'Reference format; only "xml" is supported.' } } },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { reference: { type: 'string' }, source: { type: 'string' } }, required: ['reference', 'source'] },
      render: (_args: unknown, value: { reference: string }) => [{ type: 'text', text: value.reference }],
    },
    execute: async () => {
      referenceCache ??= loadReference().catch(() => FALLBACK_REFERENCE)
      const reference = await referenceCache
      return { reference, source: reference === FALLBACK_REFERENCE ? 'built-in' : 'mcp.draw.io' }
    },
  })
}
