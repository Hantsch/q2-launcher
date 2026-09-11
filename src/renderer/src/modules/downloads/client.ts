import {
  DOWNLOADS_HANDLERS,
  type ArchiveCacheStatus,
  type BootstrapDataSource,
  type BootstrapEngineOption,
  type BootstrapSummary,
  type BootstrapTargetVerdict,
  type ClearArchiveCacheResult,
  type DetectedRetailSource,
  type DownloadFailure,
  type DownloadsSettings,
  type GameDataSourceVerdict,
  type StartBootstrapInput,
} from '@shared/modules/downloads'
import type { EngineKind, Outcome } from '@shared/types'
import { callModule } from '../moduleClient'

/** Typed client for the downloads module's settings/cache handlers (story 072 D5). One function
 * per handler in its contract - mirrors `modules/library/client.ts`. */
export function getDownloadsSettings(): Promise<Outcome<DownloadsSettings>> {
  return callModule<DownloadsSettings>('downloads', DOWNLOADS_HANDLERS.getSettings)
}

export function patchDownloadsSettings(
  patch: Partial<DownloadsSettings>,
): Promise<Outcome<DownloadsSettings>> {
  return callModule<DownloadsSettings>('downloads', DOWNLOADS_HANDLERS.patchSettings, patch)
}

export function getArchiveCacheStatus(): Promise<Outcome<ArchiveCacheStatus>> {
  return callModule<ArchiveCacheStatus>('downloads', DOWNLOADS_HANDLERS.cacheStatus)
}

export function clearArchiveCache(): Promise<Outcome<ClearArchiveCacheResult>> {
  return callModule<ClearArchiveCacheResult>('downloads', DOWNLOADS_HANDLERS.clearCache)
}

/** Story 073 D3/D4: the persisted, pruned failure log (`downloads.failures`, D1/D2). */
export function getDownloadFailures(): Promise<Outcome<DownloadFailure[]>> {
  return callModule<DownloadFailure[]>('downloads', DOWNLOADS_HANDLERS.failures)
}

/** Marks one failure-log entry dismissed; it stays recoverable for 7 days (D1/D2). */
export function dismissDownloadFailure(id: string): Promise<Outcome<DownloadFailure[]>> {
  return callModule<DownloadFailure[]>('downloads', DOWNLOADS_HANDLERS.dismissFailure, { id })
}

/** Un-dismisses a failure-log entry, moving it back out of the dismissed history (D1/D2). */
export function restoreDownloadFailure(id: string): Promise<Outcome<DownloadFailure[]>> {
  return callModule<DownloadFailure[]>('downloads', DOWNLOADS_HANDLERS.restoreFailure, { id })
}

/**
 * Story 074 D1: lists the engines the bootstrap wizard can offer this sprint - only Q2PRO today
 * (`BOOTSTRAP_SUPPORTED_ENGINES`, `@shared/modules/downloads`). An empty array is a legitimate
 * answer (nothing pinned yet), not a failure - see the handler's own doc comment in
 * `main/modules/downloads/index.ts`.
 */
export function getBootstrapEngineOptions(): Promise<Outcome<BootstrapEngineOption[]>> {
  return callModule<BootstrapEngineOption[]>('downloads', DOWNLOADS_HANDLERS.bootstrapEngineOptions)
}

/**
 * Story 088 D2 (AC1/AC2): the detected Steam/GOG/Epic Quake II sources the wizard's game-data step
 * can offer to copy from - an empty array is a legitimate "nothing detected", not a failure (see the
 * handler's own doc comment in `main/modules/downloads/index.ts`).
 */
export function getDetectedRetailSources(): Promise<Outcome<DetectedRetailSource[]>> {
  return callModule<DetectedRetailSource[]>('downloads', DOWNLOADS_HANDLERS.bootstrapRetailSources)
}

/**
 * Story 074 D4 (AC3): the verdict for a candidate target folder. The wizard renders this verdict -
 * it never judges a path itself, and it never re-derives `blocked` from the other fields.
 */
export function getBootstrapTargetVerdict(
  targetPath: string,
): Promise<Outcome<BootstrapTargetVerdict>> {
  return callModule<BootstrapTargetVerdict>('downloads', DOWNLOADS_HANDLERS.bootstrapTargetVerdict, {
    targetPath,
  })
}

/**
 * Story 089 D1: the verdict for a hand-picked game-data folder - not wired to a handler yet (D3
 * implements it); D1 only prepares the client the wizard's later deliverable will call. Same
 * no-failure-mode convention as `getBootstrapTargetVerdict` above: every answer is a verdict,
 * including `kind: 'unusable'`.
 */
export function getGameDataSourceVerdict(
  rootPath: string,
): Promise<Outcome<GameDataSourceVerdict>> {
  return callModule<GameDataSourceVerdict>('downloads', DOWNLOADS_HANDLERS.bootstrapGameDataSource, {
    rootPath,
  })
}

/**
 * Story 074 D4 (AC4): the packages a bootstrap would download and their summed size.
 *
 * The main handler answers an `Outcome` as the transport-level `Outcome`'s own value, so a raw
 * `callModule` here would yield `Outcome<Outcome<BootstrapSummary>>`; this flattens that one level,
 * the same way `assignConfigProfile` (`modules/config/client.ts`) does.
 *
 * Story 088 D5: `dataSource`/`copySourcePath` are optional and mean exactly what
 * `StartBootstrapInput`'s own fields mean - so the confirm step's summary is always computed from
 * the same payload the run would start with.
 */
export async function getBootstrapSummary(input: {
  engine: EngineKind
  targetPath: string
  includeVideoAndPlayers: boolean
  dataSource?: BootstrapDataSource
  copySourcePath?: string
}): Promise<Outcome<BootstrapSummary>> {
  const result = await callModule<Outcome<BootstrapSummary>>(
    'downloads',
    DOWNLOADS_HANDLERS.bootstrapSummary,
    input,
  )
  return result.ok ? result.value : result
}

/**
 * Story 074 D4 (AC5): starts the bootstrap job and answers its `Job.id` plus the id of the
 * installation it registered. Returns as soon as the job exists - progress arrives through
 * `jobs:changed`, never through this promise. Flattened for the same reason as above.
 */
export async function startBootstrapInstall(
  input: StartBootstrapInput,
): Promise<Outcome<{ jobId: string; installationId: string }>> {
  const result = await callModule<Outcome<{ jobId: string; installationId: string }>>(
    'downloads',
    DOWNLOADS_HANDLERS.bootstrapStart,
    input,
  )
  return result.ok ? result.value : result
}
