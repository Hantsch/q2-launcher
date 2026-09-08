import type { EngineKind } from '@shared/types'
import type { ManifestPackage } from '@shared/modules/downloads'
import type { DiagnosticsCollector } from '../diagnostics'
import { extractArchive } from '../extractor'
import { downloadPackage } from '../fetcher'
import { ManifestUnavailableError, type ManifestService } from '../manifest-service'
import type { DownloadFn, ExtractFn } from '../pipeline'

/**
 * Story 074 D4: the three seams the bootstrap job reaches the outside world through - the
 * manifest, the network and the extractor - plus their production adapters.
 *
 * Ports rather than direct imports, for the reason the sprint's decisions name: "070/071 are being
 * refined in parallel; a port keeps the orchestrator unit-testable with fakes". The job's own
 * correctness is a *sequencing* property (create, download, extract, assemble, revalidate, mark
 * playable, clean up on cancel), and proving a sequence needs fetches and extractions that resolve
 * instantly and deterministically - not a real 190 MB download and a real `7za.exe`.
 *
 * The two function-shaped ports deliberately reuse `DownloadFn`/`ExtractFn` from `../pipeline`:
 * those aliases already describe exactly `downloadPackage`/`extractArchive`, and a second,
 * hand-copied description of the same two functions is how the two flows would drift apart.
 */

/** The game-data roles a bootstrap needs, as the manifest tags them. */
export type GameDataRole = Extract<ManifestPackage, { kind: 'gamedata' }>['role']

/**
 * Resolves the packages a bootstrap installs. Both methods answer `undefined` for every reason the
 * job treats identically - no such package, no pin, or no manifest at all - because the remedy the
 * user is offered is the same in each case (`downloads.error.packageUnavailable`); the *reason* is
 * logged by the adapter, where it is still known.
 */
export interface ManifestSource {
  /** The manifest's pinned build for `engine`. */
  resolveEnginePackage(engine: EngineKind): Promise<ManifestPackage | undefined>
  /** The manifest's game-data package for `role`. */
  resolveGameDataPackage(role: GameDataRole): Promise<ManifestPackage | undefined>
}

/** Narrow view of `downloadPackage` (`../fetcher`). */
export interface PackageFetcher {
  fetch: DownloadFn
}

/** Narrow view of `extractArchive` (`../extractor`). */
export interface Extractor {
  extract: ExtractFn
}

/**
 * Story 075 D3: how the bootstrap job reaches the diagnostics collector (`../diagnostics.ts`).
 *
 * A *factory*, not a collector: `createDiagnosticsCollector` is keyed by the job id, and that id
 * does not exist until `startBootstrap` has created the `Job` - long after `bootstrapDepsFor()`
 * (`../index.ts`) built the deps. So the wiring hands in the means of making one and the job makes
 * it the moment it has an id to key it by.
 *
 * Optional on `BootstrapDeps`: a job without one records nothing and behaves exactly as it did
 * before this story. The collector observes the job; it never influences what the job does.
 */
export type BootstrapDiagnosticsSource = (jobId: string, kind: string) => DiagnosticsCollector

/** Structurally satisfied by `Logger` (`src/main/lib/logger.ts`). */
export interface BootstrapLog {
  info(message: string): void
  warn(message: string): void
  debug?(message: string): void
}

/**
 * The production `ManifestSource`, over the module's own `ManifestService`.
 *
 * `getManifest()` is awaited before every resolution rather than once at construction: it owns a
 * 15-minute in-memory freshness window plus the on-disk cache fallback, so repeating the call is
 * cheap, and doing it lazily is what keeps constructing this adapter free of network traffic (the
 * same property `ManifestService`'s own constructor has). `pinnedEnginePackage()` reads the
 * snapshot that call last served, which is why the order matters and not just the result.
 *
 * **Gamedata packages are picked as "the first package with this role".** The manifest's `pinned`
 * map is engine-only (`ManifestSnapshot.pinned` is a `Partial<Record<EngineKind, string>>`), so
 * there is no pin to honour for a demo or a point release; this sprint's `gamedata/manifest.json`
 * ships exactly one of each, and picking the first keeps the choice a property of the manifest's
 * own order rather than of an id convention this file would have to invent.
 */
export function manifestSourceFrom(
  service: ManifestService,
  log?: BootstrapLog,
): ManifestSource {
  /** Never throws: a manifest that cannot be produced is "no packages", which each resolver below
   * turns into `undefined` - the job's single "a required package is unavailable" failure. */
  const packages = async (): Promise<ManifestPackage[]> => {
    try {
      const snapshot = await service.getManifest()
      return snapshot.packages
    } catch (error) {
      if (error instanceof ManifestUnavailableError) {
        log?.warn(`bootstrap could not resolve any package: ${error.message}`)
        return []
      }
      throw error
    }
  }

  return {
    async resolveEnginePackage(engine) {
      // The snapshot has to have been served before `pinnedEnginePackage()` can resolve against
      // it - it reads whatever `getManifest()` last handed out, and answers `undefined` otherwise.
      if ((await packages()).length === 0) return undefined
      const pkg = service.pinnedEnginePackage(engine)
      if (pkg === undefined) log?.warn(`the manifest pins no ${engine} build`)
      return pkg
    },

    async resolveGameDataPackage(role) {
      const pkg = (await packages()).find((entry) => entry.kind === 'gamedata' && entry.role === role)
      if (pkg === undefined) log?.warn(`the manifest lists no "${role}" game-data package`)
      return pkg
    },
  }
}

/** The production `PackageFetcher`. */
export const realPackageFetcher: PackageFetcher = { fetch: downloadPackage }

/** The production `Extractor`. */
export const realExtractor: Extractor = { extract: extractArchive }
