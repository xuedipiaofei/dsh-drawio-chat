/**
 * Sidebar tab body for `*.drawio` files.
 *
 * Without this tab the sidebar's built-in text preview opens the raw XML.
 * The body resolves the tab address into (session, workspace-relative path),
 * fetches the file from the plugin's loopback-only host route, and renders it
 * with the same sandboxed draw.io viewer used in the chat card. It polls while
 * visible so a `drawio_apply` from the conversation updates the tab.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { buildViewerHtml, EDITOR_ORIGIN, editorUrl } from './contract.ts'
import { useViewerExport } from './useViewerExport.ts'
import { tt } from './panel-helpers.ts'
import css from './drawio.module.css'

/** Address/tab shape the sidebar provides through the injected hook. */
interface TabInfoLike {
  tab?: {
    visible?: boolean
    navigation?: { address?: string }
  }
}

/** Body props supplied by the sidebar tab slot. */
export interface SidebarDiagramProps {
  sessionId?: string
  useTabInfo?: () => TabInfoLike
}

/** Parsed dsh-resource/file address. */
interface ResolvedAddress {
  sessionId?: string
  path: string
}

/** File name of a workspace path. */
function baseName(path: string): string {
  const parts = path.split(/[\\/]/u)
  return parts[parts.length - 1] || 'diagram.drawio'
}

/**
 * Turn a tab address into a workspace-relative path (plus session when known).
 * Supports the documented `dsh-resource://file/session/<id>/<rel>` form and the
 * direct `dsh-resource://file/<rel>` / absolute-file fallbacks.
 * @param address - tab address.
 * @param fallbackSession - session id from the slot props.
 * @returns parsed address, or undefined when it is not a workspace file.
 */
export function resolveTabAddress(address: string | undefined, fallbackSession?: string): ResolvedAddress | undefined {
  if (address === undefined || address === '') return undefined
  const sessionMatch = /^dsh-resource:\/\/file\/session\/([^/]+)\/(.+)$/u.exec(address)
  if (sessionMatch !== null) {
    try {
      return { sessionId: sessionMatch[1], path: decodeURIComponent(sessionMatch[2]) }
    } catch {
      return undefined
    }
  }
  const fileMatch = /^dsh-resource:\/\/file\/(.+)$/u.exec(address)
  if (fileMatch !== null) {
    try {
      return { ...(fallbackSession === undefined ? {} : { sessionId: fallbackSession }), path: decodeURIComponent(fileMatch[1]) }
    } catch {
      return undefined
    }
  }
  return undefined
}

/** How often the tab re-reads the file (ms). */
const POLL_MS = 3000

/** The sidebar viewer. */
export function SidebarDiagram({ sessionId: propSession, useTabInfo }: SidebarDiagramProps): React.JSX.Element {
  const info = typeof useTabInfo === 'function' ? useTabInfo() : undefined
  const address = info?.tab?.navigation?.address
  const visible = info?.tab?.visible ?? true
  const resolved = useMemo(() => resolveTabAddress(address, propSession), [address, propSession])
  const [xml, setXml] = useState<string | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [notice, setNotice] = useState<string | undefined>(undefined)
  const [tick, setTick] = useState(0)
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const viewerExport = useViewerExport(frameRef, () => (resolved === undefined ? 'diagram' : baseName(resolved.path)), setNotice)

  useEffect(() => {
    if (resolved === undefined || resolved.sessionId === undefined) {
      setError(tt('sidebar.noSession'))
      return
    }
    let cancelled = false
    const load = async (): Promise<void> => {
      try {
        const url = `/api/dsh-drawio-chat/open?session=${encodeURIComponent(resolved.sessionId!)}&path=${encodeURIComponent(resolved.path)}`
        const response = await fetch(url, { cache: 'no-store' })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const text = await response.text()
        if (!cancelled) { setXml(text); setError(undefined) }
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught))
      }
    }
    void load()
    if (!visible) return () => { cancelled = true }
    const timer = setInterval(() => { void load() }, POLL_MS)
    return () => { cancelled = true; clearInterval(timer) }
  }, [resolved, visible, tick])

  const viewerHtml = useMemo(() => {
    if (xml === undefined) return undefined
    try {
      return buildViewerHtml(xml)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
      return undefined
    }
  }, [xml])

  const download = (): void => {
    if (xml === undefined || resolved === undefined) return
    const anchor = document.createElement('a')
    anchor.href = URL.createObjectURL(new Blob([xml], { type: 'application/xml' }))
    anchor.download = baseName(resolved.path)
    anchor.click()
    setTimeout(() => { URL.revokeObjectURL(anchor.href) }, 1000)
  }

  const open = (): void => {
    if (xml === undefined) return
    editorUrl(xml)
      .then((url) => { window.open(url, '_blank', 'noopener,noreferrer') })
      .catch(() => { window.open(EDITOR_ORIGIN, '_blank', 'noopener,noreferrer') })
  }

  const name = resolved === undefined ? 'draw.io' : baseName(resolved.path)

  return (
    <div className={css.sidebarBody} data-dsh-part="drawio-sidebar">
      <div className={css.sidebarBar}>
        <span className={css.sidebarName} title={resolved?.path}>{name}</span>
        <span className={css.spacer} />
        <button type="button" className={css.action} onClick={() => { setTick(value => value + 1) }}>{tt('sidebar.refresh')}</button>
        {xml !== undefined && (
          <>
            <button type="button" className={css.action} onClick={download}>{tt('drawio.download')}</button>
            <button type="button" className={css.action} onClick={viewerExport.exportSvg}>{tt('drawio.exportSvg')}</button>
            <button type="button" className={css.action} onClick={viewerExport.exportPng}>{tt('drawio.exportPng')}</button>
            <button type="button" className={css.action} onClick={open}>{tt('drawio.openInDrawio')}</button>
          </>
        )}
      </div>
      {notice !== undefined && <p className={css.error}>{notice}</p>}
      {error !== undefined && <p className={css.error}>{tt('sidebar.loadFailed', { error })}</p>}
      {xml === undefined && error === undefined && <p className={css.status}>{tt('sidebar.loading')}</p>}
      {viewerHtml !== undefined && (
        <iframe
          ref={frameRef}
          className={css.sidebarFrame}
          title={name}
          srcDoc={viewerHtml}
          sandbox="allow-scripts allow-popups"
          referrerPolicy="no-referrer"
        />
      )}
    </div>
  )
}
