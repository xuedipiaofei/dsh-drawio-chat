/** Diagram source extraction and the viewer/editor document builders. */
import { inflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { buildViewerHtml, editorUrl, readDiagramSource } from '../src/client/contract.ts'

const XML = '<mxGraphModel><root><mxCell id="0"/></root></mxGraphModel>'

/** Decompress the `#R` payload the way draw.io does. */
function decode(fragment: string): string {
  const bytes = Buffer.from(decodeURIComponent(fragment), 'base64')
  return decodeURIComponent(inflateRawSync(bytes).toString('utf8'))
}

describe('readDiagramSource', () => {
  it('reads the XML and falls back to a generic title', () => {
    expect(readDiagramSource({ xml: XML })).toEqual({ title: 'draw.io diagram', xml: XML })
    expect(readDiagramSource({ xml: XML, title: 'Login' })).toEqual({ title: 'Login', xml: XML })
  })

  it('returns undefined while the XML is still streaming', () => {
    expect(readDiagramSource({})).toBeUndefined()
    expect(readDiagramSource({ xml: '   ' })).toBeUndefined()
    expect(readDiagramSource(undefined)).toBeUndefined()
  })
})

describe('buildViewerHtml', () => {
  it('embeds the XML as a JS literal without letting it break the script', () => {
    const html = buildViewerHtml('<mxGraphModel><script>alert(1)</script></mxGraphModel>')
    expect(html).toContain('data-mxgraph')
    expect(html).toContain('/js/viewer-static.min.js')
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('\\u003cscript')
  })

  it('escapes the closing-tag sequence in the XML literal', () => {
    const html = buildViewerHtml(XML)
    expect(html).toContain('drawio-graph')
    expect(html.match(/<\/script>/gu)?.length).toBe(2)
    expect(html).toContain('\\u003cmxGraphModel')
  })
})

describe('editorUrl', () => {
  it('produces a draw.io editor link whose payload decodes back to the XML', async () => {
    const url = await editorUrl(XML)
    expect(url.startsWith('https://app.diagrams.net/?pv=0&grid=0#R')).toBe(true)
    const fragment = url.split('#R')[1]
    if (typeof DecompressionStream === 'function') {
      expect(decode(fragment)).toBe(XML)
    }
  })
})
