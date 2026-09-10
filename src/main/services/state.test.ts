import { randomUUID } from 'node:crypto'
import { rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_DOWNLOADS_SETTINGS, type DownloadFailure } from '@shared/modules/downloads'
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

describe('StateStore downloadFailures (story 073 D1)', () => {
  let filePath: string
  let state: StateStore

  beforeEach(async () => {
    filePath = join(tmpdir(), `q2-launcher-state-download-failures-${randomUUID()}.json`)
    state = new StateStore(filePath)
    await state.load()
  })

  afterEach(async () => {
    await rm(filePath, { force: true })
    await rm(`${filePath}.tmp`, { force: true })
    await rm(`${filePath}.bak`, { force: true })
  })

  function failure(overrides: Partial<DownloadFailure> = {}): DownloadFailure {
    return {
      id: randomUUID(),
      jobId: randomUUID(),
      labelKey: 'downloads.job.engine',
      error: { key: 'downloads.error.network' },
      createdAt: Date.now(),
      ...overrides,
    }
  }

  it('starts empty', () => {
    expect(state.getDownloadFailures()).toEqual([])
  })

  it('downloadFailures round-trips through state.json', async () => {
    const written = state.setDownloadFailures([
      failure({ jobId: 'job-1', installationId: 'inst-1' }),
      failure({ jobId: 'job-2' }),
    ])
    await state.settle()

    const reloaded = new StateStore(filePath)
    await reloaded.load()

    expect(reloaded.getDownloadFailures()).toEqual(written)
  })

  it('a garbage entry is dropped row-wise instead of taking the file', async () => {
    // Write state.json by hand with one valid entry and one entry missing everything meaningful.
    const good = failure({ jobId: 'job-good' })
    await writeFile(
      filePath,
      JSON.stringify({
        schemaVersion: 1,
        settings: {},
        installations: [],
        configProfiles: [],
        configPlayedMods: {},
        // Retired by story 079 D4 and deliberately still written here: the read side stays
        // forgiving, so a `state.json` from before that story loads with the key simply ignored.
        configPendingWrites: {},
        configSwitchBinds: {},
        configWriteFailures: {},
        configFileSourceMigratedAt: null,
        downloads: {},
        downloadFailures: [good, { garbage: true }],
      }),
      'utf-8',
    )

    const reloaded = new StateStore(filePath)
    await reloaded.load()

    // The whole file survived (installations/settings still readable) and only the garbage row is
    // gone - the good entry, and the rest of the document, are untouched.
    expect(reloaded.getDownloadFailures()).toEqual([good])
    expect(reloaded.installations()).toEqual([])
  })

  it('an entry with dismissedAt older than 7 days does not survive a reload', async () => {
    const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000
    state.setDownloadFailures([
      failure({ jobId: 'old-dismissed', dismissedAt: eightDaysAgo }),
      failure({ jobId: 'still-here' }),
    ])
    await state.settle()

    const reloaded = new StateStore(filePath)
    await reloaded.load()

    const jobIds = reloaded.getDownloadFailures().map((entry) => entry.jobId)
    expect(jobIds).toEqual(['still-here'])
  })
})
