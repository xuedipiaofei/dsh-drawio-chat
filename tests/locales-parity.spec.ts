/** zh/en key, value and placeholder parity for the surface copy. */
import { describe, expect, it } from 'vitest'
import { en, zh } from '../src/client/locales.ts'

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{(\w+)\}/gu)].map(match => match[1]).sort()
}

describe('locale dictionaries', () => {
  it('same keys, non-empty values, same placeholders', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
    for (const key of Object.keys(zh) as Array<keyof typeof zh>) {
      expect(en[key].trim()).not.toBe('')
      expect(zh[key].trim()).not.toBe('')
      expect(placeholders(en[key])).toEqual(placeholders(zh[key]))
    }
  })
})
