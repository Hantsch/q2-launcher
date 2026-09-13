import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Logger } from '../../lib/logger'
import {
  MANIFEST_CACHE_VERSION,
  MANIFEST_FRESHNESS_MS,
  ManifestService,
  ManifestUnavailableError,
  manifestCacheFilePath,
} from './manifest-service'

/**
 * Story 070 D3. The cache/offline path is where a manifest pipeline quietly gets
 * its correctness criterion wrong, so the criteria - not the implementation -
 * are what is asserted here: a failed fetch and a *refused* manifest both have
 * to serve the last good copy with a real age (AC4), a pin has to resolve to the
 * package it names (AC5), and a cold cache with no network has to fail loudly
 * rather than hand back an empty snapshot dressed as data.
 *
 * `electron` is mocked exactly as in `src/main/services/installation-icons.test.ts`
 * (under plain vitest `import('electron')` resolves to a path *string*), so
 * `app.getPath('userData')` - which the cache path is built from - points at a
 * per-test temp folder. `fetch` is stubbed as in `src/main/lib/content-repo.test.ts`;
 * no request ever leaves the machine. Only `Date` is faked (`toFake: ['Date']`),
 * which is all the 15-minute window and `ageMs` need - real timers keep the
 * atomic `JsonStore` writes and `fs/promises` behaving normally.
 */

const userDataBox = vi.hoisted(() => ({ current: '' }))

vi.mock('electron', () => ({
  app: { getPath: () => userDataBox.current },
}))

const T0 = Date.parse('2026-03-01T12:00:00.000Z')

function jsonResponse(body: unknown, init?: { ok?: boolean; status?: number }): Response {
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    json: () => Promise.resolve(body),
  } as unknown as Response
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
  mirrors: ['https://mirror.example.com/q2pro-1.0.0.zip'],
  contents: [{ from: 'q2pro.exe', to: 'root' }],
}

const pinnedEnginePackageFixture = {
  ...enginePackage,
  id: 'q2pro-2.0.0',
  version: '2.0.0',
  url: 'https://example.com/q2pro-2.0.0.zip',
  mirrors: [],
}

const gamedataPackage = {
  kind: 'gamedata',
  role: 'demo',
  id: 'q2-demo',
  version: '3.14',
  sizeBytes: 1024,
  sha256: 'b'.repeat(64),
  url: 'https://example.com/q2-demo.zip',
  mirrors: [],
  contents: [{ from: 'pak0.pak', to: 'baseq2' }],
}

const enginesManifest = {
  schemaVersion: 1,
  packages: [enginePackage, pinnedEnginePackageFixture],
  pinned: { q2pro: 'q2pro-2.0.0' },
}

const gamedataManifest = { schemaVersion: 1, packages: [gamedataPackage] }

let dir: string
let log: Logger
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'q2-launcher-manifest-service-'))
  userDataBox.current = join(dir, 'userData')
  await mkdir(userDataBox.current, { recursive: true })
  log = fakeLogger()

  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0)
})

afterEach(async () => {
  // Real timers back before any fs cleanup, so `rm`'s retry backoff is real.
  vi.useRealTimers()
  vi.unstubAllGlobals()
  // maxRetries/retryDelay work around the Windows ENOTEMPTY race, as in
  // `src/main/services/installation-icons.test.ts`.
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

/** Both manifest files answer 200 with the given bodies, routed by URL. */
function serve(engines: unknown, gamedata: unknown): void {
  fetchMock.mockImplementation((url: unknown) =>
    Promise.resolve(jsonResponse(String(url).includes('engines/') ? engines : gamedata)),
  )
}

/** The network is gone: every request rejects, as `fetch` does when offline. */
function serveOffline(): void {
  fetchMock.mockImplementation(() => Promise.reject(new Error('getaddrinfo ENOTFOUND')))
}

function service(): ManifestService {
  return new ManifestService({ log })
}

/** One successful fetch+merge, which also seeds the persisted cache. */
async function seedGoodFetch(instance: ManifestService): Promise<void> {
  serve(enginesManifest, gamedataManifest)
  const snapshot = await instance.getManifest()
  expect(snapshot.fromCache).toBe(false)
  fetchMock.mockClear()
}

describe('construction', () => {
  it('issues no fetch and touches no network until getManifest() is called', async () => {
    const manifests = service()

    expect(fetchMock).not.toHaveBeenCalled()

    serve(enginesManifest, gamedataManifest)
    await manifests.getManifest()

    // One request per manifest file, and not one before the caller asked.
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('a successful fetch', () => {
  it('merges both manifest files into one current snapshot and persists it', async () => {
    serve(enginesManifest, gamedataManifest)

    const snapshot = await service().getManifest()

    expect(snapshot.schemaVersion).toBe(1)
    expect(snapshot.packages.map((pkg) => pkg.id)).toEqual([
      'q2pro-1.0.0',
      'q2pro-2.0.0',
      'q2-demo',
    ])
    expect(snapshot.fromCache).toBe(false)
    expect(snapshot.ageMs).toBe(0)
    expect(snapshot.fetchedAt).toBe(new Date(T0).toISOString())

    // Persisted through JsonStore, under its own cacheVersion envelope.
    const cached = JSON.parse(await readFile(manifestCacheFilePath(), 'utf8')) as {
      cacheVersion: number
      fetchedAt: string
      packages: { id: string }[]
    }
    expect(cached.cacheVersion).toBe(MANIFEST_CACHE_VERSION)
    expect(cached.fetchedAt).toBe(new Date(T0).toISOString())
    expect(cached.packages.map((pkg) => pkg.id)).toEqual(['q2pro-1.0.0', 'q2pro-2.0.0', 'q2-demo'])
  })

  // AC5.
  it('pinnedEnginePackage returns the exact package the engines manifest pins', async () => {
    serve(enginesManifest, gamedataManifest)
    const manifests = service()
    await manifests.getManifest()

    expect(manifests.pinnedEnginePackage('q2pro')).toEqual(pinnedEnginePackageFixture)
    // Nothing pinned for another engine must not fall back to "some package".
    expect(manifests.pinnedEnginePackage('r1q2')).toBeUndefined()
  })

  // Regression: pinnedEnginePackage must verify kind/engine, not resolve by id alone.
  it('pinnedEnginePackage refuses a pin whose id resolves to a non-matching package', async () => {
    // The engines manifest itself pins "q2pro" to an id that survives parsing
    // but names a `gamedata` row, not an `engine` row for `q2pro` - a manifest
    // bug (or an id collision) that must never be handed back as if it were the
    // pinned engine build.
    const wrongKindPackage = {
      kind: 'gamedata',
      role: 'demo',
      id: 'q2pro-1.0.0',
      version: '9.9.9',
      sizeBytes: 2048,
      sha256: 'c'.repeat(64),
      url: 'https://example.com/not-actually-q2pro.zip',
      mirrors: [],
      contents: [{ from: 'pak0.pak', to: 'baseq2' }],
    }
    const enginesWithWrongKindPin = {
      schemaVersion: 1,
      packages: [wrongKindPackage],
      pinned: { q2pro: 'q2pro-1.0.0' },
    }

    serve(enginesWithWrongKindPin, gamedataManifest)
    const manifests = service()
    await manifests.getManifest()

    expect(manifests.pinnedEnginePackage('q2pro')).toBeUndefined()
  })
})

describe('the 15-minute in-memory window', () => {
  it('serves a second call inside the window from memory - no refetch, and not "from cache"', async () => {
    const manifests = service()
    await seedGoodFetch(manifests)

    vi.setSystemTime(T0 + 5 * 60 * 1000)
    const again = await manifests.getManifest()

    expect(fetchMock).not.toHaveBeenCalled()
    // Still fresh is a different thing from served-off-disk: the data is current,
    // no fetch attempt failed, so `fromCache` stays false - but the age is honest.
    expect(again.fromCache).toBe(false)
    expect(again.ageMs).toBe(5 * 60 * 1000)
    expect(again.packages.map((pkg) => pkg.id)).toEqual(['q2pro-1.0.0', 'q2pro-2.0.0', 'q2-demo'])
  })

  it('refetches inside the window when refresh: true is passed', async () => {
    const manifests = service()
    await seedGoodFetch(manifests)

    serve(enginesManifest, gamedataManifest)
    vi.setSystemTime(T0 + 60 * 1000)
    const refreshed = await manifests.getManifest({ refresh: true })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(refreshed.fromCache).toBe(false)
    expect(refreshed.ageMs).toBe(0)
  })

  it('refetches once the window has elapsed', async () => {
    const manifests = service()
    await seedGoodFetch(manifests)

    serve(enginesManifest, gamedataManifest)
    vi.setSystemTime(T0 + MANIFEST_FRESHNESS_MS + 1)
    await manifests.getManifest()

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

// AC4: a failed fetch serves the cached manifest and reports its age.
describe('a fetch attempt that cannot produce a snapshot falls back to the cache', () => {
  it('a dead network after one good fetch returns the cached packages with a real age', async () => {
    const manifests = service()
    await seedGoodFetch(manifests)

    serveOffline()
    vi.setSystemTime(T0 + 16 * 60 * 1000)
    const snapshot = await manifests.getManifest()

    expect(snapshot.fromCache).toBe(true)
    expect(snapshot.ageMs).toBe(16 * 60 * 1000)
    expect(snapshot.fetchedAt).toBe(new Date(T0).toISOString())
    expect(snapshot.packages.map((pkg) => pkg.id)).toEqual([
      'q2pro-1.0.0',
      'q2pro-2.0.0',
      'q2-demo',
    ])
    expect(snapshot.pinned).toEqual({ q2pro: 'q2pro-2.0.0' })
  })

  it('a fresh process with a dead network reads the last good copy off disk, with its age', async () => {
    await seedGoodFetch(service())

    // Nothing in memory this time: only the persisted cache file can answer.
    serveOffline()
    vi.setSystemTime(T0 + 3 * 60 * 60 * 1000)
    const snapshot = await service().getManifest()

    expect(snapshot.fromCache).toBe(true)
    expect(snapshot.ageMs).toBe(3 * 60 * 60 * 1000)
    expect(snapshot.packages.map((pkg) => pkg.id)).toEqual([
      'q2pro-1.0.0',
      'q2pro-2.0.0',
      'q2-demo',
    ])
  })

  it('a non-2xx response falls back the same way a dead socket does', async () => {
    const manifests = service()
    await seedGoodFetch(manifests)

    fetchMock.mockImplementation(() =>
      Promise.resolve(jsonResponse(null, { ok: false, status: 503 })),
    )
    vi.setSystemTime(T0 + 20 * 60 * 1000)
    const snapshot = await manifests.getManifest()

    expect(snapshot.fromCache).toBe(true)
    expect(snapshot.ageMs).toBe(20 * 60 * 1000)
    expect(snapshot.packages).toHaveLength(3)
  })

  it('a refused manifest (HTTP 200, unsupported schemaVersion) falls back too - not an empty result', async () => {
    const manifests = service()
    await seedGoodFetch(manifests)

    // Served fine, rejected by the validator: a future schema version.
    serve({ ...enginesManifest, schemaVersion: 2 }, gamedataManifest)
    const snapshot = await manifests.getManifest({ refresh: true })

    expect(snapshot.fromCache).toBe(true)
    expect(snapshot.ageMs).toBe(0)
    expect(snapshot.packages.map((pkg) => pkg.id)).toEqual([
      'q2pro-1.0.0',
      'q2pro-2.0.0',
      'q2-demo',
    ])
  })

  it('a broken envelope in only one of the two files fails the whole attempt', async () => {
    const manifests = service()
    await seedGoodFetch(manifests)

    // engines/ is perfect, gamedata/ has no envelope at all. A partial merge
    // would publish a snapshot missing every game-data package while claiming to
    // be current, so the last complete copy wins.
    serve(enginesManifest, { nothing: 'useful' })
    const snapshot = await manifests.getManifest({ refresh: true })

    expect(snapshot.fromCache).toBe(true)
    expect(snapshot.packages.map((pkg) => pkg.id)).toEqual([
      'q2pro-1.0.0',
      'q2pro-2.0.0',
      'q2-demo',
    ])
  })
})

describe('a cold cache', () => {
  it('fails loudly when the network is dead and nothing has ever been cached', async () => {
    serveOffline()

    const manifests = service()

    await expect(manifests.getManifest()).rejects.toBeInstanceOf(ManifestUnavailableError)
    await expect(manifests.getManifest()).rejects.toMatchObject({ code: 'manifest-unavailable' })
    // No snapshot was ever served, so there is nothing to pin against either.
    expect(manifests.pinnedEnginePackage('q2pro')).toBeUndefined()
  })

  it('fails loudly when the first fetch is refused, rather than caching an empty snapshot', async () => {
    serve({ schemaVersion: 99, packages: [] }, gamedataManifest)

    const manifests = service()

    await expect(manifests.getManifest()).rejects.toBeInstanceOf(ManifestUnavailableError)
    // A refusal must not leave a cache file behind that a later run would trust.
    await expect(readFile(manifestCacheFilePath(), 'utf8')).rejects.toThrow()
  })

  it('fails loudly when the cache file on disk is unusable', async () => {
    await seedGoodFetch(service())

    // A cache whose own envelope cannot be trusted is no cache at all - version
    // bumped past what this build understands.
    const path = manifestCacheFilePath()
    const document = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
    await writeFile(path, JSON.stringify({ ...document, cacheVersion: 999 }), 'utf8')

    serveOffline()
    await expect(service().getManifest()).rejects.toBeInstanceOf(ManifestUnavailableError)
  })
})
