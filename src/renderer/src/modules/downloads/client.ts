import {
  DOWNLOADS_HANDLERS,
  type ArchiveCacheStatus,
  type BootstrapDataSource,
  type BootstrapEngineOptionsResult,
  type BootstrapSummary,
  type BootstrapTargetVerdict,
  type ClearArchiveCacheResult,
  type DetectedRetailSource,
  type DownloadFailure,
  type DownloadsSettings,
  type EngineUpdateStatus,
  type GameDataSourceVerdict,
  type RepairPlan,
  type SetBleedingEdgeInput,
  type StartBootstrapInput,
  type StartEngineUpdateInput,
  type StartEngineUpdateResult,
  type StartRepairInput,
  type StartRepairResult,
  type StartRetailUpgradeInput,
  type StartRetailUpgradeResult,
} from '@shared/modules/downloads'
import type { EngineKind, Outcome } from '@shared/types'
import { callModule } from '../moduleClient'

/** Typed client for the downloads module's settings/cache handlers (story 072). One function
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

/** Story 073: the persisted, pruned failure log (`downloads.failures`). */
export function getDownloadFailures(): Promise<Outcome<DownloadFailure[]>> {
  return callModule<DownloadFailure[]>('downloads', DOWNLOADS_HANDLERS.failures)
}

/** Marks one failure-log entry dismissed; it stays recoverable for 7 days. */
export function dismissDownloadFailure(id: string): Promise<Outcome<DownloadFailure[]>> {
  return callModule<DownloadFailure[]>('downloads', DOWNLOADS_HANDLERS.dismissFailure, { id })
}

/** Un-dismisses a failure-log entry, moving it back out of the dismissed history. */
export function restoreDownloadFailure(id: string): Promise<Outcome<DownloadFailure[]>> {
  return callModule<DownloadFailure[]>('downloads', DOWNLOADS_HANDLERS.restoreFailure, { id })
}

/**
 * Story 074: lists the engines the bootstrap wizard can offer this sprint - only Q2PRO today
 * (`BOOTSTRAP_SUPPORTED_ENGINES`, `@shared/modules/downloads`). An empty array is a legitimate
 * answer (nothing pinned yet), not a failure - see the handler's own doc comment in
 * `main/modules/downloads/index.ts`.
 *
 * Story 100: answers a `BootstrapEngineOptionsResult` (options plus an `emptyReason`) rather
 * than the bare options array - see that type's own doc comment.
 */
export function getBootstrapEngineOptions(): Promise<Outcome<BootstrapEngineOptionsResult>> {
  return callModule<BootstrapEngineOptionsResult>(
    'downloads',
    DOWNLOADS_HANDLERS.bootstrapEngineOptions,
  )
}

/**
 * Story 088: the detected Steam/GOG/Epic Quake II sources the wizard's game-data step
 * can offer to copy from - an empty array is a legitimate "nothing detected", not a failure (see the
 * handler's own doc comment in `main/modules/downloads/index.ts`).
 */
export function getDetectedRetailSources(): Promise<Outcome<DetectedRetailSource[]>> {
  return callModule<DetectedRetailSource[]>('downloads', DOWNLOADS_HANDLERS.bootstrapRetailSources)
}

/**
 * Story 074: the verdict for a candidate target folder. The wizard renders this verdict -
 * it never judges a path itself, and it never re-derives `blocked` from the other fields.
 */
export function getBootstrapTargetVerdict(
  targetPath: string,
): Promise<Outcome<BootstrapTargetVerdict>> {
  return callModule<BootstrapTargetVerdict>(
    'downloads',
    DOWNLOADS_HANDLERS.bootstrapTargetVerdict,
    {
      targetPath,
    },
  )
}

/**
 * Story 089: the verdict for a hand-picked game-data folder - not wired to a handler yet; this only prepares the client the wizard will call later. Same
 * no-failure-mode convention as `getBootstrapTargetVerdict` above: every answer is a verdict,
 * including `kind: 'unusable'`.
 */
export function getGameDataSourceVerdict(
  rootPath: string,
): Promise<Outcome<GameDataSourceVerdict>> {
  return callModule<GameDataSourceVerdict>(
    'downloads',
    DOWNLOADS_HANDLERS.bootstrapGameDataSource,
    {
      rootPath,
    },
  )
}

/**
 * Story 074: the packages a bootstrap would download and their summed size.
 *
 * Story 088: `dataSource`/`copySourcePath` are optional and mean exactly what
 * `StartBootstrapInput`'s own fields mean - so the confirm step's summary is always computed from
 * the same payload the run would start with.
 */
export function getBootstrapSummary(input: {
  engine: EngineKind
  targetPath: string
  includeVideoAndPlayers: boolean
  dataSource?: BootstrapDataSource
  copySourcePath?: string
}): Promise<Outcome<BootstrapSummary>> {
  return callModule<BootstrapSummary>('downloads', DOWNLOADS_HANDLERS.bootstrapSummary, input)
}

/**
 * Story 074: starts the bootstrap job and answers its `Job.id` plus the id of the
 * installation it registered. Returns as soon as the job exists - progress arrives through
 * `jobs:changed`, never through this promise.
 */
export function startBootstrapInstall(
  input: StartBootstrapInput,
): Promise<Outcome<{ jobId: string; installationId: string }>> {
  return callModule<{ jobId: string; installationId: string }>(
    'downloads',
    DOWNLOADS_HANDLERS.bootstrapStart,
    input,
  )
}

/**
 * Story 090: starts the retail-upgrade job for one demo installation. Main's
 * `retail.upgradeStart` handler (`src/main/modules/downloads/index.ts`) is a thin wrapper around
 * the real `startRetailUpgrade` (`src/main/modules/downloads/retail/upgrade-job.ts`).
 *
 */
export function startRetailUpgrade(
  input: StartRetailUpgradeInput,
): Promise<Outcome<StartRetailUpgradeResult>> {
  return callModule<StartRetailUpgradeResult>(
    'downloads',
    DOWNLOADS_HANDLERS.retailUpgradeStart,
    input,
  )
}

/**
 * Story 092: one installation's `EngineUpdateStatus` - a thin wrapper around
 * main's `engine.updateStatus` handler (`src/main/modules/downloads/index.ts`), which has no
 * failure mode of its own and answers `undefined` for an installation it no longer knows about
 * (same "every answer is a verdict" convention as `getBootstrapTargetVerdict`).
 */
export function getEngineUpdateStatus(
  installationId: string,
): Promise<Outcome<EngineUpdateStatus | undefined>> {
  return callModule<EngineUpdateStatus | undefined>(
    'downloads',
    DOWNLOADS_HANDLERS.engineUpdateStatus,
    { installationId },
  )
}

/**
 * Story 092: starts the engine-update job for one installation.
 */
export function startEngineUpdate(
  input: StartEngineUpdateInput,
): Promise<Outcome<StartEngineUpdateResult>> {
  return callModule<StartEngineUpdateResult>(
    'downloads',
    DOWNLOADS_HANDLERS.engineUpdateStart,
    input,
  )
}

/**
 * Story 092: starts the engine-rollback job for one installation. Same shape as
 * `startEngineUpdate` above - `engine.rollbackStart` answers a `StartEngineUpdateResult`
 * too (`@shared/modules/downloads`'s own doc comment on that type).
 */
export function startEngineRollback(
  input: StartEngineUpdateInput,
): Promise<Outcome<StartEngineUpdateResult>> {
  return callModule<StartEngineUpdateResult>(
    'downloads',
    DOWNLOADS_HANDLERS.engineRollbackStart,
    input,
  )
}

/**
 * Story 092: flips one installation's engine-update channel. `engine.setBleedingEdge`
 * answers `Outcome<void>` itself.
 */
export function setEngineBleedingEdge(input: SetBleedingEdgeInput): Promise<Outcome<void>> {
  return callModule<void>('downloads', DOWNLOADS_HANDLERS.engineSetBleedingEdge, input)
}

/**
 * Story 093: one installation's `RepairPlan`, built from a fresh inspection on every
 * call - main's `repair.plan` handler never reads a stored/cached checks snapshot.
 * `undefined` (installation not found) is a legitimate answer rather than a failure.
 */
export function getRepairPlan(installationId: string): Promise<Outcome<RepairPlan | undefined>> {
  return callModule<RepairPlan | undefined>('downloads', DOWNLOADS_HANDLERS.repairPlan, {
    installationId,
  })
}

/**
 * Story 093: starts the repair job for the offers the repair dialog's user authorised.
 *
 */
export function startRepair(input: StartRepairInput): Promise<Outcome<StartRepairResult>> {
  return callModule<StartRepairResult>('downloads', DOWNLOADS_HANDLERS.repairStart, input)
}
