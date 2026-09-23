import { describe, expect, it } from 'vitest'
import { isPlayable } from './status'

/**
 * Story 103: `isPlayable` is the far end of the severity seam the inspector sits at - a check's
 * severity becomes an `InstallationStatus` (`statusFrom`, `src/main/services/inspector.ts`) and the
 * status decides whether Play is enabled in the library row, the rail and the action bar. The
 * `executable-runnable` check is deliberately `warn` rather than `error` so a Windows build on Linux
 * can still be launched once a runner is chosen; this pins the half of that seam that lives here.
 */
describe('isPlayable', () => {
  it('accepts a warning installation, so a warn-severity check never disables Play', () => {
    expect(isPlayable('warning')).toBe(true)
  })

  it('accepts a healthy installation', () => {
    expect(isPlayable('ok')).toBe(true)
  })

  it('refuses invalid, missing and unchecked installations', () => {
    expect(isPlayable('invalid')).toBe(false)
    expect(isPlayable('missing')).toBe(false)
    expect(isPlayable('unknown')).toBe(false)
  })
})
