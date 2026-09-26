import { describe, expect, it } from 'vitest'
import {
  formatLauncherInstallId,
  LAUNCHER_INSTALL_ID_PATTERN,
  normalizeLauncherInstallId,
  UNLOCK_REJECTIONS,
} from './unlock'

describe('launcher installation id', () => {
  it('an installation id is 12 base32 characters shown as XXXX-XXXX-XXXX', () => {
    expect(formatLauncherInstallId('ABCDEFGHJK23')).toBe('ABCD-EFGH-JK23')

    // Typed or pasted forms normalise to the canonical ungrouped id.
    for (const input of ['ABCDEFGHJK23', 'ABCD-EFGH-JK23', 'abcd-efgh-jk23', '  AbCd EfGh\tJk23 \n', 'ab-cd-ef-gh-jk-23']) {
      expect(normalizeLauncherInstallId(input), input).toBe('ABCDEFGHJK23')
    }
    const id = normalizeLauncherInstallId('abcd-efgh-jk23')
    expect(id !== null && LAUNCHER_INSTALL_ID_PATTERN.test(id)).toBe(true)
    expect(formatLauncherInstallId(normalizeLauncherInstallId('abcdefghjk23') ?? '')).toBe('ABCD-EFGH-JK23')

    // Not base32 (0, 1, 8, 9 are outside the alphabet), wrong length, non-ASCII look-alikes.
    for (const input of ['', 'ABCD-EFGH-JK2', 'ABCD-EFGH-JK234', 'ABCD-EFGH-JK01', 'ABCD-EFGH-JK89', 'ABCD_EFGH_JK23', 'ABCDEFGHIJß', 'ABCDEFGHJKĲ']) {
      expect(normalizeLauncherInstallId(input), input).toBeNull()
    }
  })

  it('lists every rejection reason once', () => {
    expect(new Set(UNLOCK_REJECTIONS).size).toBe(5)
    expect(UNLOCK_REJECTIONS).toEqual([
      'malformed',
      'badSignature',
      'wrongInstallation',
      'redemptionWindowElapsed',
      'featureExpired',
    ])
  })
})
