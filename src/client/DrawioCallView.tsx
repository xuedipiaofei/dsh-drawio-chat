/**
 * Custom tool view for `drawio_diagram`: renders the diagram in a sandboxed
 * iframe pointed at the public draw.io viewer (no account, no npx), plus
 * download and "open in draw.io" actions.
 *
 * The iframe is deliberately `sandbox="allow-scripts"` (no same-origin): the
 * diagram source comes from the model, so it never runs with access to the GUI
 * origin. Nothing is fetched from the plugin except the public viewer origin.
 */
import { useEffect, useMemo, useState } from 'react'
import { buildViewerHtml, EDITOR_ORIGIN, editorUrl, readDiagramSource, type DiagramSource } from './contract.ts'
import { tt } from './panel-helpers.ts'
import css from './drawio.module.css'

/** Minimal result metadata handed over from the host tool. */
export interface DrawioMeta {
  title?: string
  path?: string
  bytes?: number
}

/** Props accepted from the `tool.call.toolview` slot (subset we use). */
export interface DrawioCallViewProps {
  phase?: 'preparing' | 'start' | 'result'
  block?: {
    args?: unknown
    meta?: unknown
    content?: readonly { type: string; text?: string }[]
    isError?: boolean
  }
  toolName?: string
}

/** The draw.io inline card. */
export function DrawioCallView({ phase, block }: DrawioCallViewProps): React.JSX.Element {
  const source = useMemo<DiagramSource | undefined>(() => readDiagramSource(block?.args), [block?.args])
  const meta = useMemo<DrawioMeta>(() => {
    const raw = block?.meta
    return raw !== null && typeof raw === 'object' ? raw as DrawioMeta : {}
  }, [block?.meta])
  const [viewerHtml, setViewerHtml] = useState<string | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    if (source === undefined) return
    setError(undefined)
    try {
      setViewerHtml(buildViewerHtml(source.xml))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [source])

  /** Download the exact XML the viewer renders. */
  const download = (): void => {
    if (source === undefined) return
    const blob = new Blob([source.xml], { type: 'application/xml' })
    const anchor = document.createElement('a')
    anchor.href = URL.createObjectURL(blob)
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
        <span className={css.title}>{tt('drawio.title')}</span>
        {source !== undefined && <span className={css.subtitle}>{source.title}</span>}
        <span className={css.spacer} />
        {source !== undefined && (
          <>
            <button type="button" className={css.action} onClick={download}>{tt('drawio.download')}</button>
            <button type="button" className={css.action} onClick={open}>{tt('drawio.openInDrawio')}</button>
            <button type="button" className={css.action} onClick={() => { setExpanded(value => !value) }}>
              {expanded ? tt('drawio.collapse') : tt('drawio.expand')}
            </button>
          </>
        )}
      </div>
      {source === undefined && <p className={css.status}>{tt('drawio.rendering')}</p>}
      {source !== undefined && error !== undefined && <p className={css.error}>{tt('drawio.renderFailed', { error })}</p>}
      {source !== undefined && (
        <div className={css.frameWrap} data-expanded={expanded ? '' : undefined}>
          {viewerHtml === undefined
            ? <p className={css.status}>{tt('drawio.rendering')}</p>
            : (
                <iframe
                  className={css.frame}
                  title={source.title}
                  srcDoc={viewerHtml}
                  sandbox="allow-scripts allow-popups"
                  referrerPolicy="no-referrer"
                />
              )}
        </div>
      )}
      {meta.path !== undefined && <p className={css.path}>{meta.path}</p>}
    </div>
  )
}
