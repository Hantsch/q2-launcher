import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_DOWNLOADS_SETTINGS } from '@shared/modules/downloads'
import { StateStore } from './state'

describe('StateStore downloads settings (story 072 D2)', () => {
  let filePath: string
  let state: StateStore

  beforeEach(async () => {
    filePath = join(tmpdir(), `q2-launcher-state-downloads-${randomUUID()}.json`)
    state = new StateStore(filePath)
    await state.load()
  })

  afterEach(async () => {
    await rm(filePath, { force: true })
    await rm(`${filePath}.tmp`, { force: true })
    await rm(`${filePath}.bak`, { force: true })
  })

  it('starts with the defaults', () => {
    expect(state.getDownloadsSettings()).toEqual(DEFAULT_DOWNLOADS_SETTINGS)
  })

  it('downloads settings survive a reload', async () => {
    const written = state.setDownloadsSettings({
      concurrentJobs: 4,
      archiveCacheBudgetGB: 10,
      downloadWhilePlayingAllowed: false,
    })
    await state.settle()

    const reloaded = new StateStore(filePath)
    await reloaded.load()

    expect(reloaded.getDownloadsSettings()).toEqual(written)
    expect(reloaded.getDownloadsSettings()).toEqual({
      concurrentJobs: 4,
      archiveCacheBudgetGB: 10,
      downloadWhilePlayingAllowed: false,
    })
  })

  it('a garbage archiveCacheBudgetGB falls back to its default, leaving siblings intact', async () => {
    state.setDownloadsSettings({
      concurrentJobs: 4,
      archiveCacheBudgetGB: 999 as never, // out of ARCHIVE_CACHE_BUDGET_CHOICES_GB on purpose
      downloadWhilePlayingAllowed: false,
    })
    await state.settle()

    const reloaded = new StateStore(filePath)
    await reloaded.load()

    const settings = reloaded.getDownloadsSettings()
    // Only the corrupt field falls back - its valid siblings are preserved.
    expect(settings.archiveCacheBudgetGB).toBe(DEFAULT_DOWNLOADS_SETTINGS.archiveCacheBudgetGB)
    expect(settings.concurrentJobs).toBe(4)
    expect(settings.downloadWhilePlayingAllowed).toBe(false)
  })

  it('a garbage downloadWhilePlayingAllowed falls back to its default, leaving siblings intact', async () => {
    state.setDownloadsSettings({
      concurrentJobs: 3,
      archiveCacheBudgetGB: 20,
      downloadWhilePlayingAllowed: 'yes' as never, // not a boolean, on purpose
    })
    await state.settle()

    const reloaded = new StateStore(filePath)
    await reloaded.load()

    const settings = reloaded.getDownloadsSettings()
    expect(settings.downloadWhilePlayingAllowed).toBe(
      DEFAULT_DOWNLOADS_SETTINGS.downloadWhilePlayingAllowed,
    )
    expect(settings.concurrentJobs).toBe(3)
    expect(settings.archiveCacheBudgetGB).toBe(20)
  })
})
