/** draw.io document model: carriers, summaries, revisions, path policy. */
import { deflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import {
  DiagramError,
  newDiagramFile,
  readDiagramSource,
  resolveDiagramPath,
  revisionOf,
  serializeDiagram,
  summarizeDiagram,
} from '../src/model/diagram.ts'
import { parseXml, serializeElement } from '../src/model/xml.ts'

const BARE = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="n1" value="Login" style="rounded=1;" vertex="1" parent="1"><mxGeometry x="40" y="40" width="120" height="60" as="geometry"/></mxCell><mxCell id="e1" value="ok" edge="1" parent="1" source="n1" target="n2"><mxGeometry relative="1" as="geometry"/></mxCell></root></mxGraphModel>'

const MXFILE = `<mxfile host="dsh-drawio-chat" type="device">
  <diagram id="page-1" name="demo">
    <mxGraphModel><root>
      <mxCell id="0"/>
      <mxCell id="1" parent="0"/>
      <object label="Wrapped node" customData="keep" id="n2"><mxCell style="ellipse;" vertex="1" parent="1"><mxGeometry x="200" y="40" width="100" height="80" as="geometry"/></mxCell></object>
      <mxCell id="n1" value="Login" style="rounded=1;" vertex="1" parent="1"><mxGeometry x="40" y="40" width="120" height="60" as="geometry"/></mxCell>
      <mxCell id="e1" value="ok" edge="1" parent="1" source="n1" target="n2"><mxGeometry relative="1" as="geometry"/></mxCell>
      <mxCell id="layer2" value="Layer 2" parent="0"/>
    </root></mxGraphModel>
  </diagram>
</mxfile>`

/** Build the classic compressed `<diagram>` payload the way draw.io does. */
function compress(xml: string): string {
  return encodeURIComponent(deflateRawSync(Buffer.from(xml, 'utf8'), { level: 9 }).toString('latin1'))
}

describe('readDiagramSource', () => {
  it('reads a bare mxGraphModel', () => {
    const file = readDiagramSource(BARE)
    expect(file.wrapper).toBe('mxGraphModel')
    expect(file.pages).toHaveLength(1)
    expect(summarizeDiagram(file).nodeCount).toBe(1)
  })

  it('reads an mxfile page and summarizes wrapped <object> cells as nodes', () => {
    const file = readDiagramSource(MXFILE)
    const summary = summarizeDiagram(file)
    expect(summary.pages[0].name).toBe('demo')
    expect(summary.nodeCount).toBe(2)
    expect(summary.edgeCount).toBe(1)
    expect(summary.pages[0].nodes[0]).toMatchObject({ id: 'n2', kind: 'object', label: 'Wrapped node', x: 200, width: 100 })
    expect(summary.pages[0].edges[0]).toMatchObject({ id: 'e1', source: 'n1', target: 'n2', label: 'ok' })
  })

  it('decodes the classic compressed diagram payload', () => {
    const compressed = `<mxfile><diagram id="p" name="c">${compress(BARE)}</diagram></mxfile>`
    const file = readDiagramSource(compressed)
    expect(file.pages[0].compressed).toBe(true)
    expect(summarizeDiagram(file).nodeCount).toBe(1)
  })

  it('rejects unknown roots and empty mxfiles', () => {
    expect(() => readDiagramSource('<svg/>')).toThrow(DiagramError)
    expect(() => readDiagramSource('<mxfile></mxfile>')).toThrow(/no <diagram> pages/u)
  })
})

describe('serializeDiagram', () => {
  it('keeps uncompressed pages as children and survives a second parse', () => {
    const file = readDiagramSource(MXFILE)
    const text = serializeDiagram(file)
    const again = readDiagramSource(text)
    expect(summarizeDiagram(again)).toEqual(summarizeDiagram(file))
    expect(text).toContain('customData="keep"')
  })

  it('writes compressed pages back as compressed text', () => {
    const file = readDiagramSource(`<mxfile><diagram id="p">${compress(BARE)}</diagram></mxfile>`)
    const text = serializeDiagram(file)
    expect(text).not.toContain('<mxGraphModel')
    expect(readDiagramSource(text).pages[0].compressed).toBe(true)
  })

  it('serializes a newly created bare model', () => {
    const model = parseXml(BARE).root
    const text = serializeDiagram(newDiagramFile(model))
    expect(text).toBe(serializeElement(model))
  })
})

describe('revision + path policy', () => {
  it('changes the revision when the content changes', () => {
    expect(revisionOf(BARE)).toBe(revisionOf(BARE))
    expect(revisionOf(BARE)).not.toBe(revisionOf(BARE.replace('Login', '登录')))
  })

  it('accepts .drawio paths inside the workspace only', () => {
    const cwd = '/tmp/ws'
    expect(resolveDiagramPath('diagrams/a.drawio', cwd)).toBe('/tmp/ws/diagrams/a.drawio')
    expect(resolveDiagramPath('/tmp/ws/diagrams/a.drawio', cwd)).toBe('/tmp/ws/diagrams/a.drawio')
    expect(() => resolveDiagramPath('../escape.drawio', cwd)).toThrow(/inside the session workspace/u)
    expect(() => resolveDiagramPath('/etc/passwd', cwd)).toThrow(/only \.drawio/u)
    expect(() => resolveDiagramPath('notes.txt', cwd)).toThrow(/only \.drawio/u)
  })
})
