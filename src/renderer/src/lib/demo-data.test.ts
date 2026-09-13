import { describe, expect, it } from 'vitest'
import type { ValidationCheck } from '@shared/types'
import { isDemoData } from './demo-data'

/**
 * Story 074 D7: the Demo marker's truth source is the inspector's
 * `validation.pak0NotRetail` check - present exactly when `pak0.pak` isn't
 * retail-sized. These guard the derivation itself (exact match, not a
 * substring/loose one) so the marker never appears for the wrong reason.
 */

function check(messageKey: string, overrides: Partial<ValidationCheck> = {}): ValidationCheck {
  return { id: 'base-paks', severity: 'warn', messageKey, ...overrides }
}

describe('isDemoData', () => {
  it('is true when validation.pak0NotRetail is present', () => {
    expect(isDemoData([check('validation.pak0NotRetail')])).toBe(true)
  })

  it('is false for an empty checks list', () => {
    expect(isDemoData([])).toBe(false)
  })

  it('is false when checks has only unrelated entries', () => {
    expect(
      isDemoData([check('validation.rootExists'), check('validation.executableMissing')]),
    ).toBe(false)
  })

  it('is false for a similarly-named but different key - exact match, not a substring one', () => {
    expect(isDemoData([check('validation.pak0NotRetailButPaksPresent')])).toBe(false)
    expect(isDemoData([check('validation.pak0MissingButPaksPresent')])).toBe(false)
  })

  it('is true alongside other unrelated checks', () => {
    expect(
      isDemoData([check('validation.rootExists'), check('validation.pak0NotRetail')]),
    ).toBe(true)
  })
})
