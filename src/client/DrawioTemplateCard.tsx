/**
 * Tool view for `drawio_template`.
 *
 * The tool has two result shapes:
 * - it instantiated a template → render the created file with the same
 *   file-backed viewer as `drawio_read` (the file card fetches it back from the
 *   plugin's loopback-only preview route, so XML never rides the session log);
 * - it only listed/searched the catalog → render the model-facing list text in
 *   a compact, scrollable block.
 */
import { useMemo } from 'react'
import { DrawioFileCard } from './DrawioFileCard.tsx'
import { tt } from './panel-helpers.ts'
import css from './drawio.module.css'

/** Result metadata written by the template tool. */
interface TemplateCardMeta {
  action?: 'listed' | 'created'
  title?: string
  path?: string
  revision?: string
  templateId?: string
}

/** Props accepted from the `tool.call.toolview` slot (subset we use). */
interface DrawioTemplateCardProps {
  phase?: 'preparing' | 'start' | 'result'
  block?: {
    args?: unknown
    meta?: unknown
    content?: readonly { type: string; text?: string }[]
    isError?: boolean
  }
}

/** The template tool card. */
export function DrawioTemplateCard({ phase, block }: DrawioTemplateCardProps): React.JSX.Element {
  const meta = useMemo<TemplateCardMeta>(() => {
    const raw = block?.meta
    return raw !== null && typeof raw === 'object' ? raw as TemplateCardMeta : {}
  }, [block?.meta])
  if (typeof meta.path === 'string' && meta.path !== '') {
    return <DrawioFileCard mode="template" phase={phase} block={block} />
  }
  const text = (block?.content ?? [])
    .filter(part => part.type === 'text' && typeof part.text === 'string')
    .map(part => part.text)
    .join('\n')
  return (
    <div className={css.card} data-dsh-part="drawio-template-card">
      <div className={css.head}>
        <span className={css.title}>{tt('drawio.templateCatalog')}</span>
        {typeof meta.title === 'string' && meta.title !== '' && <span className={css.subtitle}>{meta.title}</span>}
      </div>
      {text === '' ? <p className={css.status}>{tt('drawio.rendering')}</p> : <pre className={css.listText}>{text}</pre>}
    </div>
  )
}
