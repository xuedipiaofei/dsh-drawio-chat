/**
 * Browser half of the draw.io inline plugin (skeleton).
 *
 * Registers the plugin's locale dictionaries. The custom tool view for
 * `drawio_diagram` and the sandboxed local viewer mount are the next step.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the sentence-table merge for the locale namespace.
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { en, zh, type DrawioKey } from './locales.ts'

/** Locale namespace this plugin owns. */
const NS = 'dsh-drawio-inline'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** draw.io inline surface copy. */
    'dsh-drawio-inline': DrawioKey
  }
}

/** Required services (the runtime must be up first). */
export const inject = ['locale']

/**
 * Mount the draw.io inline surfaces.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    try {
      return ctx.locale.register(NS, { zh, en })
    } catch {
      // A locale failure must not take the whole web shell down.
      return () => {}
    }
  }, 'drawio-inline: dictionaries')
}
