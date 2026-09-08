import { mkdir, mkdtemp, open, readdir, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_DOWNLOADS_SETTINGS,
  DOWNLOADS_HANDLERS,
  type DownloadsSettings,
  type ManifestSnapshot,
} from '@shared/modules/downloads'
import { fail, type Outcome } from '@shared/types'
import type { Logger } from '../../lib/logger'
import type { ModuleHandler, ModuleSetup } from '../types'
import { downloadsModule } from './index'
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
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

async function setUpModule(app: ModuleSetup['app'] = {} as ModuleSetup['app']): Promise<
  Map<string, ModuleHandler>
> {
  const handlers = new Map<string, ModuleHandler>()
  await downloadsModule.setup({
    handle: collectHandlers(handlers),
    emit: vi.fn(),
    app,
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
} {
  let current = initial
  return {
    getDownloadsSettings: () => current,
    setDownloadsSettings: (next) => {
      current = next
      return current
    },
  }
}

describe('downloadsModule', () => {
  it('registers manifest.get under the exact channel name', async () => {
    const handlers = await setUpModule()

    expect(handlers.has(DOWNLOADS_HANDLERS.manifestGet)).toBe(true)
    expect(DOWNLOADS_HANDLERS.manifestGet).toBe('manifest.get')
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
