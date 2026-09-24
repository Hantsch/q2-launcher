import { randomUUID } from 'node:crypto'
import { rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { STATE_SCHEMA_VERSION } from '@shared/constants'
import { DEFAULT_DOWNLOADS_SETTINGS, type DownloadFailure } from '@shared/modules/downloads'
import { DEFAULT_HOME_LAYOUT, type HomeLayout } from '@shared/modules/home'
import {
  DEFAULT_MASTER_SOURCES,
  DEFAULT_SERVERS_STATE,
  type ManualServerEntry,
  type ServerHistoryEntry,
  type ServersState,
} from '@shared/modules/servers'
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

describe('StateStore homeLayout (story 086 D1)', () => {
  let filePath: string
  let state: StateStore

  beforeEach(async () => {
    filePath = join(tmpdir(), `q2-launcher-state-home-layout-${randomUUID()}.json`)
    state = new StateStore(filePath)
    await state.load()
  })

  afterEach(async () => {
    await rm(filePath, { force: true })
    await rm(`${filePath}.tmp`, { force: true })
    await rm(`${filePath}.bak`, { force: true })
  })

  it('starts with the default layout', () => {
    expect(state.homeLayout()).toEqual(DEFAULT_HOME_LAYOUT)
  })

  it('homeLayout round-trips through state.json and touches no other setting', async () => {
    const settingsBefore = state.settings()
    const installationsBefore = state.installations()
    const configProfilesBefore = state.configProfiles()

    const custom: HomeLayout = {
      tiles: [{ moduleId: 'playtime', x: 0, y: 0, w: 4, h: 4 }],
    }
    const written = state.setHomeLayout(custom)
    await state.settle()

    const reloaded = new StateStore(filePath)
    await reloaded.load()

    expect(reloaded.homeLayout()).toEqual(written)
    expect(reloaded.homeLayout()).toEqual(custom)
    // Other state keys are untouched by this write.
    expect(reloaded.settings()).toEqual(settingsBefore)
    expect(reloaded.installations()).toEqual(installationsBefore)
    expect(reloaded.configProfiles()).toEqual(configProfilesBefore)
  })

  it('a record for an unknown module id read from disk is gone after reload', async () => {
    await writeFile(
      filePath,
      JSON.stringify({
        schemaVersion: 1,
        homeLayout: {
          tiles: [
            { moduleId: 'playtime', x: 0, y: 0, w: 6, h: 5 },
            { moduleId: 'nope', x: 6, y: 0, w: 6, h: 5 },
          ],
        },
      }),
      'utf-8',
    )

    const reloaded = new StateStore(filePath)
    await reloaded.load()

    expect(reloaded.homeLayout().tiles).toEqual([
      { moduleId: 'playtime', x: 0, y: 0, w: 6, h: 5 },
    ])
  })
})

describe('StateStore servers state (story 110 D3)', () => {
  let filePath: string
  let state: StateStore

  beforeEach(async () => {
    filePath = join(tmpdir(), `q2-launcher-state-servers-${randomUUID()}.json`)
    state = new StateStore(filePath)
    await state.load()
  })

  afterEach(async () => {
    await rm(filePath, { force: true })
    await rm(`${filePath}.tmp`, { force: true })
    await rm(`${filePath}.bak`, { force: true })
  })

  it('starts with the default servers state', () => {
    expect(state.serversState()).toEqual(DEFAULT_SERVERS_STATE)
  })

  // Story 111 D2 (AC1): a genuinely fresh install - no state.json on disk yet, so `StateStore`
  // builds its initial value from `defaults()` (`structuredClone(DEFAULT_SERVERS_STATE)`), never
  // through `parseServersState` - must still see the three shipped master/list sources, not an
  // empty list. This is the one path the schema-level `.default()` in `main/lib/schemas.ts` cannot
  // reach by itself, since there is no `state.json` for it to parse.
  it('a fresh install (no state.json on disk) ships the three default master sources', () => {
    expect(state.serversState().sources).toHaveLength(3)
    expect(state.serversState().sources).toEqual(DEFAULT_MASTER_SOURCES)
  })

  it('the servers key is its own top-level state key and LauncherSettings is untouched', () => {
    const settingsBefore = state.settings()

    // servers is a distinct top-level key with its own shape...
    expect(state.serversState()).toEqual(DEFAULT_SERVERS_STATE)
    expect(Object.keys(state.serversState()).sort()).toEqual(
      ['favourites', 'history', 'manualServers', 'scan', 'sources'].sort(),
    )

    // ...and adding it left LauncherSettings's own shape and values untouched.
    expect(state.settings()).toEqual(settingsBefore)
    expect('servers' in state.settings()).toBe(false)
  })

  it('servers state round-trips through state.json and touches no other setting', async () => {
    const settingsBefore = state.settings()
    const installationsBefore = state.installations()
    const homeLayoutBefore = state.homeLayout()

    const custom: ServersState = {
      sources: [{ id: 'src-1', type: 'udp-master', address: 'master.example.com:27900', enabled: true }],
      favourites: [{ address: '1.2.3.4:27910', addedAt: '2026-01-01T00:00:00.000Z' }],
      manualServers: [
        { address: '5.6.7.8:27911', origin: 'manual', addedAt: '2026-01-02T00:00:00.000Z' },
      ],
      history: [{ address: '9.10.11.12:27912', connectedAt: '2026-01-03T00:00:00.000Z' }],
      scan: { concurrency: 4, timeoutMs: 1500, retries: 2, minSpacingMs: 25 },
    }
    const written = state.setServersState(custom)
    await state.settle()

    const reloaded = new StateStore(filePath)
    await reloaded.load()

    expect(reloaded.serversState()).toEqual(written)
    expect(reloaded.serversState()).toEqual(custom)
    // Other state keys are untouched by this write.
    expect(reloaded.settings()).toEqual(settingsBefore)
    expect(reloaded.installations()).toEqual(installationsBefore)
    expect(reloaded.homeLayout()).toEqual(homeLayoutBefore)
  })

  // Story 113 AC5: manual servers and history are the two collections story 113 writes, and both
  // live in story 110's `servers` state key - so the proof they survive a restart is a second,
  // independent `StateStore` over the same file reading them back unchanged, rows and order intact.
  it('manual servers and history survive a state store reload', async () => {
    const manualServers: ManualServerEntry[] = [
      { address: '1.2.3.4:27910', origin: 'manual', addedAt: '2026-01-02T00:00:00.000Z' },
      { address: 'q2.example.com:27911', origin: 'manual', addedAt: '2026-01-04T00:00:00.000Z' },
    ]
    const history: ServerHistoryEntry[] = [
      { address: '9.10.11.12:27912', connectedAt: '2026-01-05T00:00:00.000Z' },
      { address: '1.2.3.4:27910', connectedAt: '2026-01-03T00:00:00.000Z' },
    ]

    state.setServersState({ ...state.serversState(), manualServers, history })
    await state.settle()

    const reloaded = new StateStore(filePath)
    await reloaded.load()

    expect(reloaded.serversState().manualServers).toEqual(manualServers)
    expect(reloaded.serversState().history).toEqual(history)
    // The sibling collections in the same key came back untouched too.
    expect(reloaded.serversState().sources).toEqual(DEFAULT_MASTER_SOURCES)
    expect(reloaded.serversState().favourites).toEqual([])
  })

  it('a state.json written without the servers key loads with the shipped default (three sources, everything else empty), with no schema bump', async () => {
    await writeFile(
      filePath,
      JSON.stringify({
        schemaVersion: STATE_SCHEMA_VERSION,
      }),
      'utf-8',
    )

    const reloaded = new StateStore(filePath)
    const doc = await reloaded.load()

    expect(reloaded.serversState()).toEqual(DEFAULT_SERVERS_STATE)
    // The file was already on the current schema version - no migration was needed or ran to
    // backfill the missing `servers` key; it degraded through the parser alone, same as
    // `homeLayout`'s missing-key case above.
    expect(doc.schemaVersion).toBe(STATE_SCHEMA_VERSION)
    expect(reloaded.recoveredFrom).toBeNull()
  })

  it('a corrupt servers value degrades without taking siblings down', async () => {
    await writeFile(
      filePath,
      JSON.stringify({
        schemaVersion: 1,
        servers: 'not-an-object',
        homeLayout: {
          tiles: [{ moduleId: 'playtime', x: 0, y: 0, w: 6, h: 5 }],
        },
      }),
      'utf-8',
    )

    const reloaded = new StateStore(filePath)
    await reloaded.load()

    expect(reloaded.serversState()).toEqual(DEFAULT_SERVERS_STATE)
    // The sibling key survives untouched even though servers was corrupt.
    expect(reloaded.homeLayout().tiles).toEqual([
      { moduleId: 'playtime', x: 0, y: 0, w: 6, h: 5 },
    ])
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
