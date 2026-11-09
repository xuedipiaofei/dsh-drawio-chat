/**
 * Cards for tools that operate on an existing `.drawio` file
 * (`drawio_read`, `drawio_apply`, `drawio_undo`).
 *
 * The result meta carries the file path; the card reads the file back from the
 * plugin's loopback-only preview route and renders it with the same sandboxed
 * draw.io viewer as the create card. Nothing echoes XML through the session log.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { buildViewerHtml, EDITOR_ORIGIN, editorUrl, type DiagramSource } from './contract.ts'
import { useViewerExport } from './useViewerExport.ts'
import { tt } from './panel-helpers.ts'
import css from './drawio.module.css'

/** Which tool produced this card. */
export type FileCardMode = 'read' | 'apply' | 'undo' | 'template'

/** Result metadata written by the host tools. */
export interface FileCardMeta {
  title?: string
  path?: string
  revision?: string
}

/** Props accepted from the `tool.call.toolview` slot (subset we use). */
export interface DrawioFileCardProps {
  mode: FileCardMode
  phase?: 'preparing' | 'start' | 'result'
  block?: {
    args?: unknown
    meta?: unknown
    content?: readonly { type: string; text?: string }[]
    isError?: boolean
  }
}

/** Same-origin preview feed served by the host plugin. */
const PREVIEW_ROUTE = '/api/dsh-drawio-chat/diagram'

/** Title copy per mode. */
function titleKey(mode: FileCardMode): 'drawio.fileRead' | 'drawio.fileApply' | 'drawio.fileUndo' | 'drawio.fileTemplate' {
  if (mode === 'read') return 'drawio.fileRead'
  if (mode === 'apply') return 'drawio.fileApply'
  if (mode === 'template') return 'drawio.fileTemplate'
  return 'drawio.fileUndo'
}

/** The file-backed diagram card. */
export function DrawioFileCard({ mode, phase, block }: DrawioFileCardProps): React.JSX.Element {
  const meta = useMemo<FileCardMeta>(() => {
    const raw = block?.meta
    return raw !== null && typeof raw === 'object' ? raw as FileCardMeta : {}
  }, [block?.meta])
  const [xml, setXml] = useState<string | undefined>(undefined)
  const [viewerHtml, setViewerHtml] = useState<string | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [notice, setNotice] = useState<string | undefined>(undefined)
  const [expanded, setExpanded] = useState(false)
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const source = useMemo<DiagramSource | undefined>(() => {
    if (xml === undefined) return undefined
    return { title: meta.title ?? meta.path?.split('/').pop() ?? 'draw.io diagram', xml }
  }, [xml, meta.title, meta.path])
  const viewerExport = useViewerExport(frameRef, () => source?.title ?? 'diagram', setNotice)

  useEffect(() => {
    const path = meta.path
    if (path === undefined) {
      if (phase === 'result') setError('the tool result did not include a diagram path')
      return
    }
    let cancelled = false
    setError(undefined)
    setXml(undefined)
    fetch(`${PREVIEW_ROUTE}?path=${encodeURIComponent(path)}`, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return response.text()
      })
      .then((text) => { if (!cancelled) setXml(text) })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught))
      })
    return () => { cancelled = true }
  }, [meta.path, phase])

  useEffect(() => {
    if (source === undefined) { setViewerHtml(undefined); return }
    try {
      setViewerHtml(buildViewerHtml(source.xml))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    }
  }, [source])

  /** Download the exact file the card rendered. */
  const download = (): void => {
    if (source === undefined) return
    const anchor = document.createElement('a')
    anchor.href = URL.createObjectURL(new Blob([source.xml], { type: 'application/xml' }))
    anchor.download = `${source.title.replace(/[^\w.-]+/gu, '-') || 'diagram'}.drawio`
    anchor.click()
    setTimeout(() => { URL.revokeObjectURL(anchor.href) }, 1000)
  }

  const open = (): void => {
    if (source === undefined) return
    editorUrl(source.xml)
      .then((url) => { window.open(url, '_blank', 'noopener,noreferrer') })
      .catch(() => { window.open(EDITOR_ORIGIN, '_blank', 'noopener,noreferrer') })
  }

  return (
    <div className={css.card} data-dsh-part="drawio-card">
      <div className={css.head}>
        <span className={css.title}>{tt(titleKey(mode))}</span>
        {source !== undefined && <span className={css.subtitle}>{source.title}</span>}
        {meta.revision !== undefined && <span className={css.badge}>{tt('drawio.revision')} {meta.revision.slice(0, 8)}</span>}
        <span className={css.spacer} />
        {source !== undefined && (
          <>
            <button type="button" className={css.action} onClick={download}>{tt('drawio.download')}</button>
            <button type="button" className={css.action} onClick={viewerExport.exportSvg}>{tt('drawio.exportSvg')}</button>
            <button type="button" className={css.action} onClick={viewerExport.exportPng}>{tt('drawio.exportPng')}</button>
            <button type="button" className={css.action} onClick={open}>{tt('drawio.openInDrawio')}</button>
            <button type="button" className={css.action} onClick={() => { setExpanded(value => !value) }}>
              {expanded ? tt('drawio.collapse') : tt('drawio.expand')}
            </button>
          </>
        )}
      </div>
      {source === undefined && error === undefined && <p className={css.status}>{tt('drawio.fileLoading')}</p>}
      {error !== undefined && <p className={css.error}>{tt('drawio.fileLoadFailed', { error })}</p>}
      {notice !== undefined && <p className={css.error}>{notice}</p>}
      {source !== undefined && (
        <div className={css.frameWrap} data-expanded={expanded ? '' : undefined}>
          <iframe
            ref={frameRef}
            className={css.frame}
            title={source.title}
            srcDoc={viewerHtml}
            sandbox="allow-scripts allow-popups"
            referrerPolicy="no-referrer"
          />
        </div>
      )}
      {meta.path !== undefined && <p className={css.path}>{meta.path}</p>}
    </div>
  )
}
