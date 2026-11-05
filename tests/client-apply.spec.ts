/** Client apply: dictionaries and the custom tool view register; failures stay contained. */
import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/client/index.ts'

function fakeClient(options: { localeFails?: boolean; slotsFail?: boolean; tabsFail?: boolean } = {}) {
  const localeRegister = vi.fn(() => { if (options.localeFails === true) throw new Error('busy'); return () => {} })
  const slotRegister = vi.fn((..._args: unknown[]) => { if (options.slotsFail === true) throw new Error('busy'); return () => {} })
  const tabRegister = vi.fn((_definition: Record<string, unknown>) => { if (options.tabsFail === true) throw new Error('busy'); return () => {} })
  const ctx = {
    locale: { register: localeRegister },
    slots: {
      inject: (_name: string, callback: () => () => void) => callback(),
      register: slotRegister,
    },
    sidebarRightTabs: { register: tabRegister },
    effect: (fn: () => unknown) => fn(),
  } as never
  return { ctx, localeRegister, slotRegister, tabRegister }
}

describe('client apply', () => {
  it('registers the locale dictionaries and all four tool views', () => {
    const client = fakeClient()
    apply(client.ctx)
    expect(client.localeRegister).toHaveBeenCalledWith('dsh-drawio-chat', expect.objectContaining({ zh: expect.any(Object), en: expect.any(Object) }))
    expect(client.slotRegister.mock.calls.map(call => call[0])).toEqual([
      { name: 'sidebar.right.pane.tab', key: 'dsh-drawio-chat/viewer' },
      { name: 'tool.call.toolview', key: 'drawio_create' },
      { name: 'tool.call.toolview', key: 'drawio_read' },
      { name: 'tool.call.toolview', key: 'drawio_apply' },
      { name: 'tool.call.toolview', key: 'drawio_undo' },
    ])
    expect(client.tabRegister).toHaveBeenCalledWith(expect.objectContaining({
      id: 'dsh-drawio-chat/viewer',
      kind: 'drawio-chat-diagram',
      patterns: ['**/*.drawio'],
      priority: 'extension',
    }))
  })

  it('contains locale and slot failures', () => {
    expect(() => apply(fakeClient({ localeFails: true, slotsFail: true, tabsFail: true }).ctx)).not.toThrow()
  })
})
