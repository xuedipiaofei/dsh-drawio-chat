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
import { BETTER_SIDEBAR_VIEWER } from './BetterSidebarViewer.tsx'
import { DrawioCallView } from './DrawioCallView.tsx'
import { DrawioFileCard, type FileCardMode } from './DrawioFileCard.tsx'
import { DrawioTemplateCard } from './DrawioTemplateCard.tsx'
import { SidebarDiagram } from './SidebarDiagram.tsx'
import { TEMPLATE_TOOL_NAME, TOOL_NAME } from './contract.ts'
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
export const inject = ['locale', 'slots', 'sidebarRightTabs']

/** Identity of the sidebar tab implementation. */
export const SIDEBAR_TAB_ID = 'dsh-drawio-chat/viewer'

/** Sidebar tab kind served by this plugin (claims *.drawio files). */
export const SIDEBAR_TAB_KIND = 'drawio-chat-diagram'

/**
 * Address patterns the sidebar viewer claims.
 *
 * The tab-type registry ranks claimants by priority band, then by the LENGTH
 * of the pattern that matched, then by registration order. `dsh-better-sidebar`
 * claims every workspace file with a whole-tree glob (22 chars) in the same
 * `extension` band, so the old basename pattern for this extension (13 chars)
 * lost the claim: the file then opened in that plugin's editable text editor,
 * i.e. as raw XML. The longer whole-address glob below (31 chars) matches the
 * same addresses and wins the ranking, so the draw.io viewer keeps its files —
 * better-sidebar's file tree probes `sidebarRightTabs.candidates()` and routes
 * the open to this native tab instead of its own editor. The basename pattern
 * stays as a fallback for addresses the longer glob does not match.
 */
export const SIDEBAR_PATTERNS: readonly string[] = ['dsh-resource://file/**/*.drawio', '*.drawio']

/** Structural view of the sidebar tab registry service. */
interface SidebarTabRegistryFace {
  register: (definition: Record<string, unknown>) => () => void
}

/** Structural view of the slot registry service. */
interface SlotRegistryFace {
  inject: (name: string, callback: () => () => void) => () => void
  register: (options: { name: string; key: string }, component: unknown) => () => void
}

/** Structural view of the optional dsh-better-sidebar service. */
interface BetterSidebarFace {
  registerFileViewer: (descriptor: Record<string, unknown>) => () => void
}

/** Structural view of the cordis injection helper used for optional services. */
interface InjectFace {
  inject?: (dependencies: string[], callback: (injected: { get: (name: string) => unknown }) => unknown) => (() => void) | undefined
}

/**
 * Register the draw.io canvas as a better-sidebar file viewer when that plugin
 * is installed.
 *
 * Optional on purpose: `ctx.inject` waits for the service and does nothing when
 * dsh-better-sidebar is absent, so no hard dependency is added. The viewer makes
 * `*.drawio` default to the canvas in better-sidebar's editor (docked panes,
 * floating panes and the bottom workbench all render the same component) while
 * the editor's viewer dropdown keeps the code editor available.
 * @param ctx - client context.
 * @returns an effect that disposes the registration (or nothing).
 */
function registerBetterSidebarViewer(ctx: ClientContext): () => void {
  const face = ctx as unknown as InjectFace
  if (typeof face.inject !== 'function') return () => {}
  try {
    const dispose = face.inject(['betterSidebar'], (injected) => {
      const service = injected.get('betterSidebar') as BetterSidebarFace | undefined
      if (service === undefined || typeof service.registerFileViewer !== 'function') return undefined
      return service.registerFileViewer(BETTER_SIDEBAR_VIEWER as unknown as Record<string, unknown>)
    })
    return typeof dispose === 'function' ? dispose : () => {}
  } catch (error) {
    // A broken/missing service must never take the draw.io surfaces down.
    console.warn('[drawio-chat] better-sidebar viewer registration failed:', error)
    return () => {}
  }
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

  // Sidebar tab: without this the built-in text preview opens the raw XML.
  ctx.effect(() => {
    try {
      const tabs = (ctx as unknown as { sidebarRightTabs: SidebarTabRegistryFace }).sidebarRightTabs
      const slots = (ctx as unknown as { slots: SlotRegistryFace }).slots
      const disposers: Array<() => void> = [
        tabs.register({
          id: SIDEBAR_TAB_ID,
          kind: SIDEBAR_TAB_KIND,
          patterns: [...SIDEBAR_PATTERNS],
          priority: 'extension',
          title: (address: string) => {
            const parts = address.split('/')
            const last = parts[parts.length - 1] ?? ''
            try { return decodeURIComponent(last) || 'draw.io' } catch { return last || 'draw.io' }
          },
        }),
        slots.inject('sidebar.right.pane.tab', () => slots.register({ name: 'sidebar.right.pane.tab', key: SIDEBAR_TAB_ID }, SidebarDiagram)),
      ]
      return () => { for (const dispose of disposers) dispose() }
    } catch (error) {
      console.warn('[drawio-chat] sidebar tab registration failed:', error)
      return () => {}
    }
  }, 'drawio-chat: sidebar tab')

  ctx.effect(() => registerBetterSidebarViewer(ctx), 'drawio-chat: better-sidebar viewer')

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
      // The template tool renders either the instantiated diagram (file card)
      // or the catalog listing text, so it gets its own small card.
      register(TEMPLATE_TOOL_NAME, DrawioTemplateCard)
      return () => { for (const dispose of disposers) dispose() }
    } catch (error) {
      // Registration problems degrade the card to the generic tool row.
      console.warn('[drawio-chat] tool view registration failed:', error)
      return () => {}
    }
  }, 'drawio-chat: tool views')
}
