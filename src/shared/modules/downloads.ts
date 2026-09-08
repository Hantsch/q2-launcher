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
 * Story 071 D1: the `downloads` module's own settings, persisted under `state.json`'s
 * `downloads` top-level key (`main/services/state.ts`). [[072]] only contributes the UI section
 * over this same shape - "reads the limit" needs a source that exists, which is what this story
 * provides.
 */
export interface DownloadsSettings {
  /**
   * How many jobs the queue admits at once; the rest stay `queued` (AC2). Range
   * `MIN_CONCURRENT_DOWNLOAD_JOBS`-`MAX_CONCURRENT_DOWNLOAD_JOBS`, default 2 - enough parallelism
   * to matter without hammering a mirror or the disk.
   */
  concurrentJobs: number
}

export const DEFAULT_DOWNLOADS_SETTINGS: DownloadsSettings = {
  concurrentJobs: 2,
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
