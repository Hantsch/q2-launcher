import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type LauncherSettings } from '../types'
import { ARCHIVE_CACHE_BUDGET_CHOICES_GB, DEFAULT_DOWNLOADS_SETTINGS } from './downloads'

describe('downloads module contract (story 072 D2)', () => {
  it('DEFAULT_DOWNLOADS_SETTINGS carries the documented defaults', () => {
    expect(DEFAULT_DOWNLOADS_SETTINGS).toEqual({
      concurrentJobs: 2,
      archiveCacheBudgetGB: 5,
      downloadWhilePlayingAllowed: true,
    })
  })

  it('lists exactly the allowed archive-cache budget choices, in GB', () => {
    expect(ARCHIVE_CACHE_BUDGET_CHOICES_GB).toEqual([1, 2, 5, 10, 20])
  })

  it('downloads settings live outside LauncherSettings', () => {
    // The downloads module's settings are their own top-level `state.json` key
    // (`downloads`, `main/services/state.ts`), never merged into the shell's own
    // `LauncherSettings` shape - a module contributing settings must not be able to widen the
    // shell's closed settings type.
    const downloadsKeys = Object.keys(DEFAULT_DOWNLOADS_SETTINGS)
    const launcherSettingsKeys: (keyof LauncherSettings)[] = Object.keys(
      DEFAULT_SETTINGS,
    ) as (keyof LauncherSettings)[]

    for (const key of downloadsKeys) {
      expect(launcherSettingsKeys).not.toContain(key)
    }
  })
})
