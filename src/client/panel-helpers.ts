/**
 * Tiny translate helper for the card: picks the active dictionary from the
 * document language, with a {name} interpolator for template values.
 */
import { en, zh, type DrawioKey } from './locales.ts'

/** Template values accepted by the interpolator. */
export type TranslateValues = Record<string, string | number>

/** Translate a key with optional template params (current document language). */
export function tt(key: DrawioKey, values?: TranslateValues): string {
  const lang = typeof document !== 'undefined' ? document.documentElement.lang : 'zh'
  const dictionary: Record<string, string> = lang.toLowerCase().startsWith('en') ? en : zh
  let text = dictionary[key] ?? key
  if (values !== undefined) {
    for (const [name, value] of Object.entries(values)) text = text.replaceAll(`{${name}}`, String(value))
  }
  return text
}
