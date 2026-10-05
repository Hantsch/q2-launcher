import { z } from 'zod'
import { absolutePathSchema, engineKindSchema } from '../schemas'
import type { EngineKind, InstallationStatus, ValidationCheck, ValidationCheckId } from '../types'

/** The downloads module's contract. */
export const DOWNLOADS_HANDLERS = {
  getSettings: 'downloads.getSettings',
  patchSettings: 'downloads.patchSettings',
  cacheStatus: 'downloads.cacheStatus',
  clearCache: 'downloads.clearCache',
  failures: 'downloads.failures',
  /** Marks one failure entry dismissed - it stays in the 7-day history. */
  dismissFailure: 'downloads.dismissFailure',
  restoreFailure: 'downloads.restoreFailure',
  /** Lists the engines the bootstrap wizard can offer. */
  bootstrapEngineOptions: 'bootstrap.engineOptions',
  /** The `BootstrapTargetVerdict` for one candidate target folder. */
  bootstrapTargetVerdict: 'bootstrap.targetVerdict',
  /** The packages a bootstrap would download and their summed size. */
  bootstrapSummary: 'bootstrap.summary',
  /** Starts the bootstrap job and answers its `Job.id` immediately. */
  bootstrapStart: 'bootstrap.start',
  /** The detected Steam/GOG/Epic sources; empty means "nothing detected", not a failure. */
  bootstrapRetailSources: 'bootstrap.retailSources',
  /** The `GameDataSourceVerdict` for a hand-picked folder: are its paks retail-complete? */
  bootstrapGameDataSource: 'bootstrap.gameDataSource',
  /** Upgrades a demo installation with `pak0.pak`/`pak1.pak` from a verified store source; answers a `Job.id`. */
  retailUpgradeStart: 'retail.upgradeStart',
  engineUpdateStatus: 'engine.updateStatus',
  /** Downloads the pinned build, backs up the running one and swaps it in; answers a `Job.id`. */
  engineUpdateStart: 'engine.updateStart',
  /** Restores the single backed-up build; fails with `downloads.error.engineNoBackup` when `EngineUpdateStatus.backup` is absent. */
  engineRollbackStart: 'engine.rollbackStart',
  /** Flips one installation's update channel between `'pinned'` and `'bleeding-edge'`. */
  engineSetBleedingEdge: 'engine.setBleedingEdge',
  /** Always recomputed from a fresh inspection; never reads the stored `Installation.checks`. */
  repairPlan: 'repair.plan',
  /** Only `'reinstall-engine'` and `'install-point-release'` are carried out; `'retail-copy'` and `'set-write-dir'` are the dialog's to route. */
  repairStart: 'repair.start',
} as const

/**
 * One file to copy out of a package's archive, and where it lands relative to an installation:
 * `'root'` (the installation root itself) or `'baseq2'` (the base game directory).
 */
export interface ManifestPackageContentEntry {
  from: string
  to: 'root' | 'baseq2'
}

/** Fields every package carries regardless of what it installs. */
interface ManifestPackageBase {
  id: string
  version: string
  sizeBytes: number
  sha256: string
  url: string
  mirrors: string[]
  contents: ManifestPackageContentEntry[]
}

/** A downloadable package: an engine build or a game-data package (demo or point release). */
export type ManifestPackage = ManifestPackageBase &
  (
    | { kind: 'engine'; engine: EngineKind; arch?: 'x86' | 'x86_64' }
    | { kind: 'gamedata'; role: 'demo' | 'point-release' }
  )

/** The parsed, cache-ready view of one manifest fetch. */
export interface ManifestSnapshot {
  schemaVersion: 1
  packages: ManifestPackage[]
  /** Per-engine default package id, resolved only against packages that survived parsing. */
  pinned: Partial<Record<EngineKind, string>>
  fetchedAt: string
  ageMs: number
  fromCache: boolean
}

/** One package the verified-download pipeline can fetch. */
export interface PackageSource {
  /** Name the archive is written under, e.g. `<name>.part` while in flight. */
  fileName: string
  url: string
  /** Fallback URLs tried in order after `url` and after each other on a transport error. */
  mirrors: string[]
  sizeBytes: number
  sha256: string
}

/** Lowest/highest value `DownloadsSettings.concurrentJobs` may hold. */
export const MIN_CONCURRENT_DOWNLOAD_JOBS = 1
export const MAX_CONCURRENT_DOWNLOAD_JOBS = 6

/** The only archive-cache budgets `DownloadsSettings.archiveCacheBudgetGB` may hold. */
export const ARCHIVE_CACHE_BUDGET_CHOICES_GB = [1, 2, 5, 10, 20] as const

export type ArchiveCacheBudgetGB = (typeof ARCHIVE_CACHE_BUDGET_CHOICES_GB)[number]

/** The module's own settings, persisted under `state.json`'s own `downloads` key. */
export interface DownloadsSettings {
  /** How many jobs the queue admits at once; the rest stay `queued`. */
  concurrentJobs: number
  /**
   * How large the archive cache is allowed to grow before budget enforcement evicts the oldest
   * entries.
   */
  archiveCacheBudgetGB: ArchiveCacheBudgetGB
  /** Whether a download job may start/continue while a game session is active. Default `true`. */
  downloadWhilePlayingAllowed: boolean
}

export const DEFAULT_DOWNLOADS_SETTINGS: DownloadsSettings = {
  concurrentJobs: 2,
  archiveCacheBudgetGB: 5,
  downloadWhilePlayingAllowed: true,
}

/** The archive cache's current size. */
export interface ArchiveCacheStatus {
  /** Total size, in bytes, of every evictable archive currently on disk. */
  totalBytes: number
  itemCount: number
}

/** What a `clearCache` call actually removed, so the confirm dialog never disagrees with it. */
export interface ClearArchiveCacheResult {
  removedBytes: number
  removedCount: number
}

/** The fixed, small set of reasons a download/extraction job can fail with. */
export const DOWNLOADS_ERROR_KEYS = [
  'downloads.error.allMirrorsFailed',
  'downloads.error.verificationFailed',
  'downloads.error.extractorMissing',
  'downloads.error.extractionFailed',
  'downloads.error.diskWrite',
  'downloads.error.network',
  /** One of the three packages a bootstrap needs is not listed (or the manifest is down). */
  'downloads.error.packageUnavailable',
  /** Everything downloaded and assembled, yet `inspectInstallation` still says not playable. */
  'downloads.error.installationNotPlayable',
  /** A package extracted fine yet contributed none of the allowlisted files (carries `packageId`). */
  'downloads.error.packageIncomplete',
  /** The pinned engine build needs the x86 Visual C++ runtime, which is never bundled. */
  'downloads.error.missingRuntime',
  /** The `store-copy` counterpart to `downloads.error.packageIncomplete`. */
  'downloads.error.retailCopyIncomplete',
  /** The `'existing-folder'` counterpart to `downloads.error.retailCopyIncomplete`. */
  'downloads.error.gameDataSourceUnusable',
  /** `engineUpdateStart` on an installation with nothing newer pinned (or on `'bleeding-edge'`). */
  'downloads.error.engineUpdateUnavailable',
  /** `engineRollbackStart` on an installation with no backed-up build; a backup is never fabricated. */
  'downloads.error.engineNoBackup',
  /** The replacement build could not be swapped in; the running build is left untouched. */
  'downloads.error.engineReplaceFailed',
  /** `engineSetBleedingEdge({ enabled: true })` on an engine kind without a bleeding-edge channel. */
  'downloads.error.bleedingEdgeUnsupported',
  /** Probing the upstream build source for the bleeding-edge channel failed. */
  'downloads.error.bleedingEdgeProbeFailed',
  /** The probed build's reported size differs from what was downloaded (bleeding-edge path only). */
  'downloads.error.bleedingEdgeSizeMismatch',
] as const

export type DownloadsErrorKey = (typeof DOWNLOADS_ERROR_KEYS)[number]

/** One persisted entry of the Downloads tab's failure log. */
export interface DownloadFailure {
  id: string
  jobId: string
  /** i18n key describing the job that failed - the same key the live job's row would show. */
  labelKey: string
  labelParams?: Record<string, string | number>
  installationId?: string
  /** The job's own failure reason - one of `DOWNLOADS_ERROR_KEYS`, never prose. */
  error: { key: string; params?: Record<string, string | number> }
  createdAt: number
  /** Set once the user dismisses the entry; cleared again by a restore. */
  dismissedAt?: number
  /** Structured, machine-readable diagnostics captured in main while the job ran. */
  diagnostics?: DownloadDiagnostics
}

/** One job's diagnostic snapshot, attached to its `DownloadFailure` when one exists. */
export interface DownloadDiagnostics {
  jobId: string
  kind: string
  startedAt: string
  finishedAt: string
  /** The job's own failure reason - one of `DOWNLOADS_ERROR_KEYS`, mirroring `Job.error.key`. */
  errorKey: string
  packages: DownloadDiagnosticsPackage[]
  /** Present only for a job that reached the install-target stage. */
  target?: DownloadDiagnosticsTarget
  /** One record per allowlist entry (and expanded glob dir) `assembleInstallation` planned. */
  assembly?: DownloadDiagnosticsAssemblyEntry[]
  /** The job's own log lines, oldest-first, capped to a bounded ring. */
  logTail: string[]
  /** Set when `capDiagnostics` had to trim this record to fit the per-entry size cap. */
  truncated?: boolean
}

/** One package a diagnosed job touched. */
export interface DownloadDiagnosticsPackage {
  id: string
  /** The URL the package was actually fetched from - `url` or, when it fired, a `mirrors` entry. */
  url: string
  sizeBytes: number
  verified: boolean
  extracted: boolean
  /** A bounded, sorted, top-level listing of the package's extraction dir - names only, capped. */
  contents?: string[]
  /** Set when `contents` was capped - there were more top-level entries than the cap allowed. */
  contentsTruncated?: boolean
  /** Whether assembly copied at least one file from this package; derived from `assembly`. */
  contributed?: boolean
}

/** One entry `assembleInstallation` planned - either one of its allowlist entries. */
export interface DownloadDiagnosticsAssemblyEntry {
  /** The relative path (or glob dir) that was found. */
  from: string
  to: string
  found: boolean
  /** The `ManifestPackage.id` whose extraction served this entry, when `found` is true. */
  sourcePackageId?: string
}

/** The install target a diagnosed job reached, and why `inspectInstallation` judged it so. */
export interface DownloadDiagnosticsTarget {
  /** Redacted (`redactHome`, `diagnostics.ts`) absolute target path - never a real account name. */
  targetPath: string
  /** `Installation.status` the target was left with when the job gave up. */
  verdict: InstallationStatus
  /** The failing `ValidationCheck`s that made `verdict` what it is. */
  missingChecks: {
    id: ValidationCheckId
    messageKey: string
    /** Message params; string values are reduced to their basename so no full path is reported. */
    params?: Record<string, string | number>
  }[]
}

/** The engine kinds the bootstrap wizard is willing to offer, whatever the manifest pins. */
export const BOOTSTRAP_SUPPORTED_ENGINES: readonly EngineKind[] = ['q2pro', 'r1q2']

/** One engine choice the wizard's first step can offer. */
export interface BootstrapEngineOption {
  engine: EngineKind
  packageId: string
  version: string
  sizeBytes: number
}

/**
 * Why `bootstrapEngineOptions` came back empty; `null` whenever `options` is non-empty.
 * `'none-for-platform'`: pins exist but none resolve for this host; `'none-pinned'`: no pins at
 * all (or the manifest is unavailable and uncached).
 */
export type BootstrapEngineOptionsEmptyReason = 'none-for-platform' | 'none-pinned' | null

export interface BootstrapEngineOptionsResult {
  options: BootstrapEngineOption[]
  emptyReason: BootstrapEngineOptionsEmptyReason
}

/** The verdict `computeTargetVerdict` produces; the wizard renders it, never judges paths. */
export interface BootstrapTargetVerdict {
  targetPath: string
  /** True when the canonicalised target sits under `%ProgramFiles%` or `%ProgramFiles(x86)%`. */
  programFiles: boolean
  /** True when a writability probe against the target (or its nearest ancestor) failed. */
  notWritable: boolean
  /** A directory listing of the target folder, capped at `MAX_TARGET_VERDICT_ENTRIES` entries. */
  entries: string[]
  /** True when `inspectInstallation` already recognises a working Quake II; blocks, unlike a merely non-empty folder. */
  alreadyInstalled: boolean
  /** True when the wizard can never proceed: `alreadyInstalled` or an unsafe path; other warnings leave it `false`. */
  blocked: boolean
  /**
   * Why `blocked` is `true`; absent otherwise. `'unsafePath'`: not absolute once canonicalised, a
   * device path or reserved device name, or inside the launcher's own installation directory.
   */
  blockedReason?: 'alreadyInstalled' | 'unsafePath'
}

/** The closed set of reasons `inspectRetailSource` can report a source as unverified. */
export const RETAIL_SOURCE_UNVERIFIED_REASON_KEYS = [
  /** No `baseq2` directory at all under the candidate root - `rerelease/baseq2` never counts. */
  'bootstrap.retailSource.baseDirMissing',
  'bootstrap.retailSource.pak0Missing',
  'bootstrap.retailSource.pak1Missing',
  /** `pak0.pak` exists but its size does not exactly match `RETAIL_PAK_SIZES['pak0.pak']`. */
  'bootstrap.retailSource.pak0SizeMismatch',
  /** `pak1.pak` exists but its size does not exactly match `RETAIL_PAK_SIZES['pak1.pak']`. */
  'bootstrap.retailSource.pak1SizeMismatch',
] as const

export type RetailSourceUnverifiedReasonKey = (typeof RETAIL_SOURCE_UNVERIFIED_REASON_KEYS)[number]

/** One store installation `listDetectedRetailSources` found. */
export interface DetectedRetailSource {
  /** Narrower than `InstallationSource`: only the three stores this data source ever offers. */
  source: 'steam' | 'gog' | 'epic'
  rootPath: string
  inspection: RetailSourceInspection
}

/**
 * One pak file's presence/size fact, as `inspectRetailSource` reports it for each of
 * `pak0.pak`/`pak1.pak`/`pak2.pak`.
 */
export interface RetailPakInfo {
  exists: boolean
  /** The pak's actual size in bytes, or `null` when it does not exist. */
  sizeBytes: number | null
  /** True only when `exists` and `sizeBytes` exactly matches `RETAIL_PAK_SIZES` for this file name. */
  matchesRetailSize: boolean
}

/** What `inspectRetailSource` reports about one candidate source folder's `baseq2`. */
export interface RetailSourceInspection {
  rootPath: string
  pak0: RetailPakInfo
  pak1: RetailPakInfo
  pak2: RetailPakInfo
  /** True only when `pak0`/`pak1` both `exist` and `matchesRetailSize`. */
  verified: boolean
  /** Set only when `verified` is `false`; one of `RETAIL_SOURCE_UNVERIFIED_REASON_KEYS`. */
  unverifiedReason?: RetailSourceUnverifiedReasonKey
  hasVideo: boolean
  hasPlayers: boolean
}

/** Default name when the wizard carries none; user data, not an i18n key. */
export const DEFAULT_BOOTSTRAP_INSTALLATION_NAME = 'Q2PRO Demo'

/**
 * Which archive or folder `baseq2`'s paks come from; the engine is downloaded either way. An
 * `'existing-folder'` source reuses `copySourcePath` rather than adding a second path field.
 */
export type BootstrapDataSource = 'free-download' | 'store-copy' | 'existing-folder'

/** What inspecting a hand-picked folder for game data reports. */
export interface GameDataSourceVerdict {
  /** The folder that was inspected, as sent by the caller - not re-canonicalised for display. */
  rootPath: string
  kind: 'retail' | 'demo' | 'unusable'
  /** Set for `kind: 'unusable'` (and optionally `'demo'`): an i18n key naming why, never prose. */
  reason?: string
  /** Every pak file found directly under the folder (or its `baseq2`), win or lose. */
  paks: { name: string; sizeBytes: number; retail: boolean }[]
}

/** The closed set of reasons `inspectGameDataSource` can report a folder as unusable. */
export const GAME_DATA_SOURCE_UNUSABLE_REASON_KEYS = [
  'bootstrap.gameDataSource.rootMissing',
  'bootstrap.gameDataSource.baseDirMissing',
  'bootstrap.gameDataSource.pak0Missing',
  /** The path itself fails `isUnsafeAbsolutePath` (device path, non-absolute, reserved name). */
  'bootstrap.gameDataSource.unsafePath',
] as const

export type GameDataSourceUnusableReasonKey = (typeof GAME_DATA_SOURCE_UNUSABLE_REASON_KEYS)[number]

export interface StartBootstrapInput {
  engine: EngineKind
  targetPath: string
  /** Installation name; main falls back to `DEFAULT_BOOTSTRAP_INSTALLATION_NAME` when absent. */
  name?: string
  /** Optional extras: `video/*` and `players/*` out of the point-release archive. */
  includeVideoAndPlayers: boolean
  /** The write dir the user picked when the Program-Files warning offered one. */
  writeDirPath?: string
  /** Defaults to `'free-download'`. */
  dataSource?: BootstrapDataSource
  /**
   * Required for `'store-copy'`, refused otherwise. Never trusted: main re-lists and re-inspects
   * the detected sources and refuses unless this path is among them and still verifies as retail.
   */
  copySourcePath?: string
}

/** `sourceRootPath` is never trusted: main re-lists and re-verifies it against its own detected sources. */
export interface StartRetailUpgradeInput {
  installationId: string
  sourceRootPath: string
}

/** Progress and outcome arrive through `jobs:changed`, never through the return value. */
export interface StartRetailUpgradeResult {
  jobId: string
}

/** One package a bootstrap would download, as the confirm step lists it. */
export interface BootstrapSummaryPackage {
  id: string
  version: string
  sizeBytes: number
  /** What this package contributes: the engine build, the free demo data, or the point release. */
  role: 'engine' | 'demo' | 'point-release'
}

/** What the wizard's confirm step renders before anything is downloaded. */
export interface BootstrapSummary {
  targetPath: string
  engine: EngineKind
  /** Engine build, demo data, point release - in download order. */
  packages: BootstrapSummaryPackage[]
  /** Sum of every entry's `sizeBytes`; the number the confirm step states. */
  totalSizeBytes: number
  includeVideoAndPlayers: boolean
  dataSource: BootstrapDataSource
  /** What a `'store-copy'` run would copy from. Absent for `'free-download'`. */
  copySource?: BootstrapSummaryCopySource
}

/** The copy source the confirm step names; built in main from its own fresh list, never echoed from the wizard. */
export interface BootstrapSummaryCopySource {
  path: string
  /** Which store it was detected in; absent when main's fresh list no longer holds this path. */
  store?: DetectedRetailSource['source']
}

/** Which build feed an installation's engine tracks. */
export type EngineUpdateChannel = 'pinned' | 'bleeding-edge'

/** The one backup slot an installation's engine keeps; a second update overwrites it. */
export interface EngineBackupInfo {
  /** The engine version the backup holds - what `engineRollbackStart` would restore. */
  version: string
  packageId?: string
  createdAt: number
}

/** No recorded `current` still reports `updateAvailable: true`: unknown version means not up to date. */
export interface EngineUpdateStatus {
  installationId: string
  engine: EngineKind
  current?: string
  target?: string
  updateAvailable: boolean
  channel: EngineUpdateChannel
  /** The installation's current backup slot, when one has been taken; absent otherwise. */
  backup?: EngineBackupInfo
}

export interface StartEngineUpdateInput {
  installationId: string
}

/** The `Job.id` of an update or rollback run; outcome arrives through `jobs:changed`. */
export interface StartEngineUpdateResult {
  jobId: string
}

export interface SetBleedingEdgeInput {
  installationId: string
  enabled: boolean
}

/**
 * One fix `repair.plan` can offer. Narrower than `ValidationFix`: `'select-executable'` must
 * never auto-pick a binary for the user.
 */
export const REPAIR_OFFER_KINDS = [
  'reinstall-engine',
  'install-point-release',
  'retail-copy',
  'set-write-dir',
] as const

/** Derived from `REPAIR_OFFER_KINDS` so `repair.start`'s payload schema shares the one list. */
export type RepairOfferKind = (typeof REPAIR_OFFER_KINDS)[number]

/** One row a `RepairPlan` carries: which fix, and the finding it addresses. */
export interface RepairOffer {
  kind: RepairOfferKind
  messageKey: string
  params?: Record<string, string | number>
}

/** `repair.plan`'s answer: fresh findings, never a stored snapshot; empty `offers` with findings is legitimate. */
export interface RepairPlan {
  installationId: string
  offers: RepairOffer[]
  findings: ValidationCheck[]
}

/** The payload `repair.start` takes. */
export interface StartRepairInput {
  installationId: string
  offers: RepairOfferKind[]
}

/** The `Job.id` of the repair run; outcome arrives through `jobs:changed`. */
export interface StartRepairResult {
  jobId: string
}

// IPC payload validation for the downloads module's handlers (strict: a bad payload is a caller bug).

/**
 * `getSettings`/`cacheStatus`/`clearCache` take no meaningful input - same `z.void()`
 * convention as `listInputSchema`/`writeStateInputSchema` in `shared/modules/config-schemas.ts`. (story 072)
 */
export const downloadsNoInputSchema = z.void()

/**
 * `dismissFailure`/`restoreFailure`'s payload - one failure-log entry id and nothing
 * else. Shape-identical, so the two alias one schema rather than duplicate it (same convention as
 * `unassignProfileInputSchema`/`setDefaultProfileInputSchema` in `shared/modules/config-schemas.ts`),
 * and shape-only on purpose: whether the id names an entry the log actually holds depends on
 * persisted data this schema never sees, and a missing id is already a documented no-op in
 * `failure-log.ts`, not an invalid payload. (story 073)
 *
 * `.strict()` for the same reason `patchDownloadsSettingsInputSchema` below is strict - a payload
 * carrying anything beyond the id is a caller bug, and this file's convention is to reject a caller
 * bug rather than quietly ignore part of it.
 */
export const dismissFailureInputSchema = z.object({ id: z.string().min(1) }).strict()

export const restoreFailureInputSchema = dismissFailureInputSchema

/**
 * `patchSettings`'s payload - a partial `DownloadsSettings`. Each present field is
 * validated against the exact same bounds `main/modules/downloads/persisted.ts`'s `downloadsSettingsSchema` uses to
 * parse the persisted value (`MIN_CONCURRENT_DOWNLOAD_JOBS`-`MAX_CONCURRENT_DOWNLOAD_JOBS`,
 * `ARCHIVE_CACHE_BUDGET_CHOICES_GB`) - reusing those same constants, not a hand-copied range, is
 * what keeps the two from ever drifting apart. (story 072)
 *
 * Unlike that persisted schema, this one is strict rather than forgiving: this file's convention
 * is "a bad payload is a caller bug, not a state to repair", so an out-of-range value here is rejected outright by `MainModuleRegistry.invoke()`
 * (`fail('ipc.error.invalidPayload')`) before any handler runs, rather than silently degraded to a
 * default the way a hand-edited `state.json` would be.
 */
/**
 * `bootstrapEngineOptions` takes no input - same `z.void()` convention as
 * `downloadsNoInputSchema` above; kept as its own named export so this handler's schema reads
 * self-documenting at the call site rather than reusing an unrelated-sounding name. (story 074)
 */
export const bootstrapEngineOptionsInputSchema = downloadsNoInputSchema

/**
 * `bootstrap.retailSources` takes no input - same `z.void()` convention as
 * `bootstrapEngineOptionsInputSchema` above. (story 088)
 */
export const bootstrapRetailSourcesInputSchema = downloadsNoInputSchema

/**
 * The eventual `bootstrap.targetVerdict` handler's payload - one absolute path, the
 * folder the wizard's target-folder step is considering. `.strict()` for the same "a bad payload is
 * a caller bug" reason as `dismissFailureInputSchema` above; `absolutePathSchema` (`@shared/schemas`)
 * already rejects a non-absolute path (empty, relative, drive-relative) and a NUL byte before this ever reaches `computeTargetVerdict`
 * (`bootstrap/target.ts`), which then does its own, deeper path-safety validation (device paths,
 * reserved names, containment) as part of the verdict itself rather than at the schema layer. (story 074)
 */
export const bootstrapTargetVerdictInputSchema = z
  .object({ targetPath: absolutePathSchema })
  .strict()

/**
 * The eventual `bootstrap.gameDataSource` handler's payload (a later stage wires the handler) -
 * one absolute path, the folder the wizard's game-data step is asking about. Same
 * `bootstrapTargetVerdictInputSchema` convention: `.strict()` because a bad payload is a caller bug,
 * `absolutePathSchema` rejects a non-absolute path/NUL byte before anything looks at the filesystem, and
 * the deeper "does this folder actually hold retail data" judgement is left to the verdict itself. (story 089)
 */
export const bootstrapGameDataSourceInputSchema = z
  .object({ rootPath: absolutePathSchema })
  .strict()

/**
 * The engine a bootstrap may be asked for. Narrower than `engineKindSchema` on
 * purpose - `BOOTSTRAP_SUPPORTED_ENGINES` is the wizard's own list ("offered by this sprint's
 * wizard", not "supported by the launcher in general", see its doc comment), and rejecting an
 * unsupported engine at the schema is better than resolving no package for it three steps later. (story 074)
 */
const bootstrapEngineSchema = engineKindSchema.refine(
  (value) => BOOTSTRAP_SUPPORTED_ENGINES.includes(value),
  'the bootstrap wizard does not support this engine',
)

/**
 * Which game-data source a bootstrap run uses (`BootstrapDataSource`,
 * `@shared/modules/downloads`). Optional at both call sites below, defaulted in main rather than
 * here, so a payload written against the first wizard keeps meaning `'free-download'` - the schema
 * only decides which values are *representable*. (story 088)
 */
const bootstrapDataSourceSchema = z.enum(['free-download', 'store-copy', 'existing-folder'])

/**
 * `copySourcePath` is meaningful for exactly one `dataSource`, so both halves of that
 * are enforced here rather than left to the handler - a `'store-copy'` payload without a source
 * path, and any other payload carrying one, are equally caller bugs and this file's convention is to
 * reject a caller bug outright. Shared by the two
 * schemas below so "when is a copy source required" cannot come to differ between the confirm step's
 * summary and the run it summarises. (story 088)
 *
 * It validates only the *combination*: whether the path names a source main actually detected, and
 * whether that source still verifies as retail, is re-decided in main against its own fresh list
 * (`startBootstrap`, `downloads.error.retailSourceUnverified`) - a schema can know neither.
 *
 * `'existing-folder'` needs exactly the same `copySourcePath` a `'store-copy'` run
 * does - a hand-picked folder is copied from the same way a detected retail install is - so it
 * joins `storeCopy` below rather than getting a second required-path branch. (story 089)
 */
function refineCopySource(
  value: {
    dataSource?: 'free-download' | 'store-copy' | 'existing-folder'
    copySourcePath?: string
  },
  ctx: z.RefinementCtx,
): void {
  const storeCopy = value.dataSource === 'store-copy' || value.dataSource === 'existing-folder'
  if (storeCopy && value.copySourcePath === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "a 'store-copy' or 'existing-folder' run must name the source it copies from",
      path: ['copySourcePath'],
    })
  }
  if (!storeCopy && value.copySourcePath !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "'copySourcePath' is only meaningful for a 'store-copy' or 'existing-folder' run",
      path: ['copySourcePath'],
    })
  }
}

/**
 * `bootstrap.summary`'s payload - the same facts `bootstrap.start` takes minus the
 * name, since a summary states what would be downloaded and how large it is, which no name can
 * change. `.strict()` for the same "a bad payload is a caller bug" reason as
 * `dismissFailureInputSchema` above. (story 074)
 *
 * Plus the data source and, for a `'store-copy'` one, the path it would copy
 * from - so the confirm step's summary is computed from exactly the payload the run will be started
 * with, not from a subset of it. (story 088)
 */
export const bootstrapSummaryInputSchema = z
  .object({
    engine: bootstrapEngineSchema,
    targetPath: absolutePathSchema,
    includeVideoAndPlayers: z.boolean(),
    dataSource: bootstrapDataSourceSchema.optional(),
    copySourcePath: absolutePathSchema.optional(),
  })
  .strict()
  .superRefine(refineCopySource)

/**
 * `bootstrap.start`'s payload. `targetPath` passes `absolutePathSchema` here and is
 * then re-judged in main by `computeTargetVerdict` (`bootstrap/target.ts`), which is where the real
 * path-safety decision lives - a schema cannot know whether a folder already holds a game. (story 074)
 *
 * `name` is optional and only shape-checked: an installation name is user data, and main falls back
 * to `DEFAULT_BOOTSTRAP_INSTALLATION_NAME` (or, for a `'store-copy'` run, the engine's label) for an absent or blank one rather than rejecting it.
 *
 * `copySourcePath` passes `absolutePathSchema` here and is then re-resolved in main
 * against its own freshly listed detected sources - the same "the schema checks the shape, main
 * makes the decision" split `targetPath` already has, and the reason a path that merely *looks*
 * fine still cannot get a run past `startBootstrap`. (story 088)
 */
export const startBootstrapInputSchema = z
  .object({
    engine: bootstrapEngineSchema,
    targetPath: absolutePathSchema,
    name: z.string().min(1).max(120).optional(),
    includeVideoAndPlayers: z.boolean(),
    // The remedy: the write-dir path the user picked from the target step's
    // Program-Files warning, if any - same `absolutePathSchema` convention as `targetPath` above.
    writeDirPath: absolutePathSchema.optional(),
    dataSource: bootstrapDataSourceSchema.optional(),
    copySourcePath: absolutePathSchema.optional(),
  })
  .strict()
  .superRefine(refineCopySource)

/**
 * `retail.upgradeStart`'s payload - the demo installation to upgrade and which
 * detected store source (`DetectedRetailSource.rootPath`) to copy `pak0.pak`/`pak1.pak`
 * from. `.strict()` for the same "a bad payload is a caller bug" reason as
 * `dismissFailureInputSchema` above. Like `copySourcePath` elsewhere in this file, `sourceRootPath`
 * is never trusted as-is: the handler re-lists and re-verifies it against main's own fresh
 * `listDetectedRetailSources()` before copying anything (CLAUDE.md's "paths from the renderer are
 * never trusted"). (story 090)
 */
export const startRetailUpgradeInputSchema = z
  .object({
    installationId: z.string().min(1),
    sourceRootPath: absolutePathSchema,
  })
  .strict()

/**
 * `engineUpdateStatus`/`engineUpdateStart`/`engineRollbackStart`'s shared shape - one
 * installation id and nothing else. `.strict()` for the same "a bad payload is a caller bug"
 * reason as `dismissFailureInputSchema` above. (story 092)
 */
export const engineInstallationInputSchema = z
  .object({ installationId: z.string().min(1) })
  .strict()

export const engineUpdateStatusInputSchema = engineInstallationInputSchema

export const startEngineUpdateInputSchema = engineInstallationInputSchema

/**
 * `repair.plan`'s payload - one installation id, nothing else. Same single-field
 * shape as `engineInstallationInputSchema` above, kept as its own export since this module's
 * checklist is unrelated to the engine-update surface. (story 093)
 */
export const repairPlanInputSchema = z.object({ installationId: z.string().min(1) }).strict()

/**
 * `repair.start`'s payload - the installation and the offer kinds the user
 * authorised. The enum is `REPAIR_OFFER_KINDS` (`@shared/modules/downloads`) itself, never a
 * hand-copied list, so a kind added to the contract cannot silently fail validation here. (story 093)
 *
 * `.min(1)`: a repair of nothing is a caller bug, and this file's convention is to reject a bad
 * payload rather than let a handler discover it. Which of the accepted kinds the *job* actually
 * performs is a different question, answered in `repair/job.ts` (`REPAIRS_BY_JOB`) - the schema
 * validates the contract's shape, not one job's scope.
 */
export const startRepairInputSchema = z
  .object({
    installationId: z.string().min(1),
    offers: z.array(z.enum(REPAIR_OFFER_KINDS)).min(1),
  })
  .strict()

export const startEngineRollbackInputSchema = engineInstallationInputSchema

/**
 * `engineSetBleedingEdge`'s payload - the installation to flip and the channel to
 * flip it to. `.strict()` for the same reason as the schemas above. (story 092)
 */
export const setBleedingEdgeInputSchema = z
  .object({
    installationId: z.string().min(1),
    enabled: z.boolean(),
  })
  .strict()

export const patchDownloadsSettingsInputSchema = z
  .object({
    concurrentJobs: z
      .number()
      .int()
      .min(MIN_CONCURRENT_DOWNLOAD_JOBS)
      .max(MAX_CONCURRENT_DOWNLOAD_JOBS)
      .optional(),
    archiveCacheBudgetGB: z
      .number()
      .refine((value): value is ArchiveCacheBudgetGB =>
        ARCHIVE_CACHE_BUDGET_CHOICES_GB.includes(value as ArchiveCacheBudgetGB),
      )
      .optional(),
    downloadWhilePlayingAllowed: z.boolean().optional(),
  })
  .strict()

/** Every `downloads` handler paired with its payload schema. */
export const DOWNLOADS_HANDLER_SCHEMAS = {
  [DOWNLOADS_HANDLERS.getSettings]: downloadsNoInputSchema,
  [DOWNLOADS_HANDLERS.patchSettings]: patchDownloadsSettingsInputSchema,
  [DOWNLOADS_HANDLERS.cacheStatus]: downloadsNoInputSchema,
  [DOWNLOADS_HANDLERS.clearCache]: downloadsNoInputSchema,
  [DOWNLOADS_HANDLERS.failures]: downloadsNoInputSchema,
  [DOWNLOADS_HANDLERS.dismissFailure]: dismissFailureInputSchema,
  [DOWNLOADS_HANDLERS.restoreFailure]: restoreFailureInputSchema,
  [DOWNLOADS_HANDLERS.bootstrapEngineOptions]: bootstrapEngineOptionsInputSchema,
  [DOWNLOADS_HANDLERS.bootstrapTargetVerdict]: bootstrapTargetVerdictInputSchema,
  [DOWNLOADS_HANDLERS.bootstrapSummary]: bootstrapSummaryInputSchema,
  [DOWNLOADS_HANDLERS.bootstrapStart]: startBootstrapInputSchema,
  [DOWNLOADS_HANDLERS.bootstrapRetailSources]: bootstrapRetailSourcesInputSchema,
  [DOWNLOADS_HANDLERS.bootstrapGameDataSource]: bootstrapGameDataSourceInputSchema,
  [DOWNLOADS_HANDLERS.retailUpgradeStart]: startRetailUpgradeInputSchema,
  [DOWNLOADS_HANDLERS.engineUpdateStatus]: engineUpdateStatusInputSchema,
  [DOWNLOADS_HANDLERS.engineUpdateStart]: startEngineUpdateInputSchema,
  [DOWNLOADS_HANDLERS.engineRollbackStart]: startEngineRollbackInputSchema,
  [DOWNLOADS_HANDLERS.engineSetBleedingEdge]: setBleedingEdgeInputSchema,
  [DOWNLOADS_HANDLERS.repairPlan]: repairPlanInputSchema,
  [DOWNLOADS_HANDLERS.repairStart]: startRepairInputSchema,
} satisfies Record<(typeof DOWNLOADS_HANDLERS)[keyof typeof DOWNLOADS_HANDLERS], z.ZodTypeAny>

type DownloadsSchemas = typeof DOWNLOADS_HANDLER_SCHEMAS

/** The downloads module's typed contract; `req` is each schema's parsed output. */
export type DownloadsContract = {
  handlers: {
    [DOWNLOADS_HANDLERS.getSettings]: {
      req: z.infer<DownloadsSchemas['downloads.getSettings']>
      res: DownloadsSettings
    }
    [DOWNLOADS_HANDLERS.patchSettings]: {
      req: z.infer<DownloadsSchemas['downloads.patchSettings']>
      res: DownloadsSettings
    }
    [DOWNLOADS_HANDLERS.cacheStatus]: {
      req: z.infer<DownloadsSchemas['downloads.cacheStatus']>
      res: ArchiveCacheStatus
    }
    [DOWNLOADS_HANDLERS.clearCache]: {
      req: z.infer<DownloadsSchemas['downloads.clearCache']>
      res: ClearArchiveCacheResult
    }
    [DOWNLOADS_HANDLERS.failures]: {
      req: z.infer<DownloadsSchemas['downloads.failures']>
      res: DownloadFailure[]
    }
    [DOWNLOADS_HANDLERS.dismissFailure]: {
      req: z.infer<DownloadsSchemas['downloads.dismissFailure']>
      res: DownloadFailure[]
    }
    [DOWNLOADS_HANDLERS.restoreFailure]: {
      req: z.infer<DownloadsSchemas['downloads.restoreFailure']>
      res: DownloadFailure[]
    }
    [DOWNLOADS_HANDLERS.bootstrapEngineOptions]: {
      req: z.infer<DownloadsSchemas['bootstrap.engineOptions']>
      res: BootstrapEngineOptionsResult
    }
    [DOWNLOADS_HANDLERS.bootstrapTargetVerdict]: {
      req: z.infer<DownloadsSchemas['bootstrap.targetVerdict']>
      res: BootstrapTargetVerdict
    }
    [DOWNLOADS_HANDLERS.bootstrapSummary]: {
      req: z.infer<DownloadsSchemas['bootstrap.summary']>
      res: BootstrapSummary
    }
    [DOWNLOADS_HANDLERS.bootstrapStart]: {
      req: z.infer<DownloadsSchemas['bootstrap.start']>
      res: { jobId: string; installationId: string }
    }
    [DOWNLOADS_HANDLERS.bootstrapRetailSources]: {
      req: z.infer<DownloadsSchemas['bootstrap.retailSources']>
      res: DetectedRetailSource[]
    }
    [DOWNLOADS_HANDLERS.bootstrapGameDataSource]: {
      req: z.infer<DownloadsSchemas['bootstrap.gameDataSource']>
      res: GameDataSourceVerdict
    }
    [DOWNLOADS_HANDLERS.retailUpgradeStart]: {
      req: z.infer<DownloadsSchemas['retail.upgradeStart']>
      res: StartRetailUpgradeResult
    }
    [DOWNLOADS_HANDLERS.engineUpdateStatus]: {
      req: z.infer<DownloadsSchemas['engine.updateStatus']>
      res: EngineUpdateStatus | undefined
    }
    [DOWNLOADS_HANDLERS.engineUpdateStart]: {
      req: z.infer<DownloadsSchemas['engine.updateStart']>
      res: StartEngineUpdateResult
    }
    [DOWNLOADS_HANDLERS.engineRollbackStart]: {
      req: z.infer<DownloadsSchemas['engine.rollbackStart']>
      res: StartEngineUpdateResult
    }
    [DOWNLOADS_HANDLERS.engineSetBleedingEdge]: {
      req: z.infer<DownloadsSchemas['engine.setBleedingEdge']>
      res: void
    }
    [DOWNLOADS_HANDLERS.repairPlan]: {
      req: z.infer<DownloadsSchemas['repair.plan']>
      res: RepairPlan | undefined
    }
    [DOWNLOADS_HANDLERS.repairStart]: {
      req: z.infer<DownloadsSchemas['repair.start']>
      res: StartRepairResult
    }
  }
  events: {}
}
