import { join } from 'node:path'
import { z } from 'zod'
import type { EngineKind } from '@shared/types'
import type { ManifestPackage, ManifestSnapshot } from '@shared/modules/downloads'
import { fetchContentJson } from '../../lib/content-repo'
import { JsonStore } from '../../lib/json-store'
import type { Logger } from '../../lib/logger'
import { userDataDir } from '../../lib/paths'
import { parseManifestFile } from './manifest-parse'

/**
 * Story 070 D3: the manifest pipeline's stateful half - fetch both manifest
 * files, merge them into one `ManifestSnapshot`, persist the result, and serve
 * the last good copy when a fetch attempt cannot produce a new one.
 *
 * Three concepts that are easy to conflate live here, deliberately kept apart:
 *
 *  - **in-memory freshness** (`FRESHNESS_MS`): an anti-chatter window. A
 *    snapshot this process fetched itself less than 15 minutes ago is served
 *    again without touching the network. It is *not* "from cache" - the data is
 *    simply still fresh, so `fromCache` stays `false`. Only a live fetch made by
 *    *this* instance opens the window: a cache document read off disk (written by
 *    an earlier run) never counts as fresh, or the first `getManifest()` after a
 *    restart would silently skip the refresh the user expects.
 *  - **the persisted cache** (`manifest-cache.json`): the fallback used *only*
 *    when a real fetch attempt failed. Serving it sets `fromCache: true` and a
 *    real `ageMs`.
 *  - **nothing cached at all**: a failed fetch with no cached copy is an error
 *    (`ManifestUnavailableError`), never an empty snapshot. Zero packages that
 *    look like valid data are worse than an explicit failure - D4 turns this
 *    error into the `downloads.error.manifestUnavailable` key.
 *
 * A failed fetch and a *refused* manifest (bad `schemaVersion`, broken envelope -
 * `parseManifestFile`) are the same event to this service: neither can produce a
 * snapshot, so both fall back to the cache.
 */

/** Both manifest files, fetched together and merged into one snapshot. */
export const ENGINES_MANIFEST_PATH = 'engines/manifest.json'
export const GAMEDATA_MANIFEST_PATH = 'gamedata/manifest.json'

/** How long a snapshot this process fetched itself is reused without refetching. */
export const MANIFEST_FRESHNESS_MS = 15 * 60 * 1000

/**
 * Version of the *cache file's own* envelope - unrelated to the manifest's
 * `schemaVersion`. Bumping this discards existing cache files instead of trying
 * to read an older layout; a cache is regenerable, so migrating it would be
 * effort spent on data nobody would miss.
 */
export const MANIFEST_CACHE_VERSION = 1

export const MANIFEST_CACHE_DIR_SEGMENTS = ['cache', 'downloads'] as const
export const MANIFEST_CACHE_FILE_NAME = 'manifest-cache.json'

/** `userData/cache/downloads/manifest-cache.json`. */
export function manifestCacheFilePath(): string {
  return join(userDataDir(), ...MANIFEST_CACHE_DIR_SEGMENTS, MANIFEST_CACHE_FILE_NAME)
}

/**
 * Thrown when a fetch attempt produced nothing *and* no cached manifest exists.
 * Carries a stable `code` next to the `instanceof` check so D4's IPC handler can
 * tell it apart from a programming error without matching on the message.
 */
export class ManifestUnavailableError extends Error {
  public readonly code = 'manifest-unavailable'

  constructor(reason: string) {
    super(`manifest unavailable: ${reason}, and nothing has ever been cached`)
    this.name = 'ManifestUnavailableError'
  }
}

/** The packages/pins of one merged manifest, plus when they were fetched. */
interface SnapshotContent {
  packages: ManifestPackage[]
  pinned: Partial<Record<EngineKind, string>>
  /** ISO timestamp of the successful fetch these packages came from. */
  fetchedAt: string
}

/** The cache file's document. `fetchedAt: null` is "nothing has ever been cached". */
interface ManifestCacheDocument {
  cacheVersion: number
  fetchedAt: string | null
  packages: ManifestPackage[]
  pinned: Partial<Record<EngineKind, string>>
}

/**
 * Structural check on the cache file only. The `packages`/`pinned` payload is
 * re-validated row by row further down by `parseManifestFile` - the same parser
 * the network path uses, rather than a second copy of its rules, because a
 * hand-edited or half-migrated cache file deserves exactly the same suspicion as
 * a downloaded one.
 */
const cacheEnvelopeSchema = z.object({
  cacheVersion: z.number(),
  fetchedAt: z.string().min(1),
  packages: z.array(z.unknown()),
  pinned: z.record(z.string(), z.string()).optional(),
})

function emptyCache(): ManifestCacheDocument {
  return { cacheVersion: MANIFEST_CACHE_VERSION, fetchedAt: null, packages: [], pinned: {} }
}

/**
 * Never throws (a `JsonStore` `parse` may not). Anything it cannot fully vouch
 * for becomes "nothing cached", which makes a failed fetch an error rather than
 * a snapshot built from junk.
 */
function parseCacheDocument(raw: unknown, log: Logger): ManifestCacheDocument {
  const envelope = cacheEnvelopeSchema.safeParse(raw)
  if (!envelope.success) {
    log.warn('manifest cache discarded: malformed cache envelope')
    return emptyCache()
  }
  if (envelope.data.cacheVersion !== MANIFEST_CACHE_VERSION) {
    log.warn(
      `manifest cache discarded: cacheVersion ${envelope.data.cacheVersion} (expected ${MANIFEST_CACHE_VERSION})`,
    )
    return emptyCache()
  }
  if (Number.isNaN(Date.parse(envelope.data.fetchedAt))) {
    log.warn('manifest cache discarded: unreadable fetchedAt (its age could not be computed)')
    return emptyCache()
  }

  const parsed = parseManifestFile(
    {
      schemaVersion: 1,
      packages: envelope.data.packages,
      pinned: envelope.data.pinned,
    },
    log,
  )
  if (!parsed.ok) {
    log.warn(`manifest cache discarded: ${parsed.reason}`)
    return emptyCache()
  }

  return {
    cacheVersion: MANIFEST_CACHE_VERSION,
    fetchedAt: envelope.data.fetchedAt,
    packages: parsed.packages,
    pinned: parsed.pinned,
  }
}

export interface ManifestServiceOptions {
  log: Logger
}

export interface GetManifestOptions {
  /** Always attempt a fetch, whatever the in-memory window says. */
  refresh?: boolean
}

type FetchAttempt = { ok: true; content: SnapshotContent } | { ok: false; reason: string }

export class ManifestService {
  private readonly log: Logger
  private readonly store: JsonStore<ManifestCacheDocument>
  private cacheLoaded = false
  /** Set only by a live fetch in this process - see the in-memory freshness note above. */
  private fresh: { content: SnapshotContent; fetchedAtMs: number } | null = null
  /** Whatever `getManifest()` last handed out, for `pinnedEnginePackage()`. */
  private current: SnapshotContent | null = null

  constructor(options: ManifestServiceOptions) {
    this.log = options.log
    // Nothing is fetched and nothing is read here: the store is loaded lazily on
    // the first `getManifest()`, so constructing this service is free (AC: zero
    // fetches at construction, no manifest traffic at boot).
    this.store = new JsonStore<ManifestCacheDocument>({
      filePath: manifestCacheFilePath(),
      defaults: emptyCache,
      parse: (raw) => parseCacheDocument(raw, this.log),
    })
  }

  /**
   * The current manifest: a fresh in-memory snapshot, a newly fetched one, or -
   * when the fetch attempt failed or was refused - the last good cached copy
   * with its real age. Rejects with `ManifestUnavailableError` when there is
   * neither a usable fetch nor a cached copy.
   */
  async getManifest(options: GetManifestOptions = {}): Promise<ManifestSnapshot> {
    const now = Date.now()

    if (options.refresh !== true && this.fresh !== null) {
      const age = now - this.fresh.fetchedAtMs
      if (age >= 0 && age < MANIFEST_FRESHNESS_MS) {
        // Still fresh, not "from cache": no network, no disk, honest age.
        return this.serve(this.fresh.content, { fromCache: false, ageMs: age })
      }
    }

    await this.ensureCacheLoaded()

    const attempt = await this.fetchAndMerge()
    if (attempt.ok) {
      this.fresh = { content: attempt.content, fetchedAtMs: Date.parse(attempt.content.fetchedAt) }
      await this.persist(attempt.content)
      return this.serve(attempt.content, { fromCache: false, ageMs: 0 })
    }

    const cached = this.store.get()
    if (cached.fetchedAt !== null) {
      this.log.warn(`serving the cached manifest: ${attempt.reason}`)
      return this.serve(
        { packages: cached.packages, pinned: cached.pinned, fetchedAt: cached.fetchedAt },
        // Clamped: a clock that moved backwards must not report a negative age.
        { fromCache: true, ageMs: Math.max(0, Date.now() - Date.parse(cached.fetchedAt)) },
      )
    }

    this.log.error(`manifest unavailable and no cached copy exists: ${attempt.reason}`)
    throw new ManifestUnavailableError(attempt.reason)
  }

  /**
   * The package the manifest pins as the default build for `kind`, resolved
   * against the snapshot `getManifest()` last served - `undefined` when there is
   * no pin, the pin names no package, the resolved package is not an `engine`
   * package for this exact `kind` (a manifest bug or an id collision must never
   * hand back a gamedata package or a different engine's build), or no
   * snapshot has been served yet.
   */
  pinnedEnginePackage(kind: EngineKind): ManifestPackage | undefined {
    const snapshot = this.current
    if (snapshot === null) return undefined
    const id = snapshot.pinned[kind]
    if (id === undefined) return undefined
    const pkg = snapshot.packages.find((p) => p.id === id)
    if (pkg === undefined) return undefined
    if (pkg.kind !== 'engine' || pkg.engine !== kind) {
      this.log.warn(
        `manifest pin for engine "${kind}" dropped: package id "${id}" is not an "${kind}" engine package`,
      )
      return undefined
    }
    return pkg
  }

  private serve(
    content: SnapshotContent,
    meta: { fromCache: boolean; ageMs: number },
  ): ManifestSnapshot {
    this.current = content
    return {
      schemaVersion: 1,
      packages: content.packages,
      pinned: content.pinned,
      fetchedAt: content.fetchedAt,
      ageMs: meta.ageMs,
      fromCache: meta.fromCache,
    }
  }

  private async ensureCacheLoaded(): Promise<void> {
    if (this.cacheLoaded) return
    await this.store.load()
    this.cacheLoaded = true
  }

  private async persist(content: SnapshotContent): Promise<void> {
    this.store.set({
      cacheVersion: MANIFEST_CACHE_VERSION,
      fetchedAt: content.fetchedAt,
      packages: content.packages,
      pinned: content.pinned,
    })
    // `JsonStore` swallows write failures (it logs them); awaiting the flush only
    // makes "the fetch has been persisted" true by the time we answer.
    await this.store.settle()
  }

  /**
   * Fetches both manifest files in parallel - each `fetchContentJson` call gets
   * its own independent 10s `AbortSignal.timeout` (it owns the timeout and does
   * not retry), and running them via `Promise.allSettled` means the pair's
   * worst-case wall-clock time is ~10s, not 20s back to back - and merges the
   * survivors.
   *
   * **Either file failing or being refused fails the whole attempt.** A partial
   * merge would publish a snapshot that is missing engines or missing game data
   * while claiming to be current, and that is indistinguishable to every caller
   * downstream from "the content repo dropped those packages" - so the last
   * complete copy from the cache is strictly better information.
   */
  private async fetchAndMerge(): Promise<FetchAttempt> {
    const paths = [ENGINES_MANIFEST_PATH, GAMEDATA_MANIFEST_PATH]
    const results = await Promise.allSettled(paths.map((path) => fetchContentJson(path)))

    const packages: ManifestPackage[] = []
    const pins: Partial<Record<EngineKind, string>>[] = []

    for (const [index, result] of results.entries()) {
      const path = paths[index]
      if (result.status === 'rejected') {
        this.log.warn(`fetching ${path} failed: ${String(result.reason)}`)
        return { ok: false, reason: `fetching ${path} failed` }
      }
      const parsed = parseManifestFile(result.value, this.log)
      if (!parsed.ok) {
        return { ok: false, reason: `${path} was refused (${parsed.reason})` }
      }
      packages.push(...parsed.packages)
      pins.push(parsed.pinned)
    }

    return {
      ok: true,
      content: {
        packages,
        // Each file's pins were already resolved (by id, against that file's own
        // survivors) by `parseManifestFile`, so a gamedata file cannot smuggle in
        // an engine pin id that never existed; merging in fetch order keeps
        // `engines/` authoritative for engine pins if both ever name one. This
        // does not by itself guarantee the resolved package is an `engine`
        // package matching the pinned kind - `pinnedEnginePackage()` re-checks
        // `kind`/`engine` before handing a package back.
        pinned: pins.reduceRight((merged, pin) => ({ ...merged, ...pin }), {}),
        fetchedAt: new Date().toISOString(),
      },
    }
  }
}
