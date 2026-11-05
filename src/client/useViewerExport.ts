/**
 * Card ↔ viewer iframe export bridge.
 *
 * The viewer runs in a sandboxed opaque-origin iframe, so the card asks it for
 * the rendered SVG over postMessage. SVG is sanitized before it is downloaded;
 * PNG is rasterized in the page from that sanitized SVG (no host image service).
 */
import { useEffect, useRef, type RefObject } from 'react'
import { EXPORT_SVG_MESSAGE, EXPORT_SVG_RESULT, sanitizeSvg } from './contract.ts'
import { tt } from './panel-helpers.ts'

/** Download one blob under a file name. */
function download(blob: Blob, fileName: string): void {
  const anchor = document.createElement('a')
  anchor.href = URL.createObjectURL(blob)
  anchor.download = fileName
  anchor.click()
  setTimeout(() => { URL.revokeObjectURL(anchor.href) }, 1000)
}

/** Filesystem-safe file stem. */
function stem(title: string): string {
  return title.replace(/[^\w.-]+/gu, '-') || 'diagram'
}

/** Read the intrinsic size of an SVG's viewBox for rasterization. */
function viewBoxSize(svg: string): { width: number; height: number } | undefined {
  const match = /viewBox\s*=\s*"([^"]+)"/iu.exec(svg)
  if (match === null) return undefined
  const parts = match[1].trim().split(/[\s,]+/u).map(Number)
  if (parts.length !== 4 || parts.some(value => !Number.isFinite(value)) || parts[2] <= 0 || parts[3] <= 0) return undefined
  return { width: parts[2], height: parts[3] }
}

/** Turn sanitized SVG into a 2× PNG blob through a canvas. */
async function rasterizePng(svg: string): Promise<Blob> {
  const size = viewBoxSize(svg) ?? { width: 1200, height: 800 }
  const scale = 2
  const markup = svg.replace(/<svg/iu, `<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}"`)
  // A blob: URL taints the canvas in Chromium when it wraps an SVG (verified in
  // headless Chrome), so the raster source is a data: URL instead.
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`
  {
    const image = new Image()
    await new Promise<void>((resolve, reject) => {
      image.onload = () => { resolve() }
      image.onerror = () => { reject(new Error('could not decode the diagram SVG')) }
      image.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(size.width * scale)
    canvas.height = Math.round(size.height * scale)
    const context = canvas.getContext('2d')
    if (context === null) throw new Error('2D canvas is not available')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>(resolve => { canvas.toBlob(resolve, 'image/png') })
    if (blob === null) throw new Error('could not encode the PNG')
    return blob
  }
}

/** Export actions for one viewer iframe. */
export interface ViewerExport {
  /** Download the current diagram as SVG. */
  exportSvg: () => void
  /** Download the current diagram as a 2× PNG. */
  exportPng: () => void
}

/**
 * Wire an iframe up to the viewer's export messages.
 * @param frameRef - the viewer iframe ref.
 * @param title - current title for file names.
 * @param onError - surface export failures in the card.
 * @returns callbacks the buttons call.
 */
export function useViewerExport(frameRef: RefObject<HTMLIFrameElement | null>, title: () => string, onError: (message: string) => void): ViewerExport {
  const pending = useRef<'svg' | 'png' | null>(null)
  const errorRef = useRef(onError)
  errorRef.current = onError
  const titleRef = useRef(title)
  titleRef.current = title

  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      const data = event.data as { type?: unknown; svg?: unknown } | null
      if (data === null || data.type !== EXPORT_SVG_RESULT || event.source !== frameRef.current?.contentWindow) return
      const kind = pending.current
      pending.current = null
      const svg = typeof data.svg === 'string' ? sanitizeSvg(data.svg) : ''
      if (svg.trim() === '') {
        errorRef.current(tt('drawio.exportFailed'))
        return
      }
      const name = stem(titleRef.current())
      if (kind === 'svg') {
        download(new Blob([svg], { type: 'image/svg+xml' }), `${name}.svg`)
        return
      }
      rasterizePng(svg)
        .then(blob => { download(blob, `${name}.png`) })
        .catch((error: unknown) => {
          errorRef.current(tt('drawio.exportPngFailed', { error: error instanceof Error ? error.message : String(error) }))
        })
    }
    window.addEventListener('message', onMessage)
    return () => { window.removeEventListener('message', onMessage) }
  }, [frameRef])

  const request = (kind: 'svg' | 'png'): void => {
    pending.current = kind
    frameRef.current?.contentWindow?.postMessage({ type: EXPORT_SVG_MESSAGE }, '*')
  }

  return {
    exportSvg: () => { request('svg') },
    exportPng: () => { request('png') },
  }
}
