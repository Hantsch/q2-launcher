import { join } from 'node:path'
import { z } from 'zod'
import type { EngineKind } from '@shared/types'
import type { ManifestPackage, ManifestSnapshot } from '@shared/modules/downloads'
import { CachedContentDocument, fetchContentJson } from '../../lib/content-repo'
import type { Logger } from '../../lib/logger'
import { userDataDir } from '../../lib/paths'
import { PRODUCTION_DOWNLOAD_SOURCE, type DownloadSource } from './source'
import { packagePlatforms, packageRunsOnPlatform, parseManifestFile } from './manifest-parse'
import type { PlatformTaggedManifestPackage } from './manifest-schemas'

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

/**
 * The packages/pins of one merged manifest; when they were fetched is the document's `fetchedAt`.
 *
 * Story 100 D5: `PlatformTaggedManifestPackage`, so the manifest's own `platforms` tag survives
 * statically as far as `pinnedEnginePackage()`'s re-check. The shared `ManifestSnapshot` the
 * renderer receives stays plain `ManifestPackage[]` - by then the pin is already resolved for
 * this host, so the renderer has no platform decision left to make.
 */
interface ManifestBody {
  packages: PlatformTaggedManifestPackage[]
  pinned: Partial<Record<EngineKind, string>>
  /**
   * Story 100 D7: whether either merged file's raw `pinned` object configured at least one entry
   * for any engine, on any platform - `parseManifestFile`'s own `hasAnyPin`, ORed across both
   * files. Feeds `ManifestService.hasAnyPinnedEntries()`, which `bootstrapEngineOptions`
   * (`main/modules/downloads/index.ts`) uses to tell "nothing pinned at all" apart from "nothing
   * pinned for this host's platform" once `pinnedEnginePackage()` has come back empty either way.
   */
  hasAnyPin: boolean
}

export interface ManifestServiceOptions {
  log: Logger
  /**
   * Story 074 D8: where manifests are fetched from and how strictly package URLs are validated,
   * resolved **once** by `resolveDownloadSource()` (`harness.ts`) when the app context is
   * built (`context.ts`). Defaults to `PRODUCTION_DOWNLOAD_SOURCE`, so every existing caller and every
   * test keeps the production behaviour without passing anything.
   */
  source?: DownloadSource
  /**
   * Story 100 D5: the host platform pins are resolved for. Defaults to the running platform, so
   * every existing caller keeps today's behaviour; injected as a plain value (same convention as
   * `source` above) so a test can prove the Linux reading without stubbing anything global.
   */
  platform?: NodeJS.Platform
}

export interface GetManifestOptions {
  /** Always attempt a fetch, whatever the in-memory window says. */
  refresh?: boolean
}

export class ManifestService {
  private readonly log: Logger
  /** Resolved once by the caller; never re-read from the environment. See `harness.ts`. */
  private readonly source: DownloadSource
  /** Story 100 D5: resolved once by the caller (or from the host); never re-read per call. */
  private readonly platform: NodeJS.Platform
  private readonly document: CachedContentDocument<ManifestBody>
  /** Whatever `getManifest()` last handed out, for `pinnedEnginePackage()`. */
  private current: ManifestBody | null = null

  constructor(options: ManifestServiceOptions) {
    this.log = options.log
    // Assigned before the document below, whose schema closure reads them.
    this.source = options.source ?? PRODUCTION_DOWNLOAD_SOURCE
    // platform-read: injectable default, tests pass their own
    this.platform = options.platform ?? process.platform
    // Nothing is fetched and nothing is read here: the cache is loaded lazily on
    // the first `getManifest()`, so constructing this service is free (AC: zero
    // fetches at construction, no manifest traffic at boot).
    this.document = new CachedContentDocument<ManifestBody>({
      filePath: manifestCacheFilePath(),
      freshnessMs: MANIFEST_FRESHNESS_MS,
      cacheVersion: MANIFEST_CACHE_VERSION,
      label: 'manifest',
      log: this.log,
      // Structural check only; the rows are re-validated by `parseManifestFile`, the parser the
      // network path uses, because a hand-edited cache file deserves the same suspicion as a
      // downloaded one. `hasAnyPin` is re-derived, never read back, so a cache written before it
      // existed loads like a new one. (Story 074 D8, story 100 D5: same URL rule and platform.)
      schema: z
        .object({ packages: z.array(z.unknown()), pinned: z.record(z.string(), z.string()).optional() })
        .transform((body, ctx): ManifestBody => {
          const parsed = parseManifestFile(
            { schemaVersion: 1, packages: body.packages, pinned: body.pinned },
            this.log,
            { httpsOnly: this.source.httpsOnly, platform: this.platform },
          )
          if (!parsed.ok) {
            ctx.addIssue({ code: 'custom', message: parsed.reason })
            return z.NEVER
          }
          return { packages: parsed.packages, pinned: parsed.pinned, hasAnyPin: parsed.hasAnyPin }
        }),
      fetch: () => this.fetchAndMerge(),
    })
  }

  /**
   * The current manifest: a fresh in-memory snapshot, a newly fetched one, or -
   * when the fetch attempt failed or was refused - the last good cached copy
   * with its real age. Rejects with `ManifestUnavailableError` when there is
   * neither a usable fetch nor a cached copy.
   */
  async getManifest(options: GetManifestOptions = {}): Promise<ManifestSnapshot> {
    const result = await this.document.get(options)
    if (result.status === 'unavailable') {
      this.log.error(`manifest unavailable and no cached copy exists: ${result.reason}`)
      throw new ManifestUnavailableError(result.reason)
    }
    if (result.fromCache) {
      this.log.warn(`serving the cached manifest: ${result.fallbackReason}`)
    }
    return this.serve(result.data, result.fetchedAt, {
      fromCache: result.fromCache,
      ageMs: result.ageMs,
    })
  }

  /**
   * The package the manifest pins as the default build for `kind`, resolved
   * against the snapshot `getManifest()` last served - `undefined` when there is
   * no pin, the pin names no package, the resolved package is not an `engine`
   * package for this exact `kind` (a manifest bug or an id collision must never
   * hand back a gamedata package or a different engine's build), or no
   * snapshot has been served yet.
   *
   * Story 100 D5: or when the resolved package does not run on this host's platform. The pins in
   * the snapshot were already resolved for `this.platform` by `parseManifestFile`, so this is the
   * same belt-and-braces re-check the `kind`/`engine` test above is - it is what keeps a snapshot
   * that came from somewhere else (a cache file carried between machines, a future caller that
   * builds `SnapshotContent` itself) from handing back a binary this host cannot execute.
   */
  pinnedEnginePackage(kind: EngineKind): ManifestPackage | undefined {
    const snapshot = this.current
    if (snapshot === null) return undefined
    const id = snapshot.pinned[kind]
    if (id === undefined) return undefined
    const pkg = snapshot.packages.find((p) => p.id === id)
    if (pkg === undefined) return undefined
    if (!packageRunsOnPlatform(pkg, this.platform)) {
      this.log.warn(
        `manifest pin for engine "${kind}" dropped: package "${id}" declares platforms ` +
          `[${packagePlatforms(pkg).join(', ')}] and this host is "${this.platform}"`,
      )
      return undefined
    }
    if (pkg.kind !== 'engine' || pkg.engine !== kind) {
      this.log.warn(
        `manifest pin for engine "${kind}" dropped: package id "${id}" is not an "${kind}" engine package`,
      )
      return undefined
    }
    return pkg
  }

  /**
   * Story 100 D7: whether the snapshot `getManifest()` last served configured at least one pin,
   * for any engine, on any platform - regardless of whether any of those pins resolve for this
   * host. `false` when no snapshot has been served yet, same "nothing known yet" default as
   * `pinnedEnginePackage()` returning `undefined` in that case.
   *
   * `bootstrapEngineOptions` (`main/modules/downloads/index.ts`) uses this to tell
   * `'none-for-platform'` apart from `'none-pinned'` once its own `options` array has come back
   * empty either way.
   */
  hasAnyPinnedEntries(): boolean {
    return this.current?.hasAnyPin ?? false
  }

  private serve(
    content: ManifestBody,
    fetchedAt: string,
    meta: { fromCache: boolean; ageMs: number },
  ): ManifestSnapshot {
    this.current = content
    return {
      schemaVersion: 1,
      packages: content.packages,
      pinned: content.pinned,
      fetchedAt,
      ageMs: meta.ageMs,
      fromCache: meta.fromCache,
    }
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
  private async fetchAndMerge(): Promise<ManifestBody> {
    const paths = [ENGINES_MANIFEST_PATH, GAMEDATA_MANIFEST_PATH]
    const results = await Promise.allSettled(
      paths.map((path) => fetchContentJson(path, { baseUrl: this.source.baseUrl })),
    )

    const packages: PlatformTaggedManifestPackage[] = []
    const pins: Partial<Record<EngineKind, string>>[] = []
    let hasAnyPin = false

    for (const [index, result] of results.entries()) {
      const path = paths[index]
      if (result.status === 'rejected') {
        this.log.warn(`fetching ${path} failed: ${String(result.reason)}`)
        throw new Error(`fetching ${path} failed`)
      }
      const parsed = parseManifestFile(result.value, this.log, {
        httpsOnly: this.source.httpsOnly,
        platform: this.platform,
      })
      if (!parsed.ok) {
        throw new Error(`${path} was refused (${parsed.reason})`)
      }
      packages.push(...parsed.packages)
      pins.push(parsed.pinned)
      // Story 100 D7: either file configuring at least one pin is enough - a manifest genuinely
      // pinning nothing at all needs BOTH files to pin nothing.
      hasAnyPin = hasAnyPin || parsed.hasAnyPin
    }

    return {
      packages,
        // Each file's pins were already resolved (by id, against that file's own
        // survivors) by `parseManifestFile`, so a gamedata file cannot smuggle in
        // an engine pin id that never existed; merging in fetch order keeps
        // `engines/` authoritative for engine pins if both ever name one. This
        // does not by itself guarantee the resolved package is an `engine`
        // package matching the pinned kind - `pinnedEnginePackage()` re-checks
        // `kind`/`engine` before handing a package back.
        pinned: pins.reduceRight((merged, pin) => ({ ...merged, ...pin }), {}),
      hasAnyPin,
    }
  }

  /** Resolves once pending writes have reached the disk; `ok: false` if one failed. */
  settle(): Promise<{ ok: boolean }> {
    return this.document.settle()
  }
}
