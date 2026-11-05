/**
 * Minimal, dependency-free XML tree for draw.io files.
 *
 * draw.io documents are small and structurally simple (elements, attributes,
 * text and comments); a full DOM would add a runtime dependency to a plugin
 * that must stay installable inside the desktop profile. This parser preserves
 * element order, attribute order and unknown elements so edits can round-trip
 * content the op set does not understand.
 */

/** One `name="value"` pair, kept in document order. */
export interface XmlAttribute {
  name: string
  value: string
}

/** An element node. */
export interface XmlElement {
  type: 'element'
  name: string
  attributes: XmlAttribute[]
  children: XmlNode[]
}

/** Raw text (draw.io uses it for compressed diagram payloads). */
export interface XmlText {
  type: 'text'
  value: string
}

/** XML comment, preserved so hand-authored files round-trip. */
export interface XmlComment {
  type: 'comment'
  value: string
}

/** Any child node. */
export type XmlNode = XmlElement | XmlText | XmlComment

/** A parsed document: optional declaration plus a required root element. */
export interface XmlDocument {
  declaration?: string
  root: XmlElement
  /** Comments/whitespace before the root element. */
  prolog: XmlNode[]
}

/** Raise this for malformed input so tools can report a clean message. */
export class XmlError extends Error {
  constructor(message: string, position: number) {
    super(`${message} (at ${position})`)
    this.name = 'XmlError'
  }
}

/** Decode the five predefined entities plus numeric references. */
function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/giu, (match, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) return String.fromCodePoint(Number.parseInt(body.slice(2), 16))
    if (body.startsWith('#')) return String.fromCodePoint(Number.parseInt(body.slice(1), 10))
    switch (body) {
      case 'amp': return '&'
      case 'lt': return '<'
      case 'gt': return '>'
      case 'quot': return '"'
      case 'apos': return "'"
      default: return match
    }
  })
}

/** Escape text content. */
export function escapeText(value: string): string {
  return value.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;')
}

/** Escape an attribute value (double-quoted form). */
export function escapeAttribute(value: string): string {
  return escapeText(value).replace(/"/gu, '&quot;')
}

const NAME = /^[A-Za-z_][\w.:-]*/u

/** Recursive-descent parser over the raw source string. */
class Parser {
  private index = 0

  constructor(private readonly source: string) {}

  parseDocument(): XmlDocument {
    const prolog: XmlNode[] = []
    let declaration: string | undefined
    let root: XmlElement | undefined
    while (this.index < this.source.length) {
      if (this.startsWith('<?')) {
        const end = this.source.indexOf('?>', this.index)
        if (end < 0) throw this.error('unterminated processing instruction')
        if (declaration === undefined) declaration = this.source.slice(this.index, end + 2)
        this.index = end + 2
        continue
      }
      if (this.startsWith('<!--')) {
        prolog.push(this.parseComment())
        continue
      }
      if (this.startsWith('<![CDATA[')) {
        const end = this.source.indexOf(']]>', this.index)
        if (end < 0) throw this.error('unterminated CDATA')
        prolog.push({ type: 'text', value: this.source.slice(this.index + 9, end) })
        this.index = end + 3
        continue
      }
      if (this.startsWith('<')) {
        if (root !== undefined) throw this.error('multiple root elements')
        root = this.parseElement()
        continue
      }
      const next = this.source.indexOf('<', this.index)
      const text = this.source.slice(this.index, next < 0 ? undefined : next)
      if (text.trim() !== '') {
        if (root === undefined) throw this.error('text before root element')
        throw this.error('unexpected text outside the root element')
      }
      prolog.push({ type: 'text', value: text })
      this.index = next < 0 ? this.source.length : next
    }
    if (root === undefined) throw this.error('missing root element')
    return { ...(declaration === undefined ? {} : { declaration }), root, prolog }
  }

  parseComment(): XmlComment {
    const end = this.source.indexOf('-->', this.index + 4)
    if (end < 0) throw this.error('unterminated comment')
    const value = this.source.slice(this.index + 4, end)
    this.index = end + 3
    return { type: 'comment', value }
  }

  parseElement(): XmlElement {
    const start = this.index
    if (!this.startsWith('<')) throw this.error('expected element')
    this.index += 1
    const name = this.readName()
    const attributes: XmlAttribute[] = []
    const seen = new Set<string>()
    for (;;) {
      this.skipSpace()
      if (this.startsWith('/>')) {
        this.index += 2
        return { type: 'element', name, attributes, children: [] }
      }
      if (this.startsWith('>')) {
        this.index += 1
        break
      }
      if (this.index >= this.source.length) throw this.error(`unclosed element <${name}> (` + start + ')')
      const attribute = this.readAttribute()
      if (seen.has(attribute.name)) throw this.error(`duplicate attribute ${attribute.name}`)
      seen.add(attribute.name)
      attributes.push(attribute)
    }
    const children: XmlNode[] = []
    for (;;) {
      if (this.index >= this.source.length) throw this.error(`unclosed element <${name}>`)
      if (this.startsWith(`</`)) {
        this.index += 2
        const closing = this.readName()
        if (closing !== name) throw this.error(`mismatched closing tag </${closing}> for <${name}>`)
        this.skipSpace()
        if (!this.startsWith('>')) throw this.error('malformed closing tag')
        this.index += 1
        return { type: 'element', name, attributes, children }
      }
      if (this.startsWith('<!--')) {
        children.push(this.parseComment())
        continue
      }
      if (this.startsWith('<![CDATA[')) {
        const end = this.source.indexOf(']]>', this.index)
        if (end < 0) throw this.error('unterminated CDATA')
        children.push({ type: 'text', value: this.source.slice(this.index + 9, end) })
        this.index = end + 3
        continue
      }
      if (this.startsWith('<')) {
        children.push(this.parseElement())
        continue
      }
      const next = this.source.indexOf('<', this.index)
      const text = this.source.slice(this.index, next < 0 ? undefined : next)
      children.push({ type: 'text', value: decodeEntities(text) })
      this.index = next < 0 ? this.source.length : next
    }
  }

  readName(): string {
    const match = NAME.exec(this.source.slice(this.index))
    if (match === null) throw this.error(`expected a name`)
    this.index += match[0].length
    return match[0]
  }

  readAttribute(): XmlAttribute {
    const name = this.readName()
    this.skipSpace()
    if (!this.startsWith('=')) throw this.error(`expected '=' after attribute ${name}`)
    this.index += 1
    this.skipSpace()
    const quote = this.source[this.index]
    if (quote !== '"' && quote !== "'") throw this.error(`expected quoted value for ${name}`)
    this.index += 1
    const end = this.source.indexOf(quote, this.index)
    if (end < 0) throw this.error(`unterminated value for ${name}`)
    const raw = this.source.slice(this.index, end)
    this.index = end + 1
    return { name, value: decodeEntities(raw) }
  }

  skipSpace(): void {
    while (this.index < this.source.length && /\s/u.test(this.source[this.index])) this.index += 1
  }

  startsWith(token: string): boolean {
    return this.source.startsWith(token, this.index)
  }

  error(message: string): XmlError {
    return new XmlError(message, this.index)
  }
}

/**
 * Parse an XML document.
 * @param source - raw XML text.
 * @returns the parsed document.
 */
export function parseXml(source: string): XmlDocument {
  return new Parser(source).parseDocument()
}

/** Serialize one node. */
function serializeNode(node: XmlNode): string {
  if (node.type === 'text') return escapeText(node.value)
  if (node.type === 'comment') return `<!--${node.value}-->`
  const attributes = node.attributes.length === 0
    ? ''
    : ' ' + node.attributes.map(attribute => `${attribute.name}="${escapeAttribute(attribute.value)}"`).join(' ')
  if (node.children.length === 0) return `<${node.name}${attributes}/>`
  return `<${node.name}${attributes}>${node.children.map(serializeNode).join('')}</${node.name}>`
}

/**
 * Serialize one element.
 * @param element - the element to write.
 * @returns XML text.
 */
export function serializeElement(element: XmlElement): string {
  return serializeNode(element)
}

/**
 * Serialize a whole document (declaration first when present).
 * @param document - parsed document.
 * @returns XML text.
 */
export function serializeXml(document: XmlDocument): string {
  const prolog = document.prolog.map(serializeNode).join('')
  const declaration = document.declaration === undefined ? '' : document.declaration
  return `${declaration}${prolog}${serializeNode(document.root)}`
}

/**
 * Read one attribute.
 * @param element - element to inspect.
 * @param name - attribute name.
 * @returns the value, or undefined.
 */
export function getAttribute(element: XmlElement, name: string): string | undefined {
  return element.attributes.find(attribute => attribute.name === name)?.value
}

/**
 * Set (or append) one attribute while keeping the existing order.
 * @param element - element to mutate.
 * @param name - attribute name.
 * @param value - new value.
 */
export function setAttribute(element: XmlElement, name: string, value: string): void {
  const existing = element.attributes.find(attribute => attribute.name === name)
  if (existing === undefined) element.attributes.push({ name, value })
  else existing.value = value
}

/**
 * Remove one attribute if present.
 * @param element - element to mutate.
 * @param name - attribute name.
 */
export function removeAttribute(element: XmlElement, name: string): void {
  const index = element.attributes.findIndex(attribute => attribute.name === name)
  if (index >= 0) element.attributes.splice(index, 1)
}

/**
 * Find the first direct child element with this name.
 * @param element - parent element.
 * @param name - child name.
 * @returns the child, or undefined.
 */
export function childElement(element: XmlElement, name: string): XmlElement | undefined {
  return element.children.find((child): child is XmlElement => child.type === 'element' && child.name === name)
}

/**
 * List direct child elements with this name.
 * @param element - parent element.
 * @param name - child name.
 * @returns the matching children.
 */
export function childElements(element: XmlElement, name: string): XmlElement[] {
  return element.children.filter((child): child is XmlElement => child.type === 'element' && child.name === name)
}

/**
 * Collect every descendant element matching a predicate (pre-order).
 * @param element - root of the walk.
 * @param predicate - name test.
 * @returns matching elements.
 */
export function descendants(element: XmlElement, predicate: (element: XmlElement) => boolean): XmlElement[] {
  const found: XmlElement[] = []
  const walk = (current: XmlElement): void => {
    for (const child of current.children) {
      if (child.type !== 'element') continue
      if (predicate(child)) found.push(child)
      walk(child)
    }
  }
  walk(element)
  return found
}

/**
 * Deep-clone an element so a failed op batch cannot mutate the live tree.
 * @param element - element to clone.
 * @returns an independent copy.
 */
export function cloneElement(element: XmlElement): XmlElement {
  return {
    type: 'element',
    name: element.name,
    attributes: element.attributes.map(attribute => ({ ...attribute })),
    children: element.children.map(child => {
      if (child.type === 'element') return cloneElement(child)
      return { ...child }
    }),
  }
}
