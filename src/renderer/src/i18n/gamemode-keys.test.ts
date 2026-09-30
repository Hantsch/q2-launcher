import { describe, expect, it } from 'vitest'
import en from './locales/en.json'
import { GAMEMODE_I18N_KEYS } from '../../../shared/demos/gamemode'

/**
 * Every key `describeGamemode`/`GAMEMODE_I18N_KEYS` can produce must resolve to visible text in
 * `en.json` — the single source of every user-visible string (docs/ARCHITECTURE.md).
 */

function stringAt(path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>((acc, key) => (acc && typeof acc === 'object' && key in acc ? (acc as Record<string, unknown>)[key] : undefined), en)
}

describe('gamemode i18n keys', () => {
  it('every gamemode key has visible text', () => {
    for (const key of GAMEMODE_I18N_KEYS) {
      const value = stringAt(key)
      expect(typeof value).toBe('string')
      expect((value as string).trim()).not.toBe('')
    }
  })
})
