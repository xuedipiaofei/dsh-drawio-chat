/**
 * draw.io canvas as a `dsh-better-sidebar` file viewer.
 *
 * Registered through `ctx.betterSidebar.registerFileViewer` when that plugin
 * is installed — the registration is optional and adds nothing when it is not.
 * Because a file viewer is the plugin's own extension point:
 * - the canvas becomes the DEFAULT preview for `*.drawio` in better-sidebar's
 *   editor (its header dropdown can switch back to the code editor);
 * - the same component renders in docked panes, floating panes and the bottom
 *   workbench, so no separate bottom-panel tab has to be maintained;
 * - the host already reads the file text (`fetchStrategy: 'fsRead'`), so the
 *   canvas needs no extra route round-trip and stays in sync with the file.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { buildViewerHtml, EDITOR_ORIGIN, editorUrl } from './contract.ts'
import { tt } from './panel-helpers.ts'
import css from './drawio.module.css'

/** Identity of the better-sidebar file viewer implementation. */
export const BETTER_SIDEBAR_VIEWER_ID = 'dsh-drawio-chat:canvas'

/** Props the better-sidebar host passes to a registered file viewer. */
export interface BetterSidebarViewerProps {
  scope?: { sessionId?: string; cwd?: string }
  path?: string
  title?: string
  /** File text, delivered for `fetchStrategy: 'fsRead'`. */
  content?: string
  /** Present when the host refused to hand over an over-limit file. */
  largeFile?: { size: number }
  visible?: boolean
}

/** The draw.io canvas viewer for better-sidebar. */
export function DrawioBetterSidebarViewer({ path, title, content, largeFile }: BetterSidebarViewerProps): React.JSX.Element {
  const xml = typeof content === 'string' && content.trim() !== '' ? content : undefined
  const [viewerHtml, setViewerHtml] = useState<string | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const name = useMemo(() => {
    if (typeof title === 'string' && title !== '') return title
    const base = path?.split('/').pop()
    return base === undefined || base === '' ? 'draw.io' : base
  }, [title, path])

  useEffect(() => {
    if (xml === undefined) { setViewerHtml(undefined); return }
    try {
      setViewerHtml(buildViewerHtml(xml))
      setError(undefined)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    }
  }, [xml])

  const open = (): void => {
    if (xml === undefined) return
    editorUrl(xml)
      .then(url => { window.open(url, '_blank', 'noopener,noreferrer') })
      .catch(() => { window.open(EDITOR_ORIGIN, '_blank', 'noopener,noreferrer') })
  }

  if (xml === undefined) {
    return (
      <div className={css.sidebarBody} data-dsh-part="drawio-better-sidebar-viewer">
        <p className={css.status}>{largeFile === undefined ? tt('drawio.betterNoContent') : tt('drawio.betterTooLarge', { size: String(largeFile.size) })}</p>
      </div>
    )
  }

  return (
    <div className={css.sidebarBody} data-dsh-part="drawio-better-sidebar-viewer">
      <div className={css.sidebarBar}>
        <span className={css.sidebarName}>{name}</span>
        <span className={css.spacer} />
        <button type="button" className={css.action} onClick={open} title={tt('drawio.openInDrawio')}>{tt('drawio.openInDrawio')}</button>
      </div>
      {error !== undefined && <p className={css.error}>{tt('drawio.renderFailed', { error })}</p>}
      {error === undefined && viewerHtml === undefined && <p className={css.status}>{tt('drawio.rendering')}</p>}
      {error === undefined && viewerHtml !== undefined && (
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

/** The descriptor `registerFileViewer` receives. */
export const BETTER_SIDEBAR_VIEWER = {
  id: BETTER_SIDEBAR_VIEWER_ID,
  title: (): string => tt('drawio.betterViewer'),
  /** `[]` would be a catch-all — only claim the drawio extension. */
  exts: ['drawio'] as const,
  /**
   * Higher wins. The built-in text editor sits at 0 and its catch-all `code`
   * viewer at -100, so a positive priority makes this the default for
   * `*.drawio` while leaving every other extension untouched.
   */
  priority: 50,
  /** The host reads the file text and hands it over as `content`. */
  fetchStrategy: 'fsRead' as const,
  component: DrawioBetterSidebarViewer,
}
