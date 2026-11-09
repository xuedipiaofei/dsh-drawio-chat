/** Diagram source extraction and the viewer/editor document builders. */
import { inflateRawSync } from 'node:zlib'
import { describe, expect, it, vi } from 'vitest'
import { buildViewerHtml, editorUrl, readDiagramSource, sanitizeSvg } from '../src/client/contract.ts'

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
    expect(html).toContain('dsh-drawio:export-svg')
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('\\u003cscript')
  })

  it('escapes the closing-tag sequence in the XML literal', () => {
    const html = buildViewerHtml(XML)
    expect(html).toContain('drawio-graph')
    expect(html.match(/<\/script>/gu)?.length).toBe(3)
    expect(html).toContain('\\u003cmxGraphModel')
  })
})

describe('sanitizeSvg', () => {
  it('removes scripts, event handlers and javascript: URLs', () => {
    const dirty = '<svg><script>alert(1)</script><rect onclick="steal()" fill="red"/><a href="javascript:go()">x</a></svg>'
    const clean = sanitizeSvg(dirty)
    expect(clean).not.toContain('<script')
    expect(clean).not.toContain('onclick')
    expect(clean).not.toContain('javascript:')
    expect(clean).toContain('<rect')
  })
})

describe('editorUrl', () => {
  it('drains CompressionStream while writing instead of deadlocking on backpressure', async () => {
    // Chrome 156: `write()` never settles until the readable side is consumed.
    // A write awaited before the read deadlocks and "Open in draw.io" hangs.
    const Real = globalThis.CompressionStream
    class BackpressureStream {
      writable: { getWriter: () => { write: (chunk: Uint8Array) => Promise<void>; close: () => Promise<void>; abort: () => Promise<void> } }
      readable: ReadableStream<Uint8Array>
      constructor() {
        let releaseWrite: (() => void) | undefined
        const gate = new Promise<void>((resolve) => { releaseWrite = resolve })
        this.writable = {
          getWriter: () => ({
            write: async (_chunk: Uint8Array) => { await gate },
            close: async () => {},
            abort: async () => {},
          }),
        }
        this.readable = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array([1, 2, 3]))
            controller.close()
            releaseWrite?.()
          },
        })
      }
    }
    vi.stubGlobal('CompressionStream', BackpressureStream as unknown as typeof CompressionStream)
    try {
      const raced = Promise.race([
        editorUrl(XML),
        new Promise((_resolve, reject) => { setTimeout(() => reject(new Error('editorUrl deadlocked')), 2_000) }),
      ]) as Promise<string>
      await expect(raced).resolves.toContain('#R')
    } finally {
      vi.stubGlobal('CompressionStream', Real)
    }
  })

  it('produces a draw.io editor link whose payload decodes back to the XML', async () => {
    const url = await editorUrl(XML)
    expect(url.startsWith('https://app.diagrams.net/?pv=0&grid=0#R')).toBe(true)
    const fragment = url.split('#R')[1]
    if (typeof DecompressionStream === 'function') {
      expect(decode(fragment)).toBe(XML)
    }
  })
})
