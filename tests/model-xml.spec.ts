/** The dependency-free XML tree: round-trips, entities, malformed input. */
import { describe, expect, it } from 'vitest'
import { cloneElement, getAttribute, parseXml, serializeXml, setAttribute } from '../src/model/xml.ts'

const SOURCE = `<?xml version="1.0" encoding="UTF-8"?>
<!-- keep me -->
<mxfile host="dsh-drawio-chat" type="device">
  <diagram id="p1" name="demo">
    <mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>
  </diagram>
</mxfile>`

describe('parseXml / serializeXml', () => {
  it('round-trips the whole document including declaration, comment and nesting', () => {
    const document = parseXml(SOURCE)
    expect(document.declaration).toBe('<?xml version="1.0" encoding="UTF-8"?>')
    expect(serializeXml(document)).toBe(SOURCE)
  })

  it('keeps attribute order and decodes entities on read', () => {
    const document = parseXml('<mxfile b="2" a="1" label="a &amp; b &lt;c&gt;"><diagram/></mxfile>')
    expect(document.root.attributes).toEqual([
      { name: 'b', value: '2' },
      { name: 'a', value: '1' },
      { name: 'label', value: 'a & b <c>' },
    ])
    expect(serializeXml(document)).toContain('label="a &amp; b &lt;c&gt;"')
  })

  it('supports self-closing elements and text payloads', () => {
    const document = parseXml('<mxfile><diagram>abc%3D%3D</diagram></mxfile>')
    expect(serializeXml(document)).toBe('<mxfile><diagram>abc%3D%3D</diagram></mxfile>')
  })

  it('rejects mismatched tags and duplicate attributes with a position', () => {
    expect(() => parseXml('<mxfile><diagram></mxfile>')).toThrow(/mismatched closing tag/u)
    expect(() => parseXml('<mxfile a="1" a="2"/>')).toThrow(/duplicate attribute/u)
    expect(() => parseXml('')).toThrow(/missing root element/u)
  })
})

describe('tree helpers', () => {
  it('mutates attributes in place and clones independently', () => {
    const document = parseXml('<mxfile><diagram/></mxfile>')
    setAttribute(document.root, 'host', 'x')
    expect(getAttribute(document.root, 'host')).toBe('x')
    const clone = cloneElement(document.root)
    setAttribute(clone, 'host', 'y')
    expect(getAttribute(document.root, 'host')).toBe('x')
    expect(serializeXml({ root: clone, prolog: [] })).toContain('host="y"')
  })
})
