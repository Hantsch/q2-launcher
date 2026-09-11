import type { EngineKind, InstallationStatus, ValidationCheckId } from '../types'

/**
 * The downloads module's contract.
 *
 * Each module owns one file under `src/shared/modules/` describing the data it
 * exchanges with the UI. Main implements the handlers, the renderer gets a typed
 * client, and neither side imports the other's code - this file is the only
 * thing they share. Same pattern as `library.ts`.
 *
 * Story 070 D1 adds only the contract and its wire types: the curated manifest
 * of downloadable engine builds / game-data packages, fetched from a public
 * GitHub content repo (D2/D3), validated and parsed by
 * `src/main/modules/downloads/manifest-parse.ts` (this deliverable), and served
 * to the renderer by a `manifest.get` handler (D4, not implemented here).
 *
 * Story 071 D1 adds this module's own settings shape/defaults, its verified-download input type
 * and its fixed failure-reason key set - see each export's own doc comment below. No IPC channel
 * is added by story 071 (Decisions (Sprint): "the `downloads` manifest entry stays
 * `status: 'planned'` and the first channel arrives with the wizard, [[074]]").
 */
export const DOWNLOADS_HANDLERS = {
  manifestGet: 'manifest.get',
  /** Story 072 D2: reads the persisted `DownloadsSettings` (D4 implements the handler). */
  getSettings: 'downloads.getSettings',
  /** Story 072 D2: validates and persists a partial `DownloadsSettings` patch (D4). */
  patchSettings: 'downloads.patchSettings',
  /** Story 072 D2: reads the current archive cache's `ArchiveCacheStatus` (D3/D4). */
  cacheStatus: 'downloads.cacheStatus',
  /** Story 072 D2: deletes evictable cache entries and reports a `ClearArchiveCacheResult` (D3/D4). */
  clearCache: 'downloads.clearCache',
  /** Story 073 D1: reads the persisted, pruned failure log (D2 implements the handler). */
  failures: 'downloads.failures',
  /** Story 073 D1: marks one failure entry dismissed - it stays in the 7-day history (D2). */
  dismissFailure: 'downloads.dismissFailure',
  /** Story 073 D1: un-dismisses a failure entry, moving it back out of the history (D2). */
  restoreFailure: 'downloads.restoreFailure',
  /**
   * Story 074 D1: lists the engines the bootstrap wizard can offer this sprint - only the ones
   * both pinned by the manifest and named in `BOOTSTRAP_SUPPORTED_ENGINES` below (D1 implements
   * the handler; D2+ build the rest of the wizard on top of it).
   */
  bootstrapEngineOptions: 'bootstrap.engineOptions',
  /**
   * Story 074 D4: the `BootstrapTargetVerdict` for one candidate target folder - a thin wrapper
   * around `computeTargetVerdict` (`main/modules/downloads/bootstrap/target.ts`, D2). No failure
   * mode of its own (same convention as `getSettings`): every answer is a verdict, including
   * "blocked".
   */
  bootstrapTargetVerdict: 'bootstrap.targetVerdict',
  /**
   * Story 074 D4 (AC4): the packages a bootstrap would download and their summed size, for the
   * wizard's confirm step. Fails when the manifest cannot resolve all three required packages.
   */
  bootstrapSummary: 'bootstrap.summary',
  /**
   * Story 074 D4: starts the bootstrap job and answers its `Job.id` immediately - the job itself
   * runs in the background and reports through `JobsService` (`jobs:changed`), never through this
   * call's return value.
   */
  bootstrapStart: 'bootstrap.start',
  /**
   * Story 088 D2: the detected Steam/GOG/Epic Quake II sources the wizard's game-data step can
   * offer to copy from (AC1/AC2) - a thin wrapper around `listDetectedRetailSources`
   * (`main/modules/downloads/bootstrap/retail-source.ts`). No failure mode of its own (same
   * convention as `bootstrapEngineOptions`): an empty array is a legitimate "nothing detected",
   * which the wizard is expected to handle by not offering the option at all.
   */
  bootstrapRetailSources: 'bootstrap.retailSources',
} as const

/**
 * One file to copy out of a package's archive, and where it lands relative to
 * an installation: `'root'` (the installation root itself) or `'baseq2'` (the
 * base game directory).
 */
export interface ManifestPackageContentEntry {
  from: string
  to: 'root' | 'baseq2'
}

/**
 * Fields every package carries regardless of what it installs. `mirrors` is a
 * list of fallback URLs alongside `url` - D2/D3's business to actually use,
 * not this deliverable's.
 */
interface ManifestPackageBase {
  id: string
  version: string
  sizeBytes: number
  sha256: string
  url: string
  mirrors: string[]
  contents: ManifestPackageContentEntry[]
}

/**
 * A downloadable package: either an engine build (tagged with the `EngineKind`
 * it provides) or a game-data package (a demo or a point-release patch).
 */
export type ManifestPackage = ManifestPackageBase &
  (
    | { kind: 'engine'; engine: EngineKind }
    | { kind: 'gamedata'; role: 'demo' | 'point-release' }
  )

/**
 * The parsed, cache-ready view of one manifest fetch - what `manifest.get`
 * (D4) hands the renderer. `schemaVersion` is always exactly `1` here: a
 * fetch that could not produce this (wrong version, malformed envelope) never
 * reaches this shape at all (see `parseManifestFile`,
 * `src/main/modules/downloads/manifest-parse.ts`).
 */
export interface ManifestSnapshot {
  schemaVersion: 1
  packages: ManifestPackage[]
  /** Per-engine default package id, resolved only against packages that survived parsing. */
  pinned: Partial<Record<EngineKind, string>>
  fetchedAt: string
  ageMs: number
  fromCache: boolean
}

/**
 * Story 071 D1: one package the verified-download pipeline can fetch - the pipeline's own
 * minimal input type, deliberately not `ManifestPackage` above (Decisions (Sprint): "the
 * pipeline takes its own minimal `PackageSource`... so this story stays buildable and testable
 * while the manifest shape is still in flight; the adapter lands with the caller, [[074]]"). Do
 * not import this into `main/modules/downloads/manifest-service.ts` or wire it into that file.
 */
export interface PackageSource {
  /** Name the archive is written under, e.g. `<name>.part` while in flight. */
  fileName: string
  url: string
  /** Fallback URLs tried in order after `url` and after each other on a transport error. */
  mirrors: string[]
  sizeBytes: number
  sha256: string
}

/** Lowest/highest value `DownloadsSettings.concurrentJobs` may hold (Decisions (Sprint)). */
export const MIN_CONCURRENT_DOWNLOAD_JOBS = 1
export const MAX_CONCURRENT_DOWNLOAD_JOBS = 6

/**
 * Story 072 D2: the only archive-cache budgets `DownloadsSettings.archiveCacheBudgetGB` may hold
 * (Decisions (Sprint): "Both numeric settings are `Select`s ... budget 1/2/5/10/20 GB") - a
 * closed set shared by main's validation and the renderer's `Select`, so an out-of-set value is
 * unrepresentable in the UI rather than merely rejected after the fact.
 */
export const ARCHIVE_CACHE_BUDGET_CHOICES_GB = [1, 2, 5, 10, 20] as const

export type ArchiveCacheBudgetGB = (typeof ARCHIVE_CACHE_BUDGET_CHOICES_GB)[number]

/**
 * Story 071 D1: the `downloads` module's own settings, persisted under `state.json`'s
 * `downloads` top-level key (`main/services/state.ts`). [[072]] only contributes the UI section
 * over this same shape - "reads the limit" needs a source that exists, which is what this story
 * provides.
 *
 * Story 072 D2 adds `archiveCacheBudgetGB` and `downloadWhilePlayingAllowed` alongside the
 * existing `concurrentJobs` - all three live in this one top-level `downloads` key, never merged
 * into `LauncherSettings` (Decisions (Sprint): "an own top-level ... key in `state.json`").
 */
export interface DownloadsSettings {
  /**
   * How many jobs the queue admits at once; the rest stay `queued` (AC2). Range
   * `MIN_CONCURRENT_DOWNLOAD_JOBS`-`MAX_CONCURRENT_DOWNLOAD_JOBS`, default 2 - enough parallelism
   * to matter without hammering a mirror or the disk.
   */
  concurrentJobs: number
  /**
   * How large the archive cache (`<userData>/cache/downloads/`, D3) is allowed to grow before
   * budget enforcement evicts the oldest entries (AC5). One of
   * `ARCHIVE_CACHE_BUDGET_CHOICES_GB`, default 5.
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

/**
 * Story 072 D2: the archive cache's current size, as `cacheStatus` (D4) reports it and the
 * settings section (D5) renders it (AC3). Producer TBD by D3/D4 - this is only the wire shape.
 */
export interface ArchiveCacheStatus {
  /** Total size, in bytes, of every evictable archive currently on disk. */
  totalBytes: number
  /** Count of evictable archives currently on disk. */
  itemCount: number
}

/**
 * Story 072 D2: what a `clearCache` call (D4) actually removed, so the confirm dialog's stated
 * size/count (AC4) and the real deletion can never disagree (Decisions (Sprint)).
 */
export interface ClearArchiveCacheResult {
  /** Bytes freed by the clear. */
  removedBytes: number
  /** Number of archives removed by the clear. */
  removedCount: number
}

/**
 * Story 071 D1: the fixed, small set of reasons a download/extraction job can fail with
 * (Decisions (Sprint)) - main sends one of these keys, never prose, so the renderer's failure
 * log (a later deliverable, [[073]]) stays a closed, renderable set instead of an open string.
 */
export const DOWNLOADS_ERROR_KEYS = [
  'downloads.error.allMirrorsFailed',
  'downloads.error.verificationFailed',
  'downloads.error.extractorMissing',
  'downloads.error.extractionFailed',
  'downloads.error.diskWrite',
  'downloads.error.network',
  /**
   * Story 074 D4: one of the three packages a bootstrap needs (the pinned engine build, the demo
   * game data, the point release) could not be resolved from the manifest - it is not listed, or
   * the manifest itself was unavailable. Its own key rather than
   * `downloads.error.manifestUnavailable` (which is not a member of this set and describes the
   * *fetch* failing) because a reachable manifest that simply does not list a `role: 'demo'`
   * package is a different problem with a different remedy.
   */
  'downloads.error.packageUnavailable',
  /**
   * Story 074 D4 (AC6): everything downloaded, verified and assembled, yet `inspectInstallation`
   * still reports the target as `invalid`/`missing`. The job fails rather than succeeding into a
   * registered installation nobody can play - and, like every other failure here, its cleanup
   * leaves neither the partial files nor the library entry behind.
   */
  'downloads.error.installationNotPlayable',
  /**
   * Story 076 D3 (AC5): one of the bootstrap's packages was resolved, downloaded, verified and
   * extracted without a hitch, and still contributed none of the allowlisted files the installation
   * needs to be playable - the 2026-09-08 failure, where the demo archive's real layout put
   * `pak0.pak` somewhere the allowlist did not look. Distinct from
   * `downloads.error.packageUnavailable` (the manifest never offered the package at all) and from
   * `downloads.error.installationNotPlayable` (the end-of-run verdict, which names no package).
   * Carries `params: { packageId }` - a manifest package id, data rather than prose, so the
   * sentence itself stays in `en.json`.
   */
  'downloads.error.packageIncomplete',
  /**
   * Story 080 D3 (AC5): the pinned engine build's binaries import the x86 Visual C++ runtime
   * (`VCRUNTIME140.dll`), which the bootstrap never bundles or installs itself - only R1Q2 needs
   * this check this sprint, since its archive carries no runtime of its own. Fires after the core
   * assemble pass (the files are on disk and would otherwise look playable) and before the first
   * revalidation, so a missing runtime is an actionable failure rather than a silent "not playable".
   */
  'downloads.error.missingRuntime',
  /**
   * Story 088 fix cycle (review F1): the `store-copy` counterpart to `downloads.error.packageIncomplete` -
   * a detected retail installation verified at the D4 pre-check and, by the time the actual copy
   * ran, contributed none of the required `baseq2` paks (e.g. the source was moved or deleted in
   * between). Distinct key because nothing was downloaded for a `store-copy` run - the sentence
   * describes a copy, not a download, and carries no package id to name.
   */
  'downloads.error.retailCopyIncomplete',
] as const

export type DownloadsErrorKey = (typeof DOWNLOADS_ERROR_KEYS)[number]

/**
 * Story 073 D1: one persisted entry of the Downloads tab's failure log (AC2). The log is global
 * across the app (Decisions (Sprint): "the list has no installation filter"), so this carries its
 * own `labelKey`/`installationId` rather than being looked up from the job that produced it - the
 * job itself is long gone from `JobsService` by the time this is read.
 *
 * `error` mirrors `Job.error` (`@shared/types/jobs`) field-for-field - the i18n key/params the
 * failing job carried, never prose (CLAUDE.md's cross-IPC rule), so the renderer can translate a
 * failure exactly like it already translates a live job's label.
 *
 * `createdAt`/`dismissedAt` are epoch milliseconds, not ISO strings - `failure-log.ts`'s retention
 * math (the 7-day prune) is plain arithmetic against `Date.now()`, so both fields are in the same
 * unit as what it is compared with. `dismissedAt` is absent for an entry the user has not dismissed
 * yet, which `pruneFailures` never touches (Decisions (Sprint): "an undismissed entry is never
 * pruned").
 */
export interface DownloadFailure {
  id: string
  /** The `Job.id` that produced this entry. The job itself may since have been cleared. */
  jobId: string
  /** i18n key describing the job that failed - the same key the live job's row would show. */
  labelKey: string
  labelParams?: Record<string, string | number>
  /** The installation the failing job acted on, when it was installation-scoped. */
  installationId?: string
  /** The job's own failure reason - one of `DOWNLOADS_ERROR_KEYS`, never prose. */
  error: { key: string; params?: Record<string, string | number> }
  createdAt: number
  /** Set once the user dismisses the entry; cleared again by a restore. */
  dismissedAt?: number
  /**
   * Story 075 D1: structured, machine-readable diagnostics captured in main while the job ran -
   * ids, URLs, byte counts, verdicts, raw log lines, never prose (Requirement: "the i18n key stays
   * the only prose main produces"). Optional by construction (Decisions (Refine): "AC1 says a
   * failure entry *can* carry diagnostics") - only bootstrap jobs populate it this sprint (D2/D3);
   * every other failure, and every entry persisted before this story, simply has none.
   */
  diagnostics?: DownloadDiagnostics
}

/**
 * Story 075 D1 (AC1/AC2): one job's diagnostic snapshot, attached to its `DownloadFailure` when
 * one exists. Mirrors `Job` field-for-field where it overlaps (`jobId` ~ `Job.id`, `kind` ~
 * `Job.kind`, `startedAt`/`finishedAt` as ISO strings like `Job.startedAt`/`Job.finishedAt`,
 * `errorKey` ~ `Job.error.key`) rather than reusing `Job` itself - `Job` is broadcast on every
 * `jobs:changed` tick to every job surface in the app (Decisions (Refine)), so this lives only in
 * the failure log, captured once at the end.
 */
export interface DownloadDiagnostics {
  /** The `Job.id` that produced this snapshot - same value as the owning `DownloadFailure.jobId`. */
  jobId: string
  /** Module-defined discriminator, mirroring `Job.kind` (e.g. `bootstrap`). */
  kind: string
  /** ISO timestamp, mirroring `Job.startedAt`. */
  startedAt: string
  /** ISO timestamp, mirroring `Job.finishedAt`. */
  finishedAt: string
  /** The job's own failure reason - one of `DOWNLOADS_ERROR_KEYS`, mirroring `Job.error.key`. */
  errorKey: string
  /** Every package the job touched, in the order it processed them. */
  packages: DownloadDiagnosticsPackage[]
  /** Present only for a job that reached the install-target stage (AC2) - a bootstrap that failed
   * earlier (e.g. `downloads.error.packageUnavailable`) has no target yet. */
  target?: DownloadDiagnosticsTarget
  /**
   * Story 078 D1/D2/D3 (AC7): one record per allowlist entry `assembleInstallation` planned, in
   * plan order, plus one per expanded glob dir - what it looked for, whether it was found, and
   * which package's extraction served it. Absent for a job that failed before assembly ran.
   */
  assembly?: DownloadDiagnosticsAssemblyEntry[]
  /**
   * The job's own log lines (Decisions (Refine): "the collector *tees* it"), oldest-first, capped
   * to a bounded ring - developer-facing content by explicit design (Requirement: "the same
   * category as a stack trace"), never rendered in the UI, only inside a copied report.
   */
  logTail: string[]
  /** Set when `capDiagnostics` (`failure-log.ts`) had to trim this record to fit the per-entry size
   * cap. Absent when the record was persisted whole. */
  truncated?: boolean
}

/** Story 075 D1 (AC1): one package a diagnosed job touched. */
export interface DownloadDiagnosticsPackage {
  /** The `ManifestPackage.id`. */
  id: string
  /** The URL the package was actually fetched from - `url` or, when it fired, a `mirrors` entry. */
  url: string
  sizeBytes: number
  /** Whether the package's checksum verification succeeded. */
  verified: boolean
  /** Whether the package's archive extracted successfully. */
  extracted: boolean
  /**
   * Story 078 D1/D3 (AC8): a bounded, sorted, top-level listing of the package's extraction dir -
   * names only, capped (`EXTRACTION_LISTING_CAP`, `diagnostics.ts`), never a recursive file tree.
   * Absent when the package's extraction failed rather than simply empty.
   */
  contents?: string[]
  /** Set when `contents` was capped - there were more top-level entries than the cap allowed. */
  contentsTruncated?: boolean
  /**
   * Story 078 D1/D3 (AC1): whether this package's extraction served at least one file that
   * assembly actually copied into the install target - derived from `assembly` in main, so the
   * renderer can show the per-package step reached without reading `assembly` itself.
   */
  contributed?: boolean
}

/**
 * Story 078 D1/D2 (AC7): one entry `assembleInstallation` planned - either one of its allowlist
 * entries (plan order) or one expanded glob dir (`video`/`players`) - and what it found for it.
 */
export interface DownloadDiagnosticsAssemblyEntry {
  /** The relative path (or glob dir) that was found; when nothing was, every candidate path that
   * was tried, joined by ` | ` (story 078 review finding M3 - a single candidate would otherwise
   * hide that the allowlist tried more than one layout). Redacted like every other path here. */
  from: string
  /** The path within the install target it would have been copied to. */
  to: string
  /** Whether a source provided this entry. */
  found: boolean
  /** The `ManifestPackage.id` whose extraction served this entry, when `found` is true. */
  sourcePackageId?: string
}

/** Story 075 D1 (AC2): the install target a diagnosed job reached, and why `inspectInstallation`
 * judged it the way it did. */
export interface DownloadDiagnosticsTarget {
  /** Redacted (`redactHome`, `diagnostics.ts`) absolute target path - never a real account name. */
  targetPath: string
  /** `Installation.status` the target was left with when the job gave up. */
  verdict: InstallationStatus
  /** The failing `ValidationCheck`s that made `verdict` what it is - id and i18n `messageKey`,
   * never prose. */
  missingChecks: { id: ValidationCheckId; messageKey: string }[]
}

/**
 * Story 074 D1, extended by 080 D2: the engine kinds the bootstrap wizard is willing to offer,
 * whatever the manifest pins. Q2PRO and R1Q2 (Decisions (Sprint)) - kept as its own list, rather
 * than folding this into `isEngineSupported()` (`@shared/types/engine`), because "supported by the
 * launcher in general" and "offered by the wizard" are different questions that happen to agree
 * today; a future engine can become launcher-supported well before the wizard is taught to
 * bootstrap it.
 */
export const BOOTSTRAP_SUPPORTED_ENGINES: readonly EngineKind[] = ['q2pro', 'r1q2']

/**
 * Story 074 D1: one engine choice the wizard's first step can offer - resolved from a manifest pin
 * that survived the `BOOTSTRAP_SUPPORTED_ENGINES` filter (`bootstrapEngineOptions`'s handler,
 * `src/main/modules/downloads/index.ts`). Deliberately its own shape, not `ManifestPackage` reused
 * as-is - the wizard step only ever needs to identify and label a choice, never the mirrors/
 * contents a `ManifestPackage` also carries.
 */
export interface BootstrapEngineOption {
  engine: EngineKind
  /** The pinned `ManifestPackage.id` this option would install. */
  packageId: string
  /** The pinned package's version, for display. */
  version: string
  /** The pinned package's download size, for display. */
  sizeBytes: number
}

/**
 * Story 074 D2: the verdict `computeTargetVerdict` (`src/main/modules/downloads/bootstrap/target.ts`)
 * produces for a folder the wizard's target-folder step is considering - "the wizard renders
 * verdicts, it never judges paths itself" (Decisions (Sprint)). Every field is a plain fact about
 * the folder; whether a given combination is merely a warning ("continue anyway") or blocks the
 * wizard entirely is `blocked`'s job, not something the renderer re-derives from the other fields.
 */
export interface BootstrapTargetVerdict {
  /** Canonicalised, absolute path the wizard would install into. */
  targetPath: string
  /**
   * True when the canonicalised target sits under `%ProgramFiles%` or `%ProgramFiles(x86)%`
   * (case-insensitive prefix match, since Windows paths are). Writing there needs elevation, but
   * the remedy - the existing `set-write-dir` mechanism `inspectInstallation` already uses - is a
   * later deliverable's UI concern, not this flag's: it only reports the fact.
   */
  programFiles: boolean
  /**
   * True when a cheap writability probe against the target (or, if the target does not exist yet,
   * its nearest existing ancestor) failed. Not blocking by itself: a `programFiles` target is
   * *expected* to fail this and is handled by that flag's remedy flow, not by generic blocking, so
   * a folder can be `notWritable: true` and `blocked: false` at the same time.
   */
  notWritable: boolean
  /**
   * A directory listing of the target folder, capped at `MAX_TARGET_VERDICT_ENTRIES` entries -
   * names only, not full metadata, since this is purely informational content for the AC3 "this
   * folder isn't empty" warning. Empty when the target does not exist yet or holds nothing.
   */
  entries: string[]
  /**
   * True when `inspectInstallation` already recognises the target as a working Quake II
   * installation. Unlike a merely non-empty folder (which is only a warning), this blocks the
   * wizard outright - the wizard's copy is "add it as an existing installation instead", not
   * "continue anyway".
   */
  alreadyInstalled: boolean
  /**
   * True when the wizard can never proceed against this target, whatever the user says -
   * `alreadyInstalled`, or the path itself failed a path-safety check (see `blockedReason`). Any
   * other warning (`programFiles`, `notWritable`, a non-empty `entries`) leaves this `false`:
   * "continue anyway" is the wizard's call, not this function's.
   */
  blocked: boolean
  /**
   * Why `blocked` is `true`; absent whenever it is `false`.
   *
   * - `'alreadyInstalled'` - `alreadyInstalled` above is `true`.
   * - `'unsafePath'` - the target is not a path this launcher will ever write to: not absolute
   *   once canonicalised, a Windows device path (`\\.\...`) or a reserved device name (`CON`,
   *   `NUL`, `PRN`, `COM1`-`COM9`, `LPT1`-`LPT9`), or inside the launcher's own installation
   *   directory.
   */
  blockedReason?: 'alreadyInstalled' | 'unsafePath'
}

/**
 * Story 088 D1: the fixed, closed set of reasons `inspectRetailSource`
 * (`src/main/modules/downloads/bootstrap/retail-source.ts`) reports when a candidate source folder
 * does not verify as a known retail Quake II install (AC3: "tells the user this installation's data
 * could not be verified as retail"). Never prose, same convention as `DOWNLOADS_ERROR_KEYS` above -
 * the actual byte size behind a `*SizeMismatch` reason is not folded into the key/params here; it is
 * already sitting on the matching `RetailPakInfo.sizeBytes` in the same `RetailSourceInspection`, so
 * a later UI can render "expected X, got Y" from `RETAIL_PAK_SIZES` plus that field without this key
 * needing to carry a duplicate.
 */
export const RETAIL_SOURCE_UNVERIFIED_REASON_KEYS = [
  /** No `baseq2` directory at all under the candidate root - `rerelease/baseq2` never counts (the
   * remaster is a whole second game, not this check's concern; see `NON_GAME_DIRS`). */
  'bootstrap.retailSource.baseDirMissing',
  'bootstrap.retailSource.pak0Missing',
  'bootstrap.retailSource.pak1Missing',
  /** `pak0.pak` exists but its size does not exactly match `RETAIL_PAK_SIZES['pak0.pak']`. */
  'bootstrap.retailSource.pak0SizeMismatch',
  /** `pak1.pak` exists but its size does not exactly match `RETAIL_PAK_SIZES['pak1.pak']`. */
  'bootstrap.retailSource.pak1SizeMismatch',
] as const

export type RetailSourceUnverifiedReasonKey = (typeof RETAIL_SOURCE_UNVERIFIED_REASON_KEYS)[number]

/**
 * Story 088 D2: one store installation `listDetectedRetailSources`
 * (`main/modules/downloads/bootstrap/retail-source.ts`) found and already inspected - what the
 * wizard's `bootstrap.retailSources` handler answers, and exactly what the wizard's source picker
 * needs to render one row (AC2: "each is identified by its store and its path") and, via
 * `inspection`, whether it can be chosen at all (AC3). Deliberately just these three fields - no
 * extra convenience data the renderer could grow to depend on instead of reading `inspection`.
 */
export interface DetectedRetailSource {
  /** Narrower than `InstallationSource`: only the three stores this data source ever offers
   * (Decisions (Sprint): "offered only if it is a store source"). */
  source: 'steam' | 'gog' | 'epic'
  /** The candidate root as the detector found it - the same path `inspection` was computed from. */
  rootPath: string
  inspection: RetailSourceInspection
}

/**
 * Story 088 D1: one pak file's presence/size fact, as `inspectRetailSource` reports it for each of
 * `pak0.pak`/`pak1.pak`/`pak2.pak`. `matchesRetailSize` is always `false` when `exists` is `false` -
 * there is no size to compare.
 */
export interface RetailPakInfo {
  exists: boolean
  /** The pak's actual size in bytes, or `null` when it does not exist. */
  sizeBytes: number | null
  /** True only when `exists` and `sizeBytes` exactly matches `RETAIL_PAK_SIZES` for this file name. */
  matchesRetailSize: boolean
}

/**
 * Story 088 D1: what `inspectRetailSource` reports about one candidate source folder's `baseq2` -
 * the retail-detection half of the bootstrap wizard's "install from a source I already own" path
 * (AC3). `rerelease/` is never probed, deliberately (the story's Decisions): a folder that only has
 * `rerelease/baseq2` and no top-level `baseq2` reports as unverified, not silently discovered.
 *
 * `verified` gates on `pak0.pak`/`pak1.pak` only - both must exist and match `RETAIL_PAK_SIZES`
 * exactly. `pak2.pak` (the mission-pack-adjacent bonus pak in a retail install) is reported the same
 * way for completeness, but its presence or size never affects `verified`.
 */
export interface RetailSourceInspection {
  /** The candidate root passed in - the folder `<rootPath>/baseq2` was resolved against, not
   * `<rootPath>/baseq2` itself. */
  rootPath: string
  pak0: RetailPakInfo
  pak1: RetailPakInfo
  pak2: RetailPakInfo
  /** True only when `pak0`/`pak1` both `exist` and `matchesRetailSize`. */
  verified: boolean
  /** Set only when `verified` is `false`; one of `RETAIL_SOURCE_UNVERIFIED_REASON_KEYS`. */
  unverifiedReason?: RetailSourceUnverifiedReasonKey
  /** Whether `baseq2/video` exists as a directory. */
  hasVideo: boolean
  /** Whether `baseq2/players` exists as a directory. */
  hasPlayers: boolean
}

/**
 * Story 074 D4: the name a bootstrapped installation gets when the wizard does not carry one
 * (Decisions (Sprint)). Not an i18n key: an installation name is user data the user can rename,
 * not a translated label - the same reason `suggestName()` (`main/services/inspector.ts`) hands
 * back a bare folder name. Exported from the contract so the wizard's name field can prefill with
 * exactly what main would default to.
 */
export const DEFAULT_BOOTSTRAP_INSTALLATION_NAME = 'Q2PRO Demo'

/**
 * Story 088 D4: where a bootstrap run's *game data* comes from - [[074]]'s free demo + point-release
 * download, or a copy of a retail installation the user already owns (a detected Steam/GOG/Epic
 * source, [[088]]; a hand-picked folder, [[089]]). The engine build is downloaded either way, so
 * this never selects "download or not" - only which archive, or which folder, `baseq2`'s paks come
 * out of. Same two members as `assemble.ts`'s own `dataSource` (`buildAssemblePlan`), which is what
 * this value is ultimately forwarded to.
 */
export type BootstrapDataSource = 'free-download' | 'store-copy'

/**
 * Story 074 D1 placeholder, finalized by D4: what `bootstrap.start` takes. `engine` is validated
 * against `BOOTSTRAP_SUPPORTED_ENGINES` by the handler's schema, so it is always one of the
 * currently bootstrap-supported engines (Q2PRO, R1Q2 - story 080 D2).
 */
export interface StartBootstrapInput {
  engine: EngineKind
  /** Absolute folder to install into. Re-verified in main by `computeTargetVerdict` - a renderer
   * that skipped or ignored the target step cannot get past the handler. */
  targetPath: string
  /** Installation name; main falls back to `DEFAULT_BOOTSTRAP_INSTALLATION_NAME` when absent. */
  name?: string
  /** AC7's optional extras: `video/*` and `players/*` out of the point-release archive. */
  includeVideoAndPlayers: boolean
  /**
   * Story 074 AC2's remedy, threaded end to end: when the target step's Program-Files warning
   * offered "pick a write dir" and the user picked one, this is that path. Persisted on the
   * freshly-created installation via the same `Installation.writeDirPath` field
   * `ChecksList.tsx`'s existing `set-write-dir` remedy writes - not a second write-access concept.
   * Absent when the user never picked a remedy path (or the warning never applied).
   */
  writeDirPath?: string
  /**
   * Story 088 D4: which game-data source this run uses. Optional and defaulting to
   * `'free-download'` - the only source that existed before [[088]] - so every caller written
   * against [[074]]'s wizard keeps meaning exactly what it meant, the same choice
   * `BuildAssemblePlanInput.dataSource` (`bootstrap/assemble.ts`, D3) makes one layer down.
   */
  dataSource?: BootstrapDataSource
  /**
   * Story 088 D4: the root of the retail installation to copy `baseq2`'s paks from. Required when
   * `dataSource` is `'store-copy'` and refused otherwise - `startBootstrapInputSchema`
   * (`main/modules/downloads/schemas.ts`) enforces both, so neither combination reaches main.
   *
   * **Never trusted** (CLAUDE.md, and Decisions (Sprint): "the picker list is a UI convenience, not
   * an authorisation"): before anything is registered or copied, `startBootstrap` re-lists the
   * detected sources in main and re-inspects them, and refuses this run with
   * `downloads.error.retailSourceUnverified` unless this path is among them *and* still verifies as
   * retail. What is then copied from is main's own `DetectedRetailSource.rootPath`, not this string.
   */
  copySourcePath?: string
}

/** One package a bootstrap would download, as the confirm step lists it. */
export interface BootstrapSummaryPackage {
  /** The `ManifestPackage.id`. */
  id: string
  version: string
  sizeBytes: number
  /** What this package contributes: the engine build, the free demo data, or the point release. */
  role: 'engine' | 'demo' | 'point-release'
}

/**
 * Story 074 D1 placeholder, finalized by D4: what the wizard's confirm step renders before
 * anything is downloaded (AC4) - the three packages and their summed size.
 *
 * D1 guessed a post-run summary (`installationId`); the shape the story actually needs is this
 * pre-run one, because AC4's "the confirm step states what will be downloaded and how large it is"
 * is the only place a summary is read. What comes out of a *finished* bootstrap is the
 * `Installation` itself plus its job - neither needs a second wire type.
 */
export interface BootstrapSummary {
  /** The target path as the wizard sent it to `bootstrapSummary` - not independently
   * re-canonicalised here (that already happened once, in the target step's own
   * `computeTargetVerdict` call); AC4 only needs the same path echoed back for display. */
  targetPath: string
  engine: EngineKind
  /** Engine build, demo data, point release - in download order. For a `'store-copy'` summary
   * (story 088 D4) the engine build alone: nothing else is downloaded. */
  packages: BootstrapSummaryPackage[]
  /** Sum of every entry's `sizeBytes`; the number AC4's confirm step states. */
  totalSizeBytes: number
  includeVideoAndPlayers: boolean
  /**
   * Story 088 D4 (AC5): which game-data source the summarised run would use. Always present -
   * `'free-download'` for a summary that names no other source, which is every summary written
   * before [[088]].
   */
  dataSource: BootstrapDataSource
  /** Story 088 D4 (AC5): what a `'store-copy'` run would copy from. Absent for `'free-download'`. */
  copySource?: BootstrapSummaryCopySource
}

/**
 * Story 088 D4 (AC5): the copy source the confirm step names, next to the engine-only download and
 * the target. Produced in main from its *own* freshly listed detected sources, never echoed back
 * from the wizard - so the path shown is the path the job would read from.
 */
export interface BootstrapSummaryCopySource {
  /** The retail installation root the paks would be copied out of. */
  path: string
  /** Which store it was detected in; absent when main's fresh list no longer holds this path (in
   * which case `bootstrap.start` will refuse the run outright - the summary only reports). */
  store?: DetectedRetailSource['source']
}
