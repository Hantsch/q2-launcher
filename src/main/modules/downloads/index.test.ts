import { mkdir, mkdtemp, open, readdir, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_DOWNLOADS_SETTINGS,
  DOWNLOADS_HANDLERS,
  type DownloadFailure,
  type DownloadsSettings,
  type ManifestSnapshot,
} from '@shared/modules/downloads'
import { fail, type Outcome } from '@shared/types'
import type { Logger } from '../../lib/logger'
import { JobsService } from '../../services/jobs'
import type { ModuleHandler, ModuleSetup } from '../types'
import { createDiagnosticsCollector, diagnosticsRegistrySize } from './diagnostics'
import { downloadsModule, UNKNOWN_DOWNLOAD_FAILURE_KEY } from './index'
import { getDownloadsCacheDir } from './paths'

/**
 * Story 070 D4: the downloads module's main half. Covers the acceptance line verbatim - the
 * handler is registered under the exact channel `downloads/manifest.get`, a successful fetch
 * answers `ok` with a `ManifestSnapshot`, and a dead network with a cold cache answers a failure
 * `Outcome` carrying the i18n key `downloads.error.manifestUnavailable` - never prose.
 *
 * `electron` and `fetch` are mocked exactly as `manifest-service.test.ts` mocks them (this
 * handler constructs a real `ManifestService` internally, so there is no separate seam to fake):
 * `app.getPath('userData')` points at a per-test temp folder, and `fetch` is a stubbed global
 * routed by URL. `handle()` is collected the same way `config/index.test.ts` collects it - a
 * fake `ModuleSetup.handle` that mirrors `MainModuleRegistry.invoke()`'s own
 * `schema.safeParse` + call, so a test reaching the collected handler exercises the same
 * validation path production traffic does.
 */

const userDataBox = vi.hoisted(() => ({ current: '' }))

vi.mock('electron', () => ({
  app: { getPath: () => userDataBox.current },
}))

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: () => Promise.resolve(body) } as unknown as Response
}

function fakeLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger
}

const enginePackage = {
  kind: 'engine',
  engine: 'q2pro',
  id: 'q2pro-1.0.0',
  version: '1.0.0',
  sizeBytes: 4096,
  sha256: 'a'.repeat(64),
  url: 'https://example.com/q2pro-1.0.0.zip',
  mirrors: [],
  contents: [{ from: 'q2pro.exe', to: 'root' }],
}

const enginesManifest = { schemaVersion: 1, packages: [enginePackage], pinned: {} }
const gamedataManifest = { schemaVersion: 1, packages: [] }

/** Both manifest files answer 200, routed by URL - same helper `manifest-service.test.ts` uses. */
function serveGoodManifests(fetchMock: ReturnType<typeof vi.fn>): void {
  fetchMock.mockImplementation((url: unknown) =>
    Promise.resolve(jsonResponse(String(url).includes('engines/') ? enginesManifest : gamedataManifest)),
  )
}

/** The network is gone: every request rejects, as `fetch` does when offline. */
function serveOffline(fetchMock: ReturnType<typeof vi.fn>): void {
  fetchMock.mockImplementation(() => Promise.reject(new Error('getaddrinfo ENOTFOUND')))
}

/** Collects `handle()` calls the way `MainModuleRegistry.invoke()` actually dispatches them. */
function collectHandlers(handlers: Map<string, ModuleHandler>): ModuleSetup['handle'] {
  return (type, schema, handler) => {
    handlers.set(type, (payload) => {
      const parsed = schema.safeParse(payload)
      if (!parsed.success) return fail('ipc.error.invalidPayload')
      return handler(parsed.data)
    })
  }
}

let dir: string
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'q2-launcher-downloads-index-'))
  userDataBox.current = join(dir, 'userData')
  await mkdir(userDataBox.current, { recursive: true })
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(async () => {
  vi.unstubAllGlobals()
  // Story 073 D2: `setup()` subscribes to `JobsService.onChange`, and `dispose()` is what hands
  // that subscription back - so every test drops its own observer instead of leaving one attached
  // to a discarded jobs service.
  await downloadsModule.dispose?.()
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

/**
 * Story 073 D2: `setup()` now reads `app.jobs`, so a test that does not care about jobs still needs
 * one - hence the default. A test that *does* drive jobs passes its own instance inside `app`, which
 * wins over this default (spread order).
 */
async function setUpModule(
  app: Partial<ModuleSetup['app']> = {},
): Promise<Map<string, ModuleHandler>> {
  const handlers = new Map<string, ModuleHandler>()
  await downloadsModule.setup({
    handle: collectHandlers(handlers),
    emit: vi.fn(),
    app: { jobs: new JobsService(() => {}), ...app } as ModuleSetup['app'],
    log: fakeLogger(),
  })
  return handlers
}

/**
 * A minimal stand-in for `AppContext['state']`, holding only the two methods this module's D4
 * handlers call. Kept in-memory rather than backed by a real `StateStore` (json-store + disk):
 * persistence itself is D2/`state.test.ts`'s job, this suite only needs to prove the handlers read
 * and write through whatever `app.state` gives them.
 */
function fakeDownloadsState(initial: DownloadsSettings): {
  getDownloadsSettings: () => DownloadsSettings
  setDownloadsSettings: (next: DownloadsSettings) => DownloadsSettings
  getDownloadFailures: () => DownloadFailure[]
  setDownloadFailures: (next: DownloadFailure[]) => DownloadFailure[]
} {
  let current = initial
  // Story 073 D2: the failure log lives here too, verbatim - the real `StateStore` prunes on both
  // read and write, and that retention is `failure-log.test.ts`'s and `state.test.ts`'s to prove.
  // Keeping this stand-in dumb is the point: what these tests must show is that the module writes
  // through `app.state` at all, and exactly once.
  let failures: DownloadFailure[] = []
  return {
    getDownloadsSettings: () => current,
    setDownloadsSettings: (next) => {
      current = next
      return current
    },
    getDownloadFailures: () => failures,
    setDownloadFailures: (next) => {
      failures = next
      return failures
    },
  }
}

describe('downloadsModule', () => {
  it('registers manifest.get under the exact channel name', async () => {
    const handlers = await setUpModule()

    expect(handlers.has(DOWNLOADS_HANDLERS.manifestGet)).toBe(true)
    expect(DOWNLOADS_HANDLERS.manifestGet).toBe('manifest.get')
  })

  // Story 074 D4: the wizard's three channels, under the exact names the contract declares.
  it('registers the bootstrap channels under their exact names', async () => {
    const handlers = await setUpModule()

    expect(handlers.has(DOWNLOADS_HANDLERS.bootstrapTargetVerdict)).toBe(true)
    expect(handlers.has(DOWNLOADS_HANDLERS.bootstrapSummary)).toBe(true)
    expect(handlers.has(DOWNLOADS_HANDLERS.bootstrapStart)).toBe(true)
    // Story 089 D3: the channel D1 reserved now has a handler behind it.
    expect(handlers.has(DOWNLOADS_HANDLERS.bootstrapGameDataSource)).toBe(true)
    expect(DOWNLOADS_HANDLERS.bootstrapTargetVerdict).toBe('bootstrap.targetVerdict')
    expect(DOWNLOADS_HANDLERS.bootstrapSummary).toBe('bootstrap.summary')
    expect(DOWNLOADS_HANDLERS.bootstrapStart).toBe('bootstrap.start')
    expect(DOWNLOADS_HANDLERS.bootstrapGameDataSource).toBe('bootstrap.gameDataSource')
  })

  it('returns ok with a ManifestSnapshot on a successful fetch', async () => {
    serveGoodManifests(fetchMock)
    const handlers = await setUpModule()
    const handler = handlers.get(DOWNLOADS_HANDLERS.manifestGet)!

    const outcome = (await handler({})) as Outcome<ManifestSnapshot>

    expect(outcome.ok).toBe(true)
    if (outcome.ok) {
      expect(outcome.value.schemaVersion).toBe(1)
      expect(outcome.value.packages.map((pkg) => pkg.id)).toEqual(['q2pro-1.0.0'])
      expect(outcome.value.fromCache).toBe(false)
    }
  })

  it('returns the i18n key (never prose) when nothing is available', async () => {
    serveOffline(fetchMock)
    const handlers = await setUpModule()
    const handler = handlers.get(DOWNLOADS_HANDLERS.manifestGet)!

    const outcome = (await handler({})) as Outcome<ManifestSnapshot>

    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.error.key).toBe('downloads.error.manifestUnavailable')
      // Proves this is a key, not a human-readable sentence: no spaces, matches the
      // dotted-key shape every other i18n error key in this codebase uses.
      expect(outcome.error.key).not.toMatch(/\s/)
    }
  })
})

/**
 * Story 072 D4 (AC2, AC3, AC4, AC5).
 *
 * `getSettings`/`patchSettings`/`cacheStatus`/`clearCache` cover a persisted-settings slot
 * (`fakeDownloadsState`, an in-memory stand-in for `AppContext['state']` - persistence itself is
 * D2's job, already covered by `state.test.ts`) plus real archive-cache files under the mocked
 * `userDataBox.current` (the same `electron.app.getPath` stub `manifestGet`'s own suite above
 * uses), so eviction is proven against an actual directory listing, not just a return value - the
 * same "trust the disk, not the report" discipline `cache.test.ts` (D3) already applies.
 */
describe('downloadsModule settings + cache handlers', () => {
  it('getSettings answers the persisted values', async () => {
    const nonDefault: DownloadsSettings = {
      concurrentJobs: 4,
      archiveCacheBudgetGB: 10,
      downloadWhilePlayingAllowed: false,
    }
    const handlers = await setUpModule({
      state: fakeDownloadsState(nonDefault),
    } as unknown as ModuleSetup['app'])

    const result = await handlers.get(DOWNLOADS_HANDLERS.getSettings)!(undefined)

    expect(result).toEqual(nonDefault)
  })

  it('patchSettings refuses a value outside the allowed range', async () => {
    const state = fakeDownloadsState({ ...DEFAULT_DOWNLOADS_SETTINGS })
    const handlers = await setUpModule({ state } as unknown as ModuleSetup['app'])
    const patchSettings = handlers.get(DOWNLOADS_HANDLERS.patchSettings)!

    const tooLow = (await patchSettings({ concurrentJobs: 0 })) as Outcome<DownloadsSettings>
    const tooHigh = (await patchSettings({ concurrentJobs: 7 })) as Outcome<DownloadsSettings>
    const unlistedBudget = (await patchSettings({
      archiveCacheBudgetGB: 3,
    })) as Outcome<DownloadsSettings>

    expect(tooLow.ok).toBe(false)
    expect(tooHigh.ok).toBe(false)
    expect(unlistedBudget.ok).toBe(false)
    if (!tooLow.ok) expect(tooLow.error.key).toBe('ipc.error.invalidPayload')

    // None of the three rejected patches touched the persisted value.
    expect(state.getDownloadsSettings()).toEqual(DEFAULT_DOWNLOADS_SETTINGS)
  })

  it('a valid patch merges onto (and persists over) the previous settings', async () => {
    const state = fakeDownloadsState({ ...DEFAULT_DOWNLOADS_SETTINGS })
    const handlers = await setUpModule({ state } as unknown as ModuleSetup['app'])
    const patchSettings = handlers.get(DOWNLOADS_HANDLERS.patchSettings)!

    const result = (await patchSettings({
      downloadWhilePlayingAllowed: false,
    })) as DownloadsSettings

    expect(result).toEqual({ ...DEFAULT_DOWNLOADS_SETTINGS, downloadWhilePlayingAllowed: false })
    expect(state.getDownloadsSettings()).toEqual(result)
  })

  /** Grows `path` to `sizeBytes` without writing real content - a truncate-grow is a metadata
   * operation, not a byte-by-byte write, which is what keeps a real-budget-scale (GB) fixture like
   * this one fast. */
  async function sparseArchive(path: string, sizeBytes: number, mtimeMs: number): Promise<void> {
    const handle = await open(path, 'w')
    try {
      await handle.truncate(sizeBytes)
    } finally {
      await handle.close()
    }
    const when = new Date(mtimeMs)
    await utimes(path, when, when)
  }

  const MB = 1024 * 1024

  it('lowering the budget evicts down to it', async () => {
    const cacheDir = getDownloadsCacheDir(userDataBox.current)
    await mkdir(cacheDir, { recursive: true })
    const t0 = Date.UTC(2026, 0, 1)
    // Two 700 MB archives: together (1400 MB) exceed a 1 GB budget, but either one alone fits.
    await sparseArchive(join(cacheDir, 'old.zip'), 700 * MB, t0)
    await sparseArchive(join(cacheDir, 'new.zip'), 700 * MB, t0 + 3_600_000)

    const state = fakeDownloadsState({ ...DEFAULT_DOWNLOADS_SETTINGS, archiveCacheBudgetGB: 10 })
    const handlers = await setUpModule({ state } as unknown as ModuleSetup['app'])
    const patchSettings = handlers.get(DOWNLOADS_HANDLERS.patchSettings)!

    const result = (await patchSettings({ archiveCacheBudgetGB: 1 })) as DownloadsSettings

    expect(result.archiveCacheBudgetGB).toBe(1)
    // The oldest archive was evicted; the newer one, which alone fits the new budget, stays.
    expect((await readdir(cacheDir)).sort()).toEqual(['new.zip'])
  })

  it('raising the budget never evicts anything', async () => {
    const cacheDir = getDownloadsCacheDir(userDataBox.current)
    await mkdir(cacheDir, { recursive: true })
    await writeFile(join(cacheDir, 'small.zip'), Buffer.alloc(100))

    const state = fakeDownloadsState({ ...DEFAULT_DOWNLOADS_SETTINGS, archiveCacheBudgetGB: 1 })
    const handlers = await setUpModule({ state } as unknown as ModuleSetup['app'])
    const patchSettings = handlers.get(DOWNLOADS_HANDLERS.patchSettings)!

    await patchSettings({ archiveCacheBudgetGB: 20 })

    expect(await readdir(cacheDir)).toEqual(['small.zip'])
  })

  it('cacheStatus reports the seeded cache size and item count', async () => {
    const cacheDir = getDownloadsCacheDir(userDataBox.current)
    await mkdir(cacheDir, { recursive: true })
    await writeFile(join(cacheDir, 'engine.zip'), Buffer.alloc(1234))
    await writeFile(join(cacheDir, 'demo.zip'), Buffer.alloc(4321))

    const handlers = await setUpModule({
      state: fakeDownloadsState({ ...DEFAULT_DOWNLOADS_SETTINGS }),
    } as unknown as ModuleSetup['app'])

    const result = await handlers.get(DOWNLOADS_HANDLERS.cacheStatus)!(undefined)

    expect(result).toEqual({ totalBytes: 1234 + 4321, itemCount: 2 })
  })

  it('clearCache reports what it removed', async () => {
    const cacheDir = getDownloadsCacheDir(userDataBox.current)
    await mkdir(cacheDir, { recursive: true })
    await writeFile(join(cacheDir, 'engine.zip'), Buffer.alloc(1000))
    await writeFile(join(cacheDir, 'demo.zip'), Buffer.alloc(500))

    const handlers = await setUpModule({
      state: fakeDownloadsState({ ...DEFAULT_DOWNLOADS_SETTINGS }),
    } as unknown as ModuleSetup['app'])

    const result = (await handlers.get(DOWNLOADS_HANDLERS.clearCache)!(undefined)) as {
      removedBytes: number
      removedCount: number
    }

    expect(result).toEqual({ removedBytes: 1500, removedCount: 2 })
    // What was reported removed is what actually disappeared from disk.
    expect(await readdir(cacheDir)).toEqual([])
  })
})

/**
 * Story 073 D2 (AC2): job observation and the failure-log handlers.
 *
 * Driven through a **real** `JobsService` rather than a fake emitter, because the two things that
 * can go wrong here are properties of the real one: it fires on every change (so a failed job is
 * part of many snapshots) and it keeps a `failed` job in its list forever (`clearFinished()` only
 * drops `succeeded`/`cancelled`). A hand-rolled emitter that fires once per transition would prove
 * nothing about "exactly one entry".
 */
describe('downloadsModule failure log', () => {
  function setUpFailureLog(): Promise<{
    handlers: Map<string, ModuleHandler>
    jobs: JobsService
    state: ReturnType<typeof fakeDownloadsState>
    broadcasts: number
  }> {
    const state = fakeDownloadsState({ ...DEFAULT_DOWNLOADS_SETTINGS })
    const counted = { broadcasts: 0 }
    const jobs = new JobsService(() => {
      counted.broadcasts += 1
    })
    return setUpModule({ state, jobs } as unknown as ModuleSetup['app']).then((handlers) => ({
      handlers,
      jobs,
      state,
      get broadcasts() {
        return counted.broadcasts
      },
    }))
  }

  function downloadJob(jobs: JobsService): string {
    return jobs.create({
      moduleId: 'downloads',
      kind: 'download',
      labelKey: 'downloads.job.download',
      labelParams: { name: 'q2pro 1.0.0' },
      installationId: 'inst-1',
    }).id
  }

  it('a failed downloads job produces exactly one entry with the job reason, label and installation', async () => {
    const { jobs, state } = await setUpFailureLog()
    const id = downloadJob(jobs)

    jobs.progress(id, { ratio: 0.4, bytesDone: 40, bytesTotal: 100 })
    jobs.finish(id, {
      status: 'failed',
      error: { key: 'downloads.error.verificationFailed', params: { file: 'q2pro.zip' } },
    })
    // Four more snapshots that still contain the failed job - a second, unrelated job running to
    // completion, plus a `clearFinished()` that (by design) does not drop a `failed` job.
    const other = downloadJob(jobs)
    jobs.progress(other, { ratio: 1 })
    jobs.finish(other, { status: 'succeeded' })
    jobs.clearFinished()

    const failures = state.getDownloadFailures()
    expect(failures).toHaveLength(1)
    expect(failures[0]).toMatchObject({
      jobId: id,
      labelKey: 'downloads.job.download',
      labelParams: { name: 'q2pro 1.0.0' },
      installationId: 'inst-1',
      error: { key: 'downloads.error.verificationFailed', params: { file: 'q2pro.zip' } },
    })
    expect(failures[0]?.dismissedAt).toBeUndefined()
    expect(typeof failures[0]?.createdAt).toBe('number')
  })

  it('a succeeded or cancelled job produces no entry', async () => {
    const { jobs, state } = await setUpFailureLog()

    const succeeded = downloadJob(jobs)
    jobs.finish(succeeded, { status: 'succeeded' })
    const cancelled = downloadJob(jobs)
    jobs.cancel(cancelled)

    expect(state.getDownloadFailures()).toEqual([])
  })

  it('another module failing is not this log entry', async () => {
    const { jobs, state } = await setUpFailureLog()

    const id = jobs.create({ moduleId: 'mods', kind: 'install', labelKey: 'mods.job.install' }).id
    jobs.finish(id, { status: 'failed', error: { key: 'mods.error.whatever' } })

    expect(state.getDownloadFailures()).toEqual([])
  })

  it('a failed job carrying no reason still leaves one entry', async () => {
    const { jobs, state } = await setUpFailureLog()
    const id = downloadJob(jobs)

    jobs.finish(id, { status: 'failed' })

    expect(state.getDownloadFailures()).toHaveLength(1)
    expect(state.getDownloadFailures()[0]?.error).toEqual({ key: UNKNOWN_DOWNLOAD_FAILURE_KEY })
  })

  it('observing failures leaves the jobs:changed broadcast intact', async () => {
    const box = await setUpFailureLog()
    const id = downloadJob(box.jobs)

    box.jobs.progress(id, { ratio: 0.5 })
    box.jobs.finish(id, { status: 'failed', error: { key: 'downloads.error.network' } })

    // Exactly one broadcast per change - create, progress, finish - and no extra one from the
    // module's own observation.
    expect(box.broadcasts).toBe(3)
  })

  it('dispose stops the observation', async () => {
    const { jobs, state } = await setUpFailureLog()
    await downloadsModule.dispose?.()

    const id = downloadJob(jobs)
    jobs.finish(id, { status: 'failed', error: { key: 'downloads.error.network' } })

    expect(state.getDownloadFailures()).toEqual([])
  })

  it('failures answers the persisted log, dismiss and restore move an entry in and out', async () => {
    const { handlers, jobs, state } = await setUpFailureLog()
    const id = downloadJob(jobs)
    jobs.finish(id, { status: 'failed', error: { key: 'downloads.error.diskWrite' } })

    const listed = (await handlers.get(DOWNLOADS_HANDLERS.failures)!(undefined)) as DownloadFailure[]
    expect(listed).toHaveLength(1)
    const entryId = listed[0]!.id

    const dismissed = (await handlers.get(DOWNLOADS_HANDLERS.dismissFailure)!({
      id: entryId,
    })) as DownloadFailure[]
    expect(typeof dismissed[0]?.dismissedAt).toBe('number')
    expect(state.getDownloadFailures()[0]?.dismissedAt).toBe(dismissed[0]?.dismissedAt)

    const restored = (await handlers.get(DOWNLOADS_HANDLERS.restoreFailure)!({
      id: entryId,
    })) as DownloadFailure[]
    expect(restored).toHaveLength(1)
    expect(restored[0]?.dismissedAt).toBeUndefined()
    expect(state.getDownloadFailures()[0]?.dismissedAt).toBeUndefined()
  })

  /**
   * Story 075 D2: `failureFor()` attaches whatever `diagnostics.ts`'s registry holds for the job,
   * and any terminal status (success or failure) drops that job's entry so the registry cannot
   * grow unbounded across a session.
   */
  it('a failed job with a registry entry produces a failure carrying its diagnostics', async () => {
    const { jobs, state } = await setUpFailureLog()
    const id = downloadJob(jobs)
    const collector = createDiagnosticsCollector(id, 'bootstrap', 'C:\\Users\\bob')
    collector.recordPackage({
      id: 'q2pro-1.0.0',
      url: 'https://example.com/q2pro.zip',
      sizeBytes: 4096,
      verified: true,
      extracted: true,
    })

    jobs.finish(id, { status: 'failed', error: { key: 'downloads.error.installationNotPlayable' } })

    const failures = state.getDownloadFailures()
    expect(failures).toHaveLength(1)
    expect(failures[0]?.diagnostics).toMatchObject({
      jobId: id,
      kind: 'bootstrap',
      errorKey: 'downloads.error.installationNotPlayable',
      packages: [
        {
          id: 'q2pro-1.0.0',
          url: 'https://example.com/q2pro.zip',
          sizeBytes: 4096,
          verified: true,
          extracted: true,
        },
      ],
    })
    // The entry is gone from the registry once the failure has been recorded from it.
    expect(diagnosticsRegistrySize()).toBe(0)
  })

  it('a failed job with no registry entry produces a failure with no diagnostics field', async () => {
    const { jobs, state } = await setUpFailureLog()
    const id = downloadJob(jobs)

    jobs.finish(id, { status: 'failed', error: { key: 'downloads.error.network' } })

    const failures = state.getDownloadFailures()
    expect(failures).toHaveLength(1)
    expect(failures[0]?.diagnostics).toBeUndefined()
  })

  it('a succeeded job leaves the registry empty', async () => {
    const { jobs } = await setUpFailureLog()
    const id = downloadJob(jobs)
    createDiagnosticsCollector(id, 'bootstrap', 'C:\\Users\\bob')
    expect(diagnosticsRegistrySize()).toBe(1)

    jobs.finish(id, { status: 'succeeded' })

    expect(diagnosticsRegistrySize()).toBe(0)
  })

  it('dismiss refuses a payload that is not an id', async () => {
    const { handlers, state } = await setUpFailureLog()
    const dismiss = handlers.get(DOWNLOADS_HANDLERS.dismissFailure)!

    const empty = (await dismiss({ id: '' })) as Outcome<DownloadFailure[]>
    const missing = (await dismiss({})) as Outcome<DownloadFailure[]>
    const extra = (await dismiss({ id: 'a', wipe: true })) as Outcome<DownloadFailure[]>

    expect(empty.ok).toBe(false)
    expect(missing.ok).toBe(false)
    expect(extra.ok).toBe(false)
    if (!empty.ok) expect(empty.error.key).toBe('ipc.error.invalidPayload')
    expect(state.getDownloadFailures()).toEqual([])
  })
})
