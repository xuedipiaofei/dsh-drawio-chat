/** Client apply: dictionaries register once and failures stay contained. */
import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/client/index.ts'

function fakeClient(register: () => (() => void)): { ctx: never; register: ReturnType<typeof vi.fn> } {
  const spy = vi.fn(register)
  const ctx = {
    locale: { register: spy },
    effect: (fn: () => unknown) => { const dispose = fn(); return dispose },
  } as never
  return { ctx, register: spy }
}

describe('client apply', () => {
  it('registers the locale dictionaries', () => {
    const { ctx, register } = fakeClient(() => () => {})
    apply(ctx)
    expect(register).toHaveBeenCalledWith('dsh-drawio-inline', expect.objectContaining({ zh: expect.any(Object), en: expect.any(Object) }))
  })

  it('does not throw when the locale service refuses', () => {
    const { ctx } = fakeClient(() => { throw new Error('busy') })
    expect(() => apply(ctx)).not.toThrow()
  })
})
