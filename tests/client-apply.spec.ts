/** Client apply: dictionaries and the custom tool view register; failures stay contained. */
import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/client/index.ts'

function fakeClient(options: { localeFails?: boolean; slotsFail?: boolean } = {}) {
  const localeRegister = vi.fn(() => { if (options.localeFails === true) throw new Error('busy'); return () => {} })
  const slotRegister = vi.fn(() => { if (options.slotsFail === true) throw new Error('busy'); return () => {} })
  const ctx = {
    locale: { register: localeRegister },
    slots: {
      inject: (_name: string, callback: () => () => void) => callback(),
      register: slotRegister,
    },
    effect: (fn: () => unknown) => fn(),
  } as never
  return { ctx, localeRegister, slotRegister }
}

describe('client apply', () => {
  it('registers the locale dictionaries and the tool view', () => {
    const client = fakeClient()
    apply(client.ctx)
    expect(client.localeRegister).toHaveBeenCalledWith('dsh-drawio-inline', expect.objectContaining({ zh: expect.any(Object), en: expect.any(Object) }))
    expect(client.slotRegister).toHaveBeenCalledWith({ name: 'tool.call.toolview', key: 'drawio_diagram' }, expect.anything())
  })

  it('contains locale and slot failures', () => {
    expect(() => apply(fakeClient({ localeFails: true, slotsFail: true }).ctx)).not.toThrow()
  })
})
