import { randomUUID } from 'node:crypto'
import { access, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_DOWNLOADS_SETTINGS, type DownloadFailure } from '@shared/modules/downloads'
import type { DownloadDiagnostics } from '@shared/modules/downloads'
import { StateStore } from '../../services/state'
import { downloadsState, parseDownloadFailures, parseDownloadsSettings } from './persisted'

/**
 * Story 071 D1: the persisted `downloads` top-level `state.json` key. Mirrors
 * `parseConfigProfiles`'s "forgiving, never throws" contract - a corrupt value falls back to
 * `DEFAULT_DOWNLOADS_SETTINGS` instead of throwing.
 */
describe('parseDownloadsSettings (story 071 D1)', () => {
  it('loads defaults when the key is absent', () => {
    expect(parseDownloadsSettings(undefined)).toEqual(DEFAULT_DOWNLOADS_SETTINGS)
  })

  it('round-trips a valid, in-range concurrentJobs', () => {
    // Story 072 D2: the two sibling fields are absent from the input, so they fall back to their
    // own defaults independently of concurrentJobs - same "one bad/missing field costs only that
    // field" shape as the rest of this schema.
    expect(parseDownloadsSettings({ concurrentJobs: 4 })).toEqual({
      ...DEFAULT_DOWNLOADS_SETTINGS,
      concurrentJobs: 4,
    })
  })

  it('falls back to the default instead of throwing when concurrentJobs is not a number', () => {
    expect(() => parseDownloadsSettings({ concurrentJobs: 'nope' })).not.toThrow()
    expect(parseDownloadsSettings({ concurrentJobs: 'nope' })).toEqual(DEFAULT_DOWNLOADS_SETTINGS)
  })

  it('falls back to the default instead of throwing when concurrentJobs is out of range', () => {
    expect(parseDownloadsSettings({ concurrentJobs: 99 })).toEqual(DEFAULT_DOWNLOADS_SETTINGS)
    expect(parseDownloadsSettings({ concurrentJobs: 0 })).toEqual(DEFAULT_DOWNLOADS_SETTINGS)
  })

  it('falls back to the default instead of throwing when the whole downloads value is corrupt', () => {
    expect(() => parseDownloadsSettings('not an object')).not.toThrow()
    expect(parseDownloadsSettings('not an object')).toEqual(DEFAULT_DOWNLOADS_SETTINGS)
    expect(parseDownloadsSettings(null)).toEqual(DEFAULT_DOWNLOADS_SETTINGS)
  })

  // Story 072 D2
  it('round-trips a valid archiveCacheBudgetGB and downloadWhilePlayingAllowed', () => {
    expect(
      parseDownloadsSettings({
        concurrentJobs: 2,
        archiveCacheBudgetGB: 10,
        downloadWhilePlayingAllowed: false,
      }),
    ).toEqual({ concurrentJobs: 2, archiveCacheBudgetGB: 10, downloadWhilePlayingAllowed: false })
  })

  it('falls back to the default when archiveCacheBudgetGB is not one of the allowed choices', () => {
    expect(parseDownloadsSettings({ concurrentJobs: 2, archiveCacheBudgetGB: 999 })).toEqual({
      ...DEFAULT_DOWNLOADS_SETTINGS,
      concurrentJobs: 2,
    })
  })

  it('falls back to the default when downloadWhilePlayingAllowed is not a boolean', () => {
    expect(
      parseDownloadsSettings({ concurrentJobs: 2, downloadWhilePlayingAllowed: 'yes' }),
    ).toEqual({ ...DEFAULT_DOWNLOADS_SETTINGS, concurrentJobs: 2 })
  })
})

// Story 075 D1 (AC6).
describe('parseDownloadFailures - diagnostics (story 075 D1)', () => {
  const baseRow = {
    id: 'f1',
    jobId: 'job-1',
    labelKey: 'downloads.job.engine',
    error: { key: 'downloads.error.network' },
    createdAt: 1000,
  }

  const diagnostics: DownloadDiagnostics = {
    jobId: 'job-1',
    kind: 'bootstrap',
    startedAt: '2026-01-08T00:00:00.000Z',
    finishedAt: '2026-01-08T00:01:00.000Z',
    errorKey: 'downloads.error.installationNotPlayable',
    packages: [
      {
        id: 'demo',
        url: 'https://example.test/demo.zip',
        sizeBytes: 42,
        verified: true,
        extracted: false,
      },
    ],
    target: {
      targetPath: 'C:\\%HOME%\\Games\\Quake2',
      verdict: 'invalid',
      missingChecks: [{ id: 'base-paks', messageKey: 'installation.check.basePaks' }],
    },
    logTail: ['line 1', 'line 2'],
  }

  it('an entry without diagnostics parses unchanged (pre-story row)', () => {
    const [parsed] = parseDownloadFailures([baseRow])

    expect(parsed).toEqual(baseRow)
    expect(parsed?.diagnostics).toBeUndefined()
  })

  it('round-trips a well-formed diagnostics record', () => {
    const [parsed] = parseDownloadFailures([{ ...baseRow, diagnostics }])

    expect(parsed?.diagnostics).toEqual(diagnostics)
  })

  it('a garbage diagnostics value drops only that field, not the row', () => {
    const [parsed] = parseDownloadFailures([{ ...baseRow, diagnostics: 'not an object' }])

    expect(parsed).toBeDefined()
    expect(parsed?.id).toBe('f1')
    expect(parsed?.diagnostics).toBeUndefined()
  })

  it('a diagnostics record missing a required field drops only that field, not the row', () => {
    const { jobId: _jobId, ...malformedDiagnostics } = diagnostics
    const [parsed] = parseDownloadFailures([{ ...baseRow, diagnostics: malformedDiagnostics }])

    expect(parsed).toBeDefined()
    expect(parsed?.id).toBe('f1')
    expect(parsed?.diagnostics).toBeUndefined()
  })

  // Story 078 D1 (AC6): a 075-era record has no `assembly` and no per-package `contents` /
  // `contentsTruncated` / `contributed` fields - it must still parse to the same shape.
  it('a 075-era diagnostics record parses unchanged', () => {
    const [parsed] = parseDownloadFailures([{ ...baseRow, diagnostics }])

    expect(parsed?.diagnostics).toEqual(diagnostics)
    expect(parsed?.diagnostics?.assembly).toBeUndefined()
    expect(parsed?.diagnostics?.packages[0]?.contents).toBeUndefined()
    expect(parsed?.diagnostics?.packages[0]?.contentsTruncated).toBeUndefined()
    expect(parsed?.diagnostics?.packages[0]?.contributed).toBeUndefined()
  })

  // Story 078 D1 (AC6/AC9): a garbage `assembly` or per-package `contents` value drops only that
  // field, via `.catch(undefined)`, not the whole record.
  it('a garbage assembly value drops only that field, not the record', () => {
    const [parsed] = parseDownloadFailures([
      { ...baseRow, diagnostics: { ...diagnostics, assembly: 'not an array' } },
    ])

    expect(parsed?.diagnostics).toBeDefined()
    expect(parsed?.diagnostics?.jobId).toBe('job-1')
    expect(parsed?.diagnostics?.assembly).toBeUndefined()
  })

  it('a garbage per-package contents value drops only that field, not the record', () => {
    const [parsed] = parseDownloadFailures([
      {
        ...baseRow,
        diagnostics: {
          ...diagnostics,
          packages: [{ ...diagnostics.packages[0], contents: 'not an array' }],
        },
      },
    ])

    expect(parsed?.diagnostics).toBeDefined()
    expect(parsed?.diagnostics?.packages).toHaveLength(1)
    expect(parsed?.diagnostics?.packages[0]?.contents).toBeUndefined()
  })

  it('round-trips a record carrying assembly and per-package contents', () => {
    const withNewRecords: DownloadDiagnostics = {
      ...diagnostics,
      packages: [
        {
          ...diagnostics.packages[0]!,
          contents: ['pak0.pak', 'players'],
          contentsTruncated: false,
          contributed: true,
        },
      ],
      assembly: [
        { from: 'base/pak0.pak', to: 'base/pak0.pak', found: true, sourcePackageId: 'demo' },
      ],
    }
    const [parsed] = parseDownloadFailures([{ ...baseRow, diagnostics: withNewRecords }])

    expect(parsed?.diagnostics).toEqual(withNewRecords)
  })
})

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
    expect(downloadsState(state).settings.get()).toEqual(DEFAULT_DOWNLOADS_SETTINGS)
  })

  it('downloads settings survive a reload', async () => {
    const written = downloadsState(state).settings.update(() => ({
      concurrentJobs: 4,
      archiveCacheBudgetGB: 10,
      downloadWhilePlayingAllowed: false,
    }))
    await state.settle()

    const reloaded = new StateStore(filePath)
    await reloaded.load()

    expect(downloadsState(reloaded).settings.get()).toEqual(written)
    expect(downloadsState(reloaded).settings.get()).toEqual({
      concurrentJobs: 4,
      archiveCacheBudgetGB: 10,
      downloadWhilePlayingAllowed: false,
    })
  })

  it('a garbage archiveCacheBudgetGB falls back to its default, leaving siblings intact', async () => {
    downloadsState(state).settings.update(() => ({
      concurrentJobs: 4,
      archiveCacheBudgetGB: 999 as never, // out of ARCHIVE_CACHE_BUDGET_CHOICES_GB on purpose
      downloadWhilePlayingAllowed: false,
    }))
    await state.settle()

    const reloaded = new StateStore(filePath)
    await reloaded.load()

    const settings = downloadsState(reloaded).settings.get()
    // Only the corrupt field falls back - its valid siblings are preserved.
    expect(settings.archiveCacheBudgetGB).toBe(DEFAULT_DOWNLOADS_SETTINGS.archiveCacheBudgetGB)
    expect(settings.concurrentJobs).toBe(4)
    expect(settings.downloadWhilePlayingAllowed).toBe(false)
  })

  it('a garbage downloadWhilePlayingAllowed falls back to its default, leaving siblings intact', async () => {
    downloadsState(state).settings.update(() => ({
      concurrentJobs: 3,
      archiveCacheBudgetGB: 20,
      downloadWhilePlayingAllowed: 'yes' as never, // not a boolean, on purpose
    }))
    await state.settle()

    const reloaded = new StateStore(filePath)
    await reloaded.load()

    const settings = downloadsState(reloaded).settings.get()
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
    expect(downloadsState(state).failures.get()).toEqual([])
  })

  it('downloadFailures round-trips through state.json', async () => {
    const written = downloadsState(state).failures.update(() => [
      failure({ jobId: 'job-1', installationId: 'inst-1' }),
      failure({ jobId: 'job-2' }),
    ])
    await state.settle()

    const reloaded = new StateStore(filePath)
    await reloaded.load()

    expect(downloadsState(reloaded).failures.get()).toEqual(written)
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
    expect(downloadsState(reloaded).failures.get()).toEqual([good])
    expect(reloaded.installations()).toEqual([])
  })

  it('an update that returns the live list unchanged schedules no write', async () => {
    downloadsState(state).failures.update(() => [failure()])
    await state.settle()
    await rm(filePath, { force: true })

    downloadsState(state).failures.update((live) => live)
    await state.settle()

    await expect(access(filePath)).rejects.toThrow()
  })

  it('an entry with dismissedAt older than 7 days does not survive a reload', async () => {
    const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000
    downloadsState(state).failures.update(() => [
      failure({ jobId: 'old-dismissed', dismissedAt: eightDaysAgo }),
      failure({ jobId: 'still-here' }),
    ])
    await state.settle()

    const reloaded = new StateStore(filePath)
    await reloaded.load()

    const jobIds = downloadsState(reloaded)
      .failures.get()
      .map((entry) => entry.jobId)
    expect(jobIds).toEqual(['still-here'])
  })
})
