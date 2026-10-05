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
  type DownloadsContract,
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
import { createModuleClient } from '../moduleClient'

const client = createModuleClient<DownloadsContract>('downloads')

/** Typed client for the downloads module. One function per handler in its contract. */
export function getDownloadsSettings(): Promise<Outcome<DownloadsSettings>> {
  return client.call(DOWNLOADS_HANDLERS.getSettings)
}

export function patchDownloadsSettings(
  patch: Partial<DownloadsSettings>,
): Promise<Outcome<DownloadsSettings>> {
  return client.call(DOWNLOADS_HANDLERS.patchSettings, patch)
}

export function getArchiveCacheStatus(): Promise<Outcome<ArchiveCacheStatus>> {
  return client.call(DOWNLOADS_HANDLERS.cacheStatus)
}

export function clearArchiveCache(): Promise<Outcome<ClearArchiveCacheResult>> {
  return client.call(DOWNLOADS_HANDLERS.clearCache)
}

/** The persisted, pruned failure log (`downloads.failures`). */
export function getDownloadFailures(): Promise<Outcome<DownloadFailure[]>> {
  return client.call(DOWNLOADS_HANDLERS.failures)
}

/** Marks one failure-log entry dismissed; it stays recoverable for 7 days. */
export function dismissDownloadFailure(id: string): Promise<Outcome<DownloadFailure[]>> {
  return client.call(DOWNLOADS_HANDLERS.dismissFailure, { id })
}

/** Un-dismisses a failure-log entry, moving it back out of the dismissed history. */
export function restoreDownloadFailure(id: string): Promise<Outcome<DownloadFailure[]>> {
  return client.call(DOWNLOADS_HANDLERS.restoreFailure, { id })
}

/**
 * Lists the engines the bootstrap wizard can offer - only Q2PRO today
 * (`BOOTSTRAP_SUPPORTED_ENGINES`, `@shared/modules/downloads`). An empty options array is a
 * legitimate answer (nothing pinned yet), not a failure; `BootstrapEngineOptionsResult` carries
 * the `emptyReason`.
 */
export function getBootstrapEngineOptions(): Promise<Outcome<BootstrapEngineOptionsResult>> {
  return client.call(DOWNLOADS_HANDLERS.bootstrapEngineOptions)
}

/**
 * The detected Steam/GOG/Epic Quake II sources the wizard's game-data step can offer to copy
 * from - an empty array is a legitimate "nothing detected", not a failure.
 */
export function getDetectedRetailSources(): Promise<Outcome<DetectedRetailSource[]>> {
  return client.call(DOWNLOADS_HANDLERS.bootstrapRetailSources)
}

/**
 * The verdict for a candidate target folder. The wizard renders this verdict -
 * it never judges a path itself, and it never re-derives `blocked` from the other fields.
 */
export function getBootstrapTargetVerdict(
  targetPath: string,
): Promise<Outcome<BootstrapTargetVerdict>> {
  return client.call(DOWNLOADS_HANDLERS.bootstrapTargetVerdict, { targetPath })
}

/**
 * The verdict for a hand-picked game-data folder. Same no-failure-mode convention as
 * `getBootstrapTargetVerdict`: every answer is a verdict, including `kind: 'unusable'`.
 */
export function getGameDataSourceVerdict(
  rootPath: string,
): Promise<Outcome<GameDataSourceVerdict>> {
  return client.call(DOWNLOADS_HANDLERS.bootstrapGameDataSource, { rootPath })
}

/**
 * The packages a bootstrap would download and their summed size. `dataSource`/`copySourcePath`
 * are optional and mean exactly what `StartBootstrapInput`'s own fields mean - so the confirm
 * step's summary is always computed from the same payload the run would start with.
 */
export function getBootstrapSummary(input: {
  engine: EngineKind
  targetPath: string
  includeVideoAndPlayers: boolean
  dataSource?: BootstrapDataSource
  copySourcePath?: string
}): Promise<Outcome<BootstrapSummary>> {
  return client.call(DOWNLOADS_HANDLERS.bootstrapSummary, input)
}

/**
 * Starts the bootstrap job and answers its `Job.id` plus the id of the installation it
 * registered. Returns as soon as the job exists - progress arrives through `jobs:changed`,
 * never through this promise.
 */
export function startBootstrapInstall(
  input: StartBootstrapInput,
): Promise<Outcome<{ jobId: string; installationId: string }>> {
  return client.call(DOWNLOADS_HANDLERS.bootstrapStart, input)
}

/** Starts the retail-upgrade job for one demo installation. */
export function startRetailUpgrade(
  input: StartRetailUpgradeInput,
): Promise<Outcome<StartRetailUpgradeResult>> {
  return client.call(DOWNLOADS_HANDLERS.retailUpgradeStart, input)
}

/**
 * One installation's `EngineUpdateStatus`. Has no failure mode of its own and answers
 * `undefined` for an installation it no longer knows about.
 */
export function getEngineUpdateStatus(
  installationId: string,
): Promise<Outcome<EngineUpdateStatus | undefined>> {
  return client.call(DOWNLOADS_HANDLERS.engineUpdateStatus, { installationId })
}

/** Starts the engine-update job for one installation. */
export function startEngineUpdate(
  input: StartEngineUpdateInput,
): Promise<Outcome<StartEngineUpdateResult>> {
  return client.call(DOWNLOADS_HANDLERS.engineUpdateStart, input)
}

/** Starts the engine-rollback job; answers a `StartEngineUpdateResult` like `startEngineUpdate`. */
export function startEngineRollback(
  input: StartEngineUpdateInput,
): Promise<Outcome<StartEngineUpdateResult>> {
  return client.call(DOWNLOADS_HANDLERS.engineRollbackStart, input)
}

/** Flips one installation's engine-update channel. */
export function setEngineBleedingEdge(input: SetBleedingEdgeInput): Promise<Outcome<void>> {
  return client.call(DOWNLOADS_HANDLERS.engineSetBleedingEdge, input)
}

/**
 * One installation's `RepairPlan`, built from a fresh inspection on every call - never from a
 * stored checks snapshot. `undefined` (installation not found) is a legitimate answer.
 */
export function getRepairPlan(installationId: string): Promise<Outcome<RepairPlan | undefined>> {
  return client.call(DOWNLOADS_HANDLERS.repairPlan, { installationId })
}

/** Starts the repair job for the offers the repair dialog's user authorised. */
export function startRepair(input: StartRepairInput): Promise<Outcome<StartRepairResult>> {
  return client.call(DOWNLOADS_HANDLERS.repairStart, input)
}
