/**
 * Browser half of the draw.io inline plugin.
 *
 * Registers the locale dictionaries and the custom tool view for
 * `drawio_diagram`. The view renders the diagram through the public draw.io
 * viewer inside a sandboxed iframe and offers download / open-in-draw.io.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the ctx.slots merge and the locale namespace table.
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { createElement } from 'react'
import { DrawioCallView } from './DrawioCallView.tsx'
import { DrawioFileCard, type FileCardMode } from './DrawioFileCard.tsx'
import { TOOL_NAME } from './contract.ts'
import { en, zh, type DrawioKey } from './locales.ts'

/** Locale namespace this plugin owns. */
const NS = 'dsh-drawio-chat'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** draw.io inline surface copy. */
    'dsh-drawio-chat': DrawioKey
  }
}

/** Required services (the runtime must be up first). */
export const inject = ['locale', 'slots']

/** Structural view of the slot registry service. */
interface SlotRegistryFace {
  inject: (name: string, callback: () => () => void) => () => void
  register: (options: { name: string; key: string }, component: unknown) => () => void
}

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
  }, 'drawio-chat: dictionaries')

  ctx.effect(() => {
    try {
      const slots = (ctx as unknown as { slots: SlotRegistryFace }).slots
      const disposers: Array<() => void> = []
      const register = (key: string, component: unknown): void => {
        disposers.push(slots.inject('tool.call.toolview', () => slots.register({ name: 'tool.call.toolview', key }, component)))
      }
      register(TOOL_NAME, DrawioCallView)
      const fileCard = (mode: FileCardMode) => (props: { phase?: 'preparing' | 'start' | 'result'; block?: unknown }) =>
        createElement(DrawioFileCard, { mode, phase: props.phase, block: props.block as never })
      register('drawio_read', fileCard('read'))
      register('drawio_apply', fileCard('apply'))
      register('drawio_undo', fileCard('undo'))
      return () => { for (const dispose of disposers) dispose() }
    } catch (error) {
      // Registration problems degrade the card to the generic tool row.
      console.warn('[drawio-chat] tool view registration failed:', error)
      return () => {}
    }
  }, 'drawio-chat: tool views')
}
