/**
 * draw.io document model: read, summarize and write native `.drawio` files
 * without losing the parts the op set does not understand.
 *
 * Supported carriers:
 * - bare `<mxGraphModel>`;
 * - `<mxfile><diagram><mxGraphModel>…</mxGraphModel></diagram></mxfile>` (what
 *   draw.io itself writes);
 * - the classic compressed `<diagram>` payload (raw deflate + URI encoding).
 */
import { createHash } from 'node:crypto'
import { isAbsolute, relative, resolve } from 'node:path'
import { deflateRawSync, inflateRawSync } from 'node:zlib'
import {
  childElement,
  childElements,
  cloneElement,
  getAttribute,
  parseXml,
  serializeElement,
  serializeXml,
  type XmlDocument,
  type XmlElement,
  type XmlNode,
} from './xml.ts'

/** Raise this for user-facing diagram/file problems. */
export class DiagramError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DiagramError'
  }
}

/** One page (diagram) inside a file. */
export interface DiagramPage {
  /** `id` attribute of the `<diagram>` element, when present. */
  id?: string
  /** `name` attribute of the `<diagram>` element, when present. */
  name?: string
  /** The page's `<mxGraphModel>` element (live tree). */
  model: XmlElement
  /** The enclosing `<diagram>` element (mxfile carrier only). */
  carrier?: XmlElement
  /** Whether the page used the compressed payload representation. */
  compressed: boolean
}

/** A parsed `.drawio` file. */
export interface DiagramFile {
  /** Original document (root + prolog), used to write the same carrier back. */
  document: XmlDocument
  /** Carrier kind. */
  wrapper: 'mxfile' | 'mxGraphModel'
  /** Pages in document order. */
  pages: DiagramPage[]
}

/** One summarized node or edge. */
export interface CellSummary {
  /** Cell id used by `drawio_apply`. */
  id: string
  /** Element kind (`mxCell`, `object`, `UserObject`). */
  kind: string
  /** Label/value attribute, capped for model context. */
  label: string
  /** Style attribute, capped for model context. */
  style?: string
  /** Parent cell/layer id. */
  parent?: string
  /** Geometry for vertices. */
  x?: number
  y?: number
  width?: number
  height?: number
  /** Edge endpoints. */
  source?: string
  target?: string
}

/** Per-page structure summary. */
export interface PageSummary {
  index: number
  id?: string
  name?: string
  nodes: CellSummary[]
  edges: CellSummary[]
}

/** Whole-file summary returned by `drawio_read`. */
export interface DiagramSummary {
  pages: PageSummary[]
  nodeCount: number
  edgeCount: number
  /** True when the model context was capped. */
  truncated: boolean
}

/** Limits for the summary handed to the model. */
const LIMITS = {
  nodesPerPage: 300,
  edgesPerPage: 500,
  labelChars: 120,
  styleChars: 160,
} as const

/** Strip a value down for model context. */
function cap(value: string | undefined, max: number): string | undefined {
  if (value === undefined || value === '') return undefined
  return value.length <= max ? value : `${value.slice(0, max)}…`
}

/** Classic draw.io plain-number geometry parse. */
function numberAttribute(element: XmlElement | undefined, name: string): number | undefined {
  const raw = element === undefined ? undefined : getAttribute(element, name)
  if (raw === undefined) return undefined
  const value = Number(raw)
  return Number.isFinite(value) ? value : undefined
}

/** Decode a compressed `<diagram>` payload (draw.io classic: deflate + URI encoding). */
function decompressDiagram(payload: string): string {
  const text = payload.trim()
  const candidates: Buffer[] = []
  try {
    candidates.push(Buffer.from(decodeURIComponent(text), 'latin1'))
  } catch {
    // not URI-encoded; fall through
  }
  try {
    candidates.push(Buffer.from(decodeURIComponent(text), 'base64'))
  } catch {
    // ignore
  }
  candidates.push(Buffer.from(text, 'base64'))
  for (const candidate of candidates) {
    try {
      const inflated = inflateRawSync(candidate)
      const decoded = decodeURIComponent(inflated.toString('utf8'))
      if (decoded.includes('<mxGraphModel')) return decoded
    } catch {
      // try the next representation
    }
    try {
      const inflated = inflateRawSync(candidate).toString('utf8')
      if (inflated.includes('<mxGraphModel')) return inflated
    } catch {
      // try the next representation
    }
  }
  throw new DiagramError('the diagram payload is compressed but could not be decoded')
}

/** Wrap one model tree into an `<mxfile><diagram>` element pair for new files. */
function makeCarrier(page: XmlElement): XmlElement {
  return {
    type: 'element',
    name: 'diagram',
    attributes: [{ name: 'id', value: `page-${createHash('sha1').update(serializeElement(page)).digest('hex').slice(0, 8)}` }],
    children: [page],
  }
}

/**
 * Parse a `.drawio` source.
 * @param source - raw file text.
 * @returns the parsed file (live tree).
 */
export function readDiagramSource(source: string): DiagramFile {
  const document = parseXml(source)
  const root = document.root
  if (root.name === 'mxGraphModel') {
    return { document, wrapper: 'mxGraphModel', pages: [{ model: root, compressed: false }] }
  }
  if (root.name !== 'mxfile') throw new DiagramError(`unsupported root element <${root.name}>; expected <mxfile> or <mxGraphModel>`)
  const pages: DiagramPage[] = []
  for (const carrier of childElements(root, 'diagram')) {
    const model = childElement(carrier, 'mxGraphModel')
    if (model !== undefined) {
      pages.push({ ...(getAttribute(carrier, 'id') === undefined ? {} : { id: getAttribute(carrier, 'id')! }), ...(getAttribute(carrier, 'name') === undefined ? {} : { name: getAttribute(carrier, 'name')! }), model, carrier, compressed: false })
      continue
    }
    const payload = carrier.children
      .filter((child): child is XmlNode & { type: 'text' } => child.type === 'text')
      .map(child => child.value)
      .join('')
    if (payload.trim() === '') throw new DiagramError('a <diagram> element has neither an <mxGraphModel> nor compressed content')
    const decoded = parseXml(decompressDiagram(payload))
    if (decoded.root.name !== 'mxGraphModel') throw new DiagramError('compressed diagram content is not an <mxGraphModel>')
    pages.push({ ...(getAttribute(carrier, 'id') === undefined ? {} : { id: getAttribute(carrier, 'id')! }), ...(getAttribute(carrier, 'name') === undefined ? {} : { name: getAttribute(carrier, 'name')! }), model: decoded.root, carrier, compressed: true })
  }
  if (pages.length === 0) throw new DiagramError('<mxfile> contains no <diagram> pages')
  return { document, wrapper: 'mxfile', pages }
}

/** Compress a model tree into the classic `<diagram>` payload. */
function compressModel(model: XmlElement): string {
  // Classic draw.io representation: URI-encoded raw-deflate bytes.
  const binary = deflateRawSync(Buffer.from(serializeElement(model), 'utf8'), { level: 9 }).toString('latin1')
  return encodeURIComponent(binary)
}

/**
 * Serialize a parsed file back to `.drawio` text, keeping each page's original
 * representation (uncompressed children stay children, compressed stays text).
 * @param file - parsed/mutated file.
 * @returns file text.
 */
export function serializeDiagram(file: DiagramFile): string {
  for (const page of file.pages) {
    if (file.wrapper === 'mxGraphModel') continue
    if (page.carrier === undefined) throw new DiagramError('mxfile page is missing its <diagram> carrier')
    if (page.compressed) {
      page.carrier.children = [{ type: 'text', value: `\n        ${compressModel(page.model)}\n      ` }]
    } else {
      page.carrier.children = [page.model]
    }
  }
  return serializeXml(file.document)
}

/**
 * Create a new bare-model document for `drawio_create`.
 * @param model - mxGraphModel element.
 * @returns a file whose wrapper is the bare model.
 */
export function newDiagramFile(model: XmlElement): DiagramFile {
  return {
    document: { root: model, prolog: [] },
    wrapper: 'mxGraphModel',
    pages: [{ model, compressed: false }],
  }
}

/** SHA-1 content hash used as the optimistic revision token. */
export function revisionOf(content: string): string {
  return createHash('sha1').update(content, 'utf8').digest('hex')
}

/**
 * Resolve a user-supplied diagram path against the session workspace.
 *
 * Only `.drawio` files inside `cwd` are accepted: the tools must never be a way
 * to read or overwrite arbitrary host files.
 * @param input - relative or absolute path from the tool call.
 * @param cwd - session working directory.
 * @returns absolute path.
 */
export function resolveDiagramPath(input: string, cwd: string): string {
  if (input.trim() === '') throw new DiagramError('path must not be empty')
  if (!/\.drawio$/iu.test(input)) throw new DiagramError('only .drawio files are supported')
  const absolute = resolve(cwd, input)
  const relativePath = relative(cwd, absolute)
  if (relativePath === '' || relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new DiagramError('path must stay inside the session workspace')
  }
  return absolute
}

/** One cell (with its wrapper element, for label/style placement). */
interface CellRef {
  wrapper: XmlElement
  cell: XmlElement
}

/** Collect the draw.io cells of one model in document order. */
function collectCells(model: XmlElement): CellRef[] {
  const root = childElement(model, 'root')
  if (root === undefined) throw new DiagramError('the <mxGraphModel> has no <root> element')
  const refs: CellRef[] = []
  for (const child of root.children) {
    if (child.type !== 'element') continue
    if (child.name === 'mxCell') {
      refs.push({ wrapper: child, cell: child })
      continue
    }
    if (child.name === 'object' || child.name === 'UserObject') {
      const cell = childElement(child, 'mxCell')
      if (cell !== undefined) refs.push({ wrapper: child, cell })
    }
  }
  return refs
}

/** Read the id of a cell reference. */
function cellId(ref: CellRef): string | undefined {
  return getAttribute(ref.wrapper, 'id') ?? getAttribute(ref.cell, 'id')
}

/** Read the label of a cell reference (draw.io stores it on the wrapper for objects). */
function cellLabel(ref: CellRef): string | undefined {
  return getAttribute(ref.wrapper, 'label') ?? getAttribute(ref.cell, 'value')
}

/** Summarize one page for the model. */
function summarizePage(page: DiagramPage, index: number, state: { truncated: boolean }): PageSummary {
  const nodes: CellSummary[] = []
  const edges: CellSummary[] = []
  for (const ref of collectCells(page.model)) {
    const id = cellId(ref)
    if (id === undefined || id === '0' || id === '1') continue
    const label = cap(cellLabel(ref), LIMITS.labelChars) ?? ''
    const style = cap(getAttribute(ref.cell, 'style'), LIMITS.styleChars)
    const parent = getAttribute(ref.cell, 'parent')
    const geometry = childElement(ref.cell, 'mxGeometry')
    const isEdge = getAttribute(ref.cell, 'edge') === '1'
    const common = { id, kind: ref.wrapper.name, label, ...(style === undefined ? {} : { style }), ...(parent === undefined ? {} : { parent }) }
    if (isEdge) {
      if (edges.length >= LIMITS.edgesPerPage) { state.truncated = true; continue }
      edges.push({
        ...common,
        ...(getAttribute(ref.cell, 'source') === undefined ? {} : { source: getAttribute(ref.cell, 'source')! }),
        ...(getAttribute(ref.cell, 'target') === undefined ? {} : { target: getAttribute(ref.cell, 'target')! }),
      })
      continue
    }
    if (getAttribute(ref.cell, 'vertex') !== '1') continue
    if (nodes.length >= LIMITS.nodesPerPage) { state.truncated = true; continue }
    const x = numberAttribute(geometry, 'x')
    const y = numberAttribute(geometry, 'y')
    const width = numberAttribute(geometry, 'width')
    const height = numberAttribute(geometry, 'height')
    nodes.push({
      ...common,
      ...(x === undefined ? {} : { x }),
      ...(y === undefined ? {} : { y }),
      ...(width === undefined ? {} : { width }),
      ...(height === undefined ? {} : { height }),
    })
  }
  return {
    index,
    ...(page.id === undefined ? {} : { id: page.id }),
    ...(page.name === undefined ? {} : { name: page.name }),
    nodes,
    edges,
  }
}

/**
 * Summarize a parsed file for `drawio_read`.
 * @param file - parsed file.
 * @returns structure summary capped for model context.
 */
export function summarizeDiagram(file: DiagramFile): DiagramSummary {
  const state = { truncated: false }
  const pages = file.pages.map((page, index) => summarizePage(page, index, state))
  return {
    pages,
    nodeCount: pages.reduce((sum, page) => sum + page.nodes.length, 0),
    edgeCount: pages.reduce((sum, page) => sum + page.edges.length, 0),
    truncated: state.truncated,
  }
}

/** Re-export the clone helper so tools can apply ops on a scratch copy. */
export { cloneElement, childElements, getAttribute, serializeElement }
