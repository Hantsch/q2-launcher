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
