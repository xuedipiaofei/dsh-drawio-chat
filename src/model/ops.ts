/**
 * Semantic edit operations for `.drawio` documents.
 *
 * The model works with ids and values instead of hand-writing XML: each op is
 * validated against the live tree, and a throw aborts the whole batch before the
 * tool writes anything. Cells the op set does not name are left untouched.
 */
import {
  childElement,
  childElements,
  getAttribute,
  removeAttribute,
  setAttribute,
  type XmlElement,
} from './xml.ts'
import { DiagramError, serializeDiagram, type DiagramFile, type DiagramPage } from './diagram.ts'

/** A node to create. */
export interface AddNodeOp {
  op: 'addNode'
  id?: string
  label: string
  x: number
  y: number
  width?: number
  height?: number
  style?: string
  parent?: string
}

/** An edge to create between two existing nodes. */
export interface AddEdgeOp {
  op: 'addEdge'
  id?: string
  source: string
  target: string
  label?: string
  style?: string
  parent?: string
}

/** Change labels of one or more cells. */
export interface SetLabelOp {
  op: 'setLabel'
  ids: string[]
  label: string
}

/** Merge a style patch (`fillColor=#dae8fc;fontSize=14`) into cells. */
export interface SetStyleOp {
  op: 'setStyle'
  ids: string[]
  patch: string
}

/** Move one or more cells. */
export interface MoveOp {
  op: 'move'
  ids: string[]
  dx?: number
  dy?: number
  x?: number
  y?: number
}

/** Remove cells (and edges that reference them). */
export interface RemoveOp {
  op: 'remove'
  ids: string[]
}

/** Move a cell in the z-order. */
export interface OrderOp {
  op: 'order'
  id: string
  where: 'front' | 'back' | 'forward' | 'backward'
}

/** Any supported op. */
export type DiagramOp = AddNodeOp | AddEdgeOp | SetLabelOp | SetStyleOp | MoveOp | RemoveOp | OrderOp

/** Result of applying an op batch. */
export interface ApplyResult {
  changed: string[]
}

/** One cell plus the element that owns its label/id (object wrapper or mxCell). */
interface CellRef {
  wrapper: XmlElement
  cell: XmlElement
  id: string
}

const DEFAULT_NODE_STYLE = 'rounded=1;whiteSpace=wrap;html=1;'
const DEFAULT_EDGE_STYLE = 'edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;endArrow=classic;'

/** The `<root>` of a page model. */
function pageRoot(page: DiagramPage): XmlElement {
  const root = childElement(page.model, 'root')
  if (root === undefined) throw new DiagramError('the <mxGraphModel> has no <root> element')
  return root
}

/** Index a page's cells by id. */
function indexCells(root: XmlElement): Map<string, CellRef> {
  const cells = new Map<string, CellRef>()
  for (const child of root.children) {
    if (child.type !== 'element') continue
    if (child.name === 'mxCell') {
      const id = getAttribute(child, 'id')
      if (id !== undefined) cells.set(id, { wrapper: child, cell: child, id })
      continue
    }
    if (child.name === 'object' || child.name === 'UserObject') {
      const cell = childElement(child, 'mxCell')
      const id = getAttribute(child, 'id')
      if (cell !== undefined && id !== undefined) cells.set(id, { wrapper: child, cell, id })
    }
  }
  return cells
}

/** Resolve a page by index with a friendly error. */
function pageAt(file: DiagramFile, index: number): DiagramPage {
  const page = file.pages[index]
  if (page === undefined) throw new DiagramError(`page ${index} does not exist; the file has ${file.pages.length} page(s)`)
  return page
}

/** Ensure a requested parent cell exists (or is one of the draw.io roots). */
function requireParent(cells: Map<string, CellRef>, parent: string | undefined): string {
  const id = parent ?? '1'
  if (id === '0' || id === '1' || cells.has(id)) return id
  throw new DiagramError(`parent "${id}" does not exist`)
}

/** Generate an id that is not used yet. */
function nextId(cells: Map<string, CellRef>, prefix: 'n' | 'e'): string {
  let index = cells.size + 1
  for (;;) {
    const id = `${prefix}${index}`
    if (!cells.has(id)) return id
    index += 1
  }
}

/** Parse a draw.io style string into ordered pairs. */
function parseStyle(style: string): Array<[string, string]> {
  const pairs: Array<[string, string]> = []
  for (const part of style.split(';')) {
    const trimmed = part.trim()
    if (trimmed === '') continue
    const equals = trimmed.indexOf('=')
    if (equals <= 0) {
      pairs.push([trimmed, ''])
      continue
    }
    pairs.push([trimmed.slice(0, equals), trimmed.slice(equals + 1)])
  }
  return pairs
}

/** Serialize ordered style pairs back into draw.io's semicolon form. */
function formatStyle(pairs: Array<[string, string]>): string {
  return pairs.map(([name, value]) => value === '' ? name : `${name}=${value}`).join(';') + ';'
}

/** Merge a style patch, keeping the original pair order and appending new keys. */
function mergeStyle(existing: string, patch: string): string {
  const pairs = parseStyle(existing)
  const index = new Map(pairs.map(([name], position) => [name, position]))
  for (const [name, value] of parseStyle(patch)) {
    const position = index.get(name)
    if (position === undefined) {
      pairs.push([name, value])
      continue
    }
    pairs[position] = [name, value]
  }
  return formatStyle(pairs)
}

/** Read the label carried by a wrapper/cell pair. */
function readLabel(ref: CellRef): string {
  return getAttribute(ref.wrapper, 'label') ?? getAttribute(ref.cell, 'value') ?? ''
}

/** Write the label to the element draw.io expects for this cell kind. */
function writeLabel(ref: CellRef, label: string): void {
  if (ref.wrapper.name === 'object' || ref.wrapper.name === 'UserObject') setAttribute(ref.wrapper, 'label', label)
  else setAttribute(ref.wrapper, 'value', label)
}

/** Create the `<mxGeometry>` child for a cell. */
function makeGeometry(attributes: Record<string, string>): XmlElement {
  return {
    type: 'element',
    name: 'mxGeometry',
    attributes: [...Object.entries(attributes).map(([name, value]) => ({ name, value }))],
    children: [],
  }
}

/** Find or create the geometry child of a cell. */
function geometryOf(ref: CellRef): XmlElement {
  const existing = childElement(ref.cell, 'mxGeometry')
  if (existing !== undefined) return existing
  const geometry = makeGeometry({ as: 'geometry' })
  ref.cell.children.push({ type: 'text', value: '' }, geometry)
  return geometry
}

/** A finite number or a clear error. */
function finite(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new DiagramError(`${field} must be a finite number`)
  return value
}

/** Read a required id list. */
function idList(op: { ids?: unknown }, field = 'ids'): string[] {
  if (!Array.isArray(op.ids) || op.ids.length === 0) throw new DiagramError(`${field} must be a non-empty array`)
  for (const id of op.ids) if (typeof id !== 'string' || id === '') throw new DiagramError(`${field} entries must be cell ids`)
  return op.ids as string[]
}

/** Apply one op. */
function applyOne(root: XmlElement, op: DiagramOp, changed: Set<string>): void {
  const cells = indexCells(root)
  switch (op.op) {
    case 'addNode': {
      const id = op.id ?? nextId(cells, 'n')
      if (cells.has(id)) throw new DiagramError(`cell "${id}" already exists`)
      const parent = requireParent(cells, op.parent)
      const cell: XmlElement = {
        type: 'element',
        name: 'mxCell',
        attributes: [
          { name: 'id', value: id },
          { name: 'value', value: typeof op.label === 'string' ? op.label : '' },
          { name: 'style', value: typeof op.style === 'string' && op.style !== '' ? op.style : DEFAULT_NODE_STYLE },
          { name: 'vertex', value: '1' },
          { name: 'parent', value: parent },
        ],
        children: [makeGeometry({
          x: String(finite(op.x, 'x')),
          y: String(finite(op.y, 'y')),
          width: String(finite(op.width ?? 120, 'width')),
          height: String(finite(op.height ?? 60, 'height')),
          as: 'geometry',
        })],
      }
      root.children.push({ type: 'text', value: '\n        ' }, cell, { type: 'text', value: '\n      ' })
      changed.add(id)
      return
    }
    case 'addEdge': {
      if (typeof op.source !== 'string' || !cells.has(op.source)) throw new DiagramError(`source "${String(op.source)}" does not exist`)
      if (typeof op.target !== 'string' || !cells.has(op.target)) throw new DiagramError(`target "${String(op.target)}" does not exist`)
      const id = op.id ?? nextId(cells, 'e')
      if (cells.has(id)) throw new DiagramError(`cell "${id}" already exists`)
      const parent = requireParent(cells, op.parent)
      const cell: XmlElement = {
        type: 'element',
        name: 'mxCell',
        attributes: [
          { name: 'id', value: id },
          ...(typeof op.label === 'string' && op.label !== '' ? [{ name: 'value', value: op.label }] : []),
          { name: 'style', value: typeof op.style === 'string' && op.style !== '' ? op.style : DEFAULT_EDGE_STYLE },
          { name: 'edge', value: '1' },
          { name: 'parent', value: parent },
          { name: 'source', value: op.source },
          { name: 'target', value: op.target },
        ],
        children: [makeGeometry({ relative: '1', as: 'geometry' })],
      }
      root.children.push({ type: 'text', value: '\n        ' }, cell, { type: 'text', value: '\n      ' })
      changed.add(id)
      return
    }
    case 'setLabel': {
      if (typeof op.label !== 'string') throw new DiagramError('label must be a string')
      for (const id of idList(op)) {
        const ref = cells.get(id)
        if (ref === undefined) throw new DiagramError(`cell "${id}" does not exist`)
        writeLabel(ref, op.label)
        changed.add(id)
      }
      return
    }
    case 'setStyle': {
      if (typeof op.patch !== 'string' || op.patch.trim() === '') throw new DiagramError('patch must be a non-empty style string')
      for (const id of idList(op)) {
        const ref = cells.get(id)
        if (ref === undefined) throw new DiagramError(`cell "${id}" does not exist`)
        setAttribute(ref.cell, 'style', mergeStyle(getAttribute(ref.cell, 'style') ?? '', op.patch))
        changed.add(id)
      }
      return
    }
    case 'move': {
      const dx = op.dx === undefined ? undefined : finite(op.dx, 'dx')
      const dy = op.dy === undefined ? undefined : finite(op.dy, 'dy')
      const x = op.x === undefined ? undefined : finite(op.x, 'x')
      const y = op.y === undefined ? undefined : finite(op.y, 'y')
      if (dx === undefined && dy === undefined && x === undefined && y === undefined) throw new DiagramError('move needs dx/dy or x/y')
      for (const id of idList(op)) {
        const ref = cells.get(id)
        if (ref === undefined) throw new DiagramError(`cell "${id}" does not exist`)
        const geometry = geometryOf(ref)
        if (x !== undefined) setAttribute(geometry, 'x', String(x))
        if (y !== undefined) setAttribute(geometry, 'y', String(y))
        if (dx !== undefined) setAttribute(geometry, 'x', String((Number(getAttribute(geometry, 'x') ?? '0') || 0) + dx))
        if (dy !== undefined) setAttribute(geometry, 'y', String((Number(getAttribute(geometry, 'y') ?? '0') || 0) + dy))
        changed.add(id)
      }
      return
    }
    case 'remove': {
      const ids = idList(op)
      const removed = new Set(ids)
      for (const id of ids) if (!cells.has(id)) throw new DiagramError(`cell "${id}" does not exist`)
      // Edges that reference a removed node would dangle; remove them too.
      for (const ref of cells.values()) {
        const source = getAttribute(ref.cell, 'source')
        const target = getAttribute(ref.cell, 'target')
        if ((source !== undefined && removed.has(source)) || (target !== undefined && removed.has(target))) removed.add(ref.id)
      }
      for (let index = root.children.length - 1; index >= 0; index -= 1) {
        const child = root.children[index]
        if (child.type !== 'element') continue
        const id = child.name === 'mxCell' ? getAttribute(child, 'id') : getAttribute(child, 'id')
        if (id !== undefined && removed.has(id)) root.children.splice(index, 1)
      }
      for (const id of removed) changed.add(id)
      return
    }
    case 'order': {
      if (typeof op.id !== 'string') throw new DiagramError('order needs a cell id')
      const ref = cells.get(op.id)
      if (ref === undefined) throw new DiagramError(`cell "${op.id}" does not exist`)
      const indices = root.children
        .map((_child, index) => index)
        .filter(index => root.children[index].type === 'element')
      const current = indices.indexOf(root.children.indexOf(ref.wrapper))
      if (current < 0) throw new DiagramError(`cell "${op.id}" is not a direct child of <root>`)
      const elements = indices.map(index => root.children[index])
      const [element] = elements.splice(current, 1)
      const target = op.where === 'front'
        ? elements.length
        : op.where === 'back'
          ? 0
          : op.where === 'forward'
            ? Math.min(elements.length, current)
            : Math.max(0, current - 1)
      elements.splice(target, 0, element)
      for (let position = 0; position < indices.length; position += 1) root.children[indices[position]] = elements[position]
      changed.add(op.id)
      return
    }
    default: {
      const unknown = op as { op?: unknown }
      throw new DiagramError(`unknown op "${String(unknown.op)}"`)
    }
  }
}

/**
 * Apply a batch of ops to one page.
 * @param file - parsed file (mutated on success).
 * @param ops - op list; validated in order.
 * @param pageIndex - zero-based page to edit (default 0).
 * @returns ids whose content changed.
 */
export function applyOps(file: DiagramFile, ops: readonly DiagramOp[], pageIndex = 0): ApplyResult {
  if (!Array.isArray(ops) || ops.length === 0) throw new DiagramError('ops must be a non-empty array')
  const root = pageRoot(pageAt(file, pageIndex))
  const changed = new Set<string>()
  for (const op of ops) {
    if (op === null || typeof op !== 'object' || typeof (op as { op?: unknown }).op !== 'string') throw new DiagramError('each op must be an object with an "op" string')
    applyOne(root, op, changed)
  }
  return { changed: [...changed] }
}

/** Serialize after a successful batch (helper for tools/tests). */
export function serializeAfterOps(file: DiagramFile): string {
  return serializeDiagram(file)
}
