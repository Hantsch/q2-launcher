import type { EngineKind } from '../types'

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
] as const

export type DownloadsErrorKey = (typeof DOWNLOADS_ERROR_KEYS)[number]
