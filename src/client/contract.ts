/**
 * Browser-side helpers for the draw.io inline card.
 *
 * Rendering strategy (verified in a headless browser): the diagram is drawn by
 * draw.io's own embeddable viewer script inside a sandboxed `srcdoc` iframe we
 * generate. The iframe has an opaque origin (`allow-scripts`, no
 * `allow-same-origin`), so model-generated XML never runs with access to the GUI.
 * The viewer script and stencil assets come from the public viewer origin, which
 * needs no account; the diagram data itself stays in the iframe document.
 */

/** Tool name shared by the host tool and the client tool view. */
export const TOOL_NAME = 'drawio_create'

/** Tool name of the built-in template catalog / instantiate tool. */
export const TEMPLATE_TOOL_NAME = 'drawio_template'

/** Public viewer/diagram host (script + stencils, no account required). */
export const VIEWER_ORIGIN = 'https://viewer.diagrams.net'

/** Public editor used for "open in draw.io" (no account required to view). */
export const EDITOR_ORIGIN = 'https://app.diagrams.net'

/** Message the card posts into the viewer iframe to request an SVG export. */
export const EXPORT_SVG_MESSAGE = 'dsh-drawio:export-svg'

/** Message the viewer iframe posts back with the serialized SVG. */
export const EXPORT_SVG_RESULT = 'dsh-drawio:svg'

/** Diagram source read from one tool call. */
export interface DiagramSource {
  /** Diagram title (from the tool argument). */
  title: string
  /** draw.io XML (mxGraphModel / mxfile). */
  xml: string
}

/** Loose view of the tool-call args reactive reader. */
interface ArgsReader {
  xml?: unknown
  title?: unknown
}

/**
 * Read the diagram source out of a tool call.
 * @param args - the tool's argument reader (same shape as the JSON arguments).
 * @returns the parsed source, or undefined while the XML is still streaming.
 */
export function readDiagramSource(args: unknown): DiagramSource | undefined {
  if (args === null || typeof args !== 'object') return undefined
  const record = args as ArgsReader
  const xml = typeof record.xml === 'string' ? record.xml.trim() : ''
  if (xml === '') return undefined
  const title = typeof record.title === 'string' && record.title.trim() !== '' ? record.title.trim() : 'draw.io diagram'
  return { title, xml }
}

/** Encode bytes as base64 without blowing the call stack on large diagrams. */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
  }
  return btoa(binary)
}

/**
 * Build the draw.io editor URL for one diagram. The payload format is the same
 * one the public draw.io MCP server returns: URI-encoded base64 of a raw deflate
 * over `encodeURIComponent(xml)`.
 * @param xml - draw.io XML.
 * @returns absolute app.diagrams.net URL.
 */
export async function editorUrl(xml: string): Promise<string> {
  const prepared = encodeURIComponent(xml)
  const compression = globalThis.CompressionStream
  if (typeof compression !== 'function') return `${EDITOR_ORIGIN}/?pv=0&grid=0#R${prepared}`
  const stream = new compression('deflate-raw')
  const writer = stream.writable.getWriter()
  // Drain the readable side CONCURRENTLY with the write. The transform applies
  // backpressure, so a write awaited before anyone reads the readable side can
  // deadlock forever (observed in Chrome 156: clicking "Open in draw.io" would
  // hang without opening a tab). Reading first keeps the pipe flowing.
  const compressedPromise = new Response(stream.readable).arrayBuffer()
  const bytes = new TextEncoder().encode(prepared)
  try {
    await writer.write(bytes)
    await writer.close()
  } catch (error) {
    // Never leave the pending read unhandled when the writer fails.
    void compressedPromise.catch(() => {})
    throw error
  }
  const compressed = new Uint8Array(await compressedPromise)
  return `${EDITOR_ORIGIN}/?pv=0&grid=0#R${encodeURIComponent(bytesToBase64(compressed))}`
}

/**
 * Strip executable content from viewer-produced SVG before handing it to the user.
 * The SVG is model-driven, so it is downloaded only after this pass removes
 * scripts, event-handler attributes and `javascript:` URLs.
 * @param svg - serialized SVG markup.
 * @returns sanitized SVG markup.
 */
export function sanitizeSvg(svg: string): string {
  return svg
    .replace(/<script[\s\S]*?<\/script>/giu, '')
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/giu, '')
    .replace(/\son[a-z]+\s*=\s*'[^']*'/giu, '')
    .replace(/javascript:/giu, '')
}

/**
 * Build the sandboxed viewer document rendered inside the chat card.
 *
 * The data is assigned through `setAttribute('data-mxgraph', JSON.stringify(...))`
 * on purpose: no HTML-attribute escaping of the diagram XML is involved, and
 * `<` inside the XML cannot terminate the inline script.
 * @param xml - draw.io XML.
 * @returns a self-contained HTML document.
 */
export function buildViewerHtml(xml: string): string {
  const xmlLiteral = JSON.stringify(xml).replace(/</gu, '\\u003c')
  return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:#ffffff}
.mxgraph{height:100%;max-width:100%}
</style></head><body>
<div class="mxgraph" id="drawio-graph"></div>
<script>
window.mxBasePath='${VIEWER_ORIGIN}/';
var config={xml:${xmlLiteral},highlight:'#7aaaff',nav:true,resize:true,toolbar:'zoom layers lightbox'};
document.getElementById('drawio-graph').setAttribute('data-mxgraph', JSON.stringify(config));
</script>
<script src="${VIEWER_ORIGIN}/js/viewer-static.min.js"></script>
<script>
window.addEventListener('message', function (event) {
  if (!event.data || event.data.type !== '${EXPORT_SVG_MESSAGE}') return;
  var svg = document.querySelector('.mxgraph svg');
  if (window.parent) window.parent.postMessage({ type: '${EXPORT_SVG_RESULT}', svg: svg ? svg.outerHTML : '' }, '*');
});
</script>
</body></html>`
}
