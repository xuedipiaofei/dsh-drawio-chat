/**
 * Host half of the draw.io chat plugin.
 *
 * Tools (all on the same native `.drawio` file):
 * - `drawio_create`    create a new bare `<mxGraphModel>` file in the workspace;
 * - `drawio_read`      return the diagram structure (ids, labels, geometry, edges,
 *                      revision) instead of raw XML;
 * - `drawio_apply`     change an existing file with semantic ops, atomically;
 * - `drawio_undo`      restore the previous version of a file this process wrote;
 * - `drawio_reference` fetch draw.io's XML reference from the public MCP endpoint
 *                      (no auth; only the reference travels, never the diagram).
 *
 * Paths are constrained to the session workspace and to `.drawio` files.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import {
  DiagramError,
  readDiagramSource,
  resolveDiagramPath,
  revisionOf,
  serializeDiagram,
  summarizeDiagram,
  type DiagramFile,
  type DiagramSummary,
} from './model/diagram.ts'
import { applyOps, type DiagramOp } from './model/ops.ts'
import { SnapshotStore } from './model/undo.ts'

/** Stable cordis plugin name (matches the package name). */
export const name = 'drawio-chat'

/** Host services this plugin needs before it can apply. */
export const inject = ['webServer', 'tools']

/** Route family served by this plugin. */
export const ROUTES = {
  health: '/api/dsh-drawio-chat/health',
  /** Same-origin preview feed for the chat cards (allowlisted files only). */
  diagram: '/api/dsh-drawio-chat/diagram',
} as const

/** Tool names shared with the browser half's tool views. */
export const TOOL_NAMES = {
  create: 'drawio_create',
  read: 'drawio_read',
  apply: 'drawio_apply',
  undo: 'drawio_undo',
  reference: 'drawio_reference',
} as const

/** Public draw.io MCP endpoint (model tools, no authentication). */
const MCP_URL = 'https://mcp.draw.io/mcp'

/** Guard rails for files this plugin reads or writes. */
const MAX_XML_BYTES = 2 * 1024 * 1024

/** The most recent diagram path per session workspace. */
const lastByCwd = new Map<string, string>()

/** Previous serialized content per absolute path for `drawio_undo`. */
const snapshots = new SnapshotStore(8)

/** Files this process created/read/applied — used by the upcoming preview route. */
const knownFiles = new Set<string>()

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

/** Basic structural validation for newly created XML. */
function validateXml(xml: string): void {
  if (Buffer.byteLength(xml, 'utf8') > MAX_XML_BYTES) throw new DiagramError(`diagram XML exceeds ${MAX_XML_BYTES} bytes`)
  const trimmed = xml.trim()
  if (!trimmed.startsWith('<mxGraphModel') && !trimmed.startsWith('<mxfile')) throw new DiagramError('diagram XML must start with <mxGraphModel> or <mxfile>')
  if (/<!doctype|<!entity/iu.test(trimmed)) throw new DiagramError('document type declarations are not allowed')
}

/** Write a file atomically (same-directory temp + rename). */
function atomicWrite(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`
  writeFileSync(temporary, content, 'utf8')
  renameSync(temporary, path)
}

/** Read one diagram file with size and existence checks. */
function readDiagramFile(path: string): string {
  if (!existsSync(path)) throw new DiagramError(`diagram not found: ${path}`)
  const content = readFileSync(path, 'utf8')
  if (Buffer.byteLength(content, 'utf8') > MAX_XML_BYTES) throw new DiagramError(`diagram file exceeds ${MAX_XML_BYTES} bytes`)
  return content
}

/** Resolve the target file from an explicit path or the session's latest file. */
async function targetPath(ctx: Context, exec: { agent?: unknown; signal?: unknown }, input: unknown): Promise<{ path: string; cwd: string }> {
  const cwd = await resolveCwd(ctx, exec)
  if (typeof input === 'string' && input.trim() !== '') return { path: resolveDiagramPath(input, cwd), cwd }
  const last = lastByCwd.get(cwd)
  if (last === undefined) throw new DiagramError('no diagram yet in this workspace: call drawio_create first or pass an explicit .drawio path')
  return { path: last, cwd }
}

/** Compact structure text for the model. */
function renderSummary(path: string, revision: string, summary: DiagramSummary): string {
  const lines = [`Diagram ${path} (revision ${revision.slice(0, 12)}, ${summary.pages.length} page(s))`]
  for (const page of summary.pages) {
    lines.push(`Page ${page.index}${page.name === undefined ? '' : ` "${page.name}"`}: ${page.nodes.length} node(s), ${page.edges.length} edge(s)`)
    for (const node of page.nodes) {
      const geometry = [node.x, node.y, node.width, node.height].every(value => value === undefined) ? '' : ` @${node.x ?? 0},${node.y ?? 0} ${node.width ?? 0}x${node.height ?? 0}`
      lines.push(`- node ${node.id} "${node.label}"${geometry}${node.style === undefined ? '' : ` style=${node.style}`}`)
    }
    for (const edge of page.edges) lines.push(`- edge ${edge.id} "${edge.label}" ${edge.source ?? '?'} -> ${edge.target ?? '?'}`)
  }
  if (summary.truncated) lines.push('(structure summary truncated; use ids from this list, or read a page by index)')
  return lines.join('\n')
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

/** Condensed fallback when the public MCP reference cannot be reached. */
const FALLBACK_REFERENCE = `# draw.io XML reference (condensed)

The tool accepts a bare <mxGraphModel><root>...</root></mxGraphModel>.

- Every cell needs a unique id. \`<mxCell id="0"/>\` and \`<mxCell id="1" parent="0"/>\` are the roots.
- Vertices: \`<mxCell id="2" value="Login" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="1"><mxGeometry x="80" y="80" width="120" height="60" as="geometry"/></mxCell>\`
- Edges: \`<mxCell id="3" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;" edge="1" parent="1" source="2" target="4"><mxGeometry relative="1" as="geometry"/></mxCell>\`
- Decisions: \`rhombus;whiteSpace=wrap;html=1;\`; terminals: \`ellipse;whiteSpace=wrap;html=1;\`.
- Colors: \`fillColor=#dae8fc;strokeColor=#6c8ebf\` (blue), \`#d5e8d4/#82b366\` (green), \`#fff2cc/#d6b656\` (yellow), \`#f8cecc/#b85450\` (red).
- No XML comments, no DOCTYPE, escape \`& < > " '\` inside attribute values.
`

/** Load draw.io's XML generation reference from the public MCP server. */
async function loadReference(): Promise<string> {
  const initialize = await mcpPost({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'dsh-drawio-chat', version: '0.2.0' } },
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

/** Output schema shared by the diagrams returned from create/read/apply/undo. */
const PATH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    path: { type: 'string' },
    revision: { type: 'string' },
    title: { type: 'string' },
  },
  required: ['path'],
} as const

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
  }), 'drawio-chat: health route')

  // The cards read back the file the tools touched through this same-origin
  // route. Access is limited to loopback callers (the local DSH web/GUI) and to
  // files this process created or opened, so it is not a general file endpoint.
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ROUTES.diagram,
    handler: (req: IncomingMessage, res: ServerResponse) => {
      const writeError = (status: number, message: string): void => {
        res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        res.end(JSON.stringify({ error: message }))
      }
      if (req.method !== 'GET') {
        writeError(405, 'method not allowed')
        return
      }
      const remote = req.socket.remoteAddress ?? ''
      if (!(remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1')) {
        writeError(403, 'preview route is loopback-only')
        return
      }
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const path = url.searchParams.get('path') ?? ''
      if (path === '' || !knownFiles.has(path) || !/\.drawio$/iu.test(path)) {
        writeError(403, 'file is not part of this session')
        return
      }
      try {
        const content = readDiagramFile(path)
        res.writeHead(200, { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'no-store' })
        res.end(content)
      } catch (error) {
        writeError(404, error instanceof Error ? error.message : 'diagram not found')
      }
    },
  }), 'drawio-chat: diagram route')

  const tools = (ctx as unknown as { tools: { register(definition: ToolDefinition): unknown } }).tools

  tools.register({
    name: TOOL_NAMES.create,
    description: 'Create a new draw.io diagram file from mxGraphModel XML and render it inline in the chat. Call drawio_reference first if you need the exact XML syntax; keep labels short, use a 10px grid, and put nodes at explicit coordinates. To change the diagram later, use drawio_read then drawio_apply instead of rewriting the whole XML.',
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
          revision: { type: 'string' },
          warning: { type: 'string' },
        },
        required: ['title', 'bytes'],
      },
      render: (_args: unknown, value: { title: string; bytes: number; path?: string; revision?: string; warning?: string }) => [{
        type: 'text',
        text: value.path === undefined
          ? `Rendered "${value.title}" (${value.bytes} bytes); it was not saved to the workspace${value.warning === undefined ? '' : `: ${value.warning}`}.`
          : `Created "${value.title}" at ${value.path}${value.revision === undefined ? '' : ` (revision ${value.revision.slice(0, 12)})`}. Use drawio_read / drawio_apply to edit it.`,
      }],
      presentationMeta: (_args: unknown, value: { title: string; path?: string; revision?: string }) => ({ title: value.title, ...(value.path === undefined ? {} : { path: value.path }), ...(value.revision === undefined ? {} : { revision: value.revision }) }),
    },
    execute: async (args: { xml?: unknown; title?: unknown }, exec: { agent?: unknown; signal?: unknown }) => {
      const xml = typeof args.xml === 'string' ? args.xml.trim() : ''
      if (xml === '') throw new DiagramError('xml is required')
      validateXml(xml)
      // Reject XML we cannot parse at creation time instead of at first edit.
      readDiagramSource(xml)
      const title = typeof args.title === 'string' && args.title.trim() !== '' ? args.title.trim() : 'draw.io diagram'
      const cwd = await resolveCwd(ctx, exec)
      const digest = createHash('sha1').update(xml).digest('hex').slice(0, 8)
      const path = join(cwd, 'diagrams', `${slug(title)}-${digest}.drawio`)
      try {
        atomicWrite(path, xml)
      } catch (error) {
        return { title, bytes: Buffer.byteLength(xml, 'utf8'), ...(error instanceof Error ? { warning: error.message } : {}) }
      }
      const revision = revisionOf(xml)
      lastByCwd.set(cwd, path)
      knownFiles.add(path)
      return { title, bytes: Buffer.byteLength(xml, 'utf8'), path, revision }
    },
  })

  tools.register({
    name: TOOL_NAMES.read,
    description: 'Read the structure of an existing workspace .drawio diagram: pages, node/edge ids, labels, geometry, styles, and the revision needed by drawio_apply. Use it before editing; it returns ids, not raw XML.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        path: { type: 'string', description: 'Workspace-relative .drawio path. Defaults to the latest diagram created in this session.' },
        page: { type: 'integer', description: 'Zero-based page index to summarize in depth; default is all pages.' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string' },
          revision: { type: 'string' },
          pageCount: { type: 'integer' },
          nodeCount: { type: 'integer' },
          edgeCount: { type: 'integer' },
          truncated: { type: 'boolean' },
          pages: { type: 'array' },
        },
        required: ['path', 'revision', 'pageCount', 'nodeCount', 'edgeCount'],
      },
      render: (_args: unknown, value: { path: string; revision: string; summary: DiagramSummary }) => [{ type: 'text', text: renderSummary(value.path, value.revision, value.summary) }],
      presentationMeta: (_args: unknown, value: { path: string; revision: string; title?: string }) => ({ ...(value.title === undefined ? {} : { title: value.title }), path: value.path, revision: value.revision }),
    },
    execute: async (args: { path?: unknown; page?: unknown }, exec: { agent?: unknown; signal?: unknown }) => {
      const target = await targetPath(ctx, exec, args.path)
      const content = readDiagramFile(target.path)
      const file = readDiagramSource(content)
      const summary = summarizeDiagram(file)
      lastByCwd.set(target.cwd, target.path)
      knownFiles.add(target.path)
      return { path: target.path, revision: revisionOf(content), pageCount: file.pages.length, nodeCount: summary.nodeCount, edgeCount: summary.edgeCount, truncated: summary.truncated, pages: summary.pages, summary }
    },
  })

  tools.register({
    name: TOOL_NAMES.apply,
    description: 'Edit an existing .drawio diagram with semantic ops (add/remove nodes and edges, labels, styles, positions, z-order). Ops are validated together and written atomically; nothing changes if one op fails. Pass expectRevision from drawio_read to avoid overwriting a concurrent change. Supports multiple pages via page index (default 0).',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        path: { type: 'string', description: 'Workspace-relative .drawio path; defaults to the latest diagram in this session.' },
        page: { type: 'integer', description: 'Zero-based page index (default 0).' },
        expectRevision: { type: 'string', description: 'Revision from drawio_read; the edit is rejected when the file changed.' },
        ops: {
          type: 'array',
          description: 'Batch of ops: addNode{id?,label,x,y,width?,height?,style?,parent?}, addEdge{id?,source,target,label?,style?,parent?}, setLabel{ids,label}, setStyle{ids,patch}, move{ids,dx?,dy?,x?,y?}, remove{ids}, order{id,where:front|back|forward|backward}.',
        },
      },
      required: ['ops'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string' },
          revision: { type: 'string' },
          changed: { type: 'array' },
          nodeCount: { type: 'integer' },
          edgeCount: { type: 'integer' },
        },
        required: ['path', 'revision', 'changed'],
      },
      render: (_args: unknown, value: { path: string; revision: string; changed: string[]; nodeCount?: number; edgeCount?: number }) => [{
        type: 'text',
        text: `Updated ${value.path} (revision ${value.revision.slice(0, 12)}): changed ${value.changed.length} cell(s)${value.nodeCount === undefined ? '' : `; now ${value.nodeCount} node(s), ${value.edgeCount ?? 0} edge(s)`}.`,
      }],
      presentationMeta: (_args: unknown, value: { path: string; revision: string }) => ({ path: value.path, revision: value.revision }),
    },
    execute: async (args: { path?: unknown; page?: unknown; expectRevision?: unknown; ops?: unknown }, exec: { agent?: unknown; signal?: unknown }) => {
      const target = await targetPath(ctx, exec, args.path)
      const current = readDiagramFile(target.path)
      const currentRevision = revisionOf(current)
      if (typeof args.expectRevision === 'string' && args.expectRevision !== '' && args.expectRevision !== currentRevision) {
        throw new DiagramError(`revision conflict: the file is now ${currentRevision}; call drawio_read again before editing`)
      }
      const file: DiagramFile = readDiagramSource(current)
      const ops = Array.isArray(args.ops) ? args.ops as DiagramOp[] : []
      const page = typeof args.page === 'number' && Number.isInteger(args.page) ? args.page : 0
      const result = applyOps(file, ops, page)
      const next = serializeDiagram(file)
      snapshots.remember(target.path, current)
      atomicWrite(target.path, next)
      lastByCwd.set(target.cwd, target.path)
      knownFiles.add(target.path)
      const summary = summarizeDiagram(readDiagramSource(next))
      return { path: target.path, revision: revisionOf(next), changed: result.changed, nodeCount: summary.nodeCount, edgeCount: summary.edgeCount }
    },
  })

  tools.register({
    name: TOOL_NAMES.undo,
    description: 'Restore the previous version of a .drawio file that drawio_apply changed (up to 8 versions per file in this process). Use when the user asks to undo the last diagram change.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: { path: { type: 'string', description: 'Workspace-relative .drawio path; defaults to the latest diagram.' } },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { path: { type: 'string' }, revision: { type: 'string' }, restored: { type: 'boolean' } }, required: ['path', 'revision', 'restored'] },
      render: (_args: unknown, value: { path: string; revision: string }) => [{ type: 'text', text: `Restored ${value.path} to the previous version (revision ${value.revision.slice(0, 12)}).` }],
      presentationMeta: (_args: unknown, value: { path: string; revision: string }) => ({ path: value.path, revision: value.revision }),
    },
    execute: async (args: { path?: unknown }, exec: { agent?: unknown; signal?: unknown }) => {
      const target = await targetPath(ctx, exec, args.path)
      const previous = snapshots.undo(target.path)
      if (previous === undefined) throw new DiagramError('there is no recorded version to undo for this file')
      atomicWrite(target.path, previous)
      lastByCwd.set(target.cwd, target.path)
      knownFiles.add(target.path)
      return { path: target.path, revision: revisionOf(previous), restored: true }
    },
  })

  tools.register({
    name: TOOL_NAMES.reference,
    description: 'Return draw.io XML generation reference (styles, shapes, layout grid, escaping rules). Call this before creating a complex diagram. Returns markdown.',
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
