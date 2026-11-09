/** Client apply: dictionaries and the custom tool view register; failures stay contained. */
import { describe, expect, it, vi } from 'vitest'
import { apply, SIDEBAR_PATTERNS } from '../src/client/index.ts'

function fakeClient(options: { localeFails?: boolean; slotsFail?: boolean; tabsFail?: boolean; betterSidebar?: boolean } = {}) {
  const localeRegister = vi.fn(() => { if (options.localeFails === true) throw new Error('busy'); return () => {} })
  const slotRegister = vi.fn((..._args: unknown[]) => { if (options.slotsFail === true) throw new Error('busy'); return () => {} })
  const tabRegister = vi.fn((_definition: Record<string, unknown>) => { if (options.tabsFail === true) throw new Error('busy'); return () => {} })
  const fileViewerRegister = vi.fn((_descriptor: Record<string, unknown>) => () => {})
  const ctx = {
    locale: { register: localeRegister },
    slots: {
      inject: (_name: string, callback: () => () => void) => callback(),
      register: slotRegister,
    },
    sidebarRightTabs: { register: tabRegister },
    // Mirrors cordis: the callback runs only once the optional service exists.
    inject: (dependencies: string[], callback: (injected: { get: (name: string) => unknown }) => unknown) => {
      expect(dependencies).toEqual(['betterSidebar'])
      if (options.betterSidebar === true) {
        callback({ get: (name: string) => name === 'betterSidebar' ? { registerFileViewer: fileViewerRegister } : undefined })
      }
      return () => {}
    },
    effect: (fn: () => unknown) => fn(),
  } as never
  return { ctx, localeRegister, slotRegister, tabRegister, fileViewerRegister }
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
      { name: 'tool.call.toolview', key: 'drawio_template' },
    ])
    expect(client.tabRegister).toHaveBeenCalledWith(expect.objectContaining({
      id: 'dsh-drawio-chat/viewer',
      kind: 'drawio-chat-diagram',
      patterns: [...SIDEBAR_PATTERNS],
      priority: 'extension',
    }))
  })

  it('claims *.drawio ahead of a catch-all file viewer', () => {
    // The registry ranks claimants by band, then by matched-pattern length:
    // the whole-address glob must outrank dsh-better-sidebar's
    // `dsh-resource://file/**` (22 chars) or the file opens as raw XML there.
    const wholeAddress = SIDEBAR_PATTERNS.find(pattern => pattern.startsWith('dsh-resource://')) ?? ''
    expect(wholeAddress.length).toBeGreaterThan('dsh-resource://file/**'.length)
    expect(wholeAddress.endsWith('*.drawio')).toBe(true)
  })

  it('registers the draw.io canvas as an optional better-sidebar file viewer', () => {
    const withSidebar = fakeClient({ betterSidebar: true })
    apply(withSidebar.ctx)
    expect(withSidebar.fileViewerRegister).toHaveBeenCalledTimes(1)
    const descriptor = withSidebar.fileViewerRegister.mock.calls[0]![0] as { id: string; exts: string[]; priority: number; fetchStrategy: string; component: unknown }
    expect(descriptor).toMatchObject({
      id: 'dsh-drawio-chat:canvas',
      exts: ['drawio'],
      fetchStrategy: 'fsRead',
      component: expect.any(Function),
    })
    // A positive priority makes the canvas the default *.drawio viewer while
    // leaving better-sidebar's own viewers untouched for other extensions.
    expect(descriptor.priority).toBeGreaterThan(0)
    // Without dsh-better-sidebar the plugin still applies and registers nothing.
    const withoutSidebar = fakeClient()
    expect(() => apply(withoutSidebar.ctx)).not.toThrow()
    expect(withoutSidebar.fileViewerRegister).not.toHaveBeenCalled()
  })

  it('contains locale and slot failures', () => {
    expect(() => apply(fakeClient({ localeFails: true, slotsFail: true, tabsFail: true }).ctx)).not.toThrow()
  })
})
