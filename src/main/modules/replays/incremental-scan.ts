import type { CachedDemo } from './index-cache'

/**
 * Story 144: the incremental scan core. Given the previous scan's cache and this scan's file
 * listing, decides per file whether to reuse cached facts, re-run only the name matcher, re-parse
 * from scratch, or skip a file that looks like it is still being written by a running game.
 *
 * Pure and injectable: no `fs`, no electron, no timers beyond the injected `now`/`yieldNow` - the
 * caller (a later deliverable) owns discovery, parsing and file-system access.
 */

/** A cache hit this young while the game is running is treated as still-being-written and skipped
 * rather than parsed - see rule (b) in `runIncrementalScan`'s doc comment. */
export const LIVE_WRITE_WINDOW_MS = 30_000

/** The minimal per-file shape this module needs; callers pass their own richer discovery entry
 * through untouched via the `TFile` type parameter. */
export interface IncrementalScanFile {
  id: string
  size: number
  mtimeMs: number
}

export interface IncrementalScanSource<TFile extends IncrementalScanFile> {
  sourceKey: string
  files: TFile[]
}

/** One scanned demo: the caller's own file record plus the facts this scan settled on. */
export interface ScannedDemo<TFile extends IncrementalScanFile> {
  file: TFile
  size: number
  mtimeMs: number
  patternFingerprint: string
  /** Reused from cache, or freshly produced by `parse` - opaque to this module either way. */
  parsed: unknown
  /** Reused from cache, or freshly produced by `matchName` - opaque to this module either way. */
  name: unknown
}

export interface RunIncrementalScanInput<TFile extends IncrementalScanFile> {
  sources: IncrementalScanSource<TFile>[]
  /** Previous scan's cache, keyed by `file.id`. Not mutated. */
  cache: Map<string, CachedDemo>
  /** The current naming-pattern fingerprint; a cached row whose own fingerprint differs gets its
   * name re-matched (but not re-parsed) before being reused. */
  patternFingerprint: string
  /** Opaque parser, e.g. reading and decoding a demo's header. Never called for a cache hit whose
   * only change is `patternFingerprint`. */
  parse: (file: TFile) => Promise<unknown>
  /** Opaque name matcher. Called for cache misses and for cache hits with a stale fingerprint. */
  matchName: (file: TFile) => unknown
  now: number
  isGameRunning: boolean
  /** Called after every 25th file processed across the whole scan, and once more at the end of
   * each source (even short of a multiple of 25), with that source's own running/total counts. */
  onProgress: (sourceKey: string, scanned: number, total: number) => void
  /** Cooperative yield point, invoked every 25 files processed across the whole scan. Defaults to
   * a `setImmediate`-based promise; tests inject their own to observe/skip it. */
  yieldNow?: () => Promise<void>
}

export interface RunIncrementalScanResult<TFile extends IncrementalScanFile> {
  /** This scan's demos, keyed by `file.id`. Deleted files (present in `cache` but not in this
   * scan's `sources`) and skipped-live files are absent. */
  entries: Map<string, ScannedDemo<TFile>>
  /** Exactly the files reused-with-hit or freshly parsed this scan; the next scan's `cache`. */
  nextCache: Map<string, CachedDemo>
  /** Total count, across the whole scan, of files skipped under rule (b)'s live-write guard. */
  skippedLive: number
}

function defaultYieldNow(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

/**
 * Decides, file by file and in this order, whether to:
 * (a) reuse a cache row whose `size`/`mtimeMs` still match - re-matching only the name when the
 *     row's `patternFingerprint` is stale, never re-parsing;
 * (b) skip a changed/new file that looks still-in-progress (`isGameRunning` and modified within
 *     `LIVE_WRITE_WINDOW_MS` of `now`) - absent from both `entries` and `nextCache`;
 * (c) otherwise parse and name-match the file fresh.
 */
export async function runIncrementalScan<TFile extends IncrementalScanFile>(
  input: RunIncrementalScanInput<TFile>,
): Promise<RunIncrementalScanResult<TFile>> {
  const yieldNow = input.yieldNow ?? defaultYieldNow
  const entries = new Map<string, ScannedDemo<TFile>>()
  const nextCache = new Map<string, CachedDemo>()
  let skippedLive = 0
  let processedSinceYield = 0

  for (const source of input.sources) {
    const total = source.files.length
    let scanned = 0

    for (const file of source.files) {
      const cached = input.cache.get(file.id)

      if (cached && cached.size === file.size && cached.mtimeMs === file.mtimeMs) {
        // (a) cache hit on size+mtime: reuse `parsed`; re-match the name only if the pattern
        // fingerprint moved on since this row was cached.
        const name =
          cached.patternFingerprint === input.patternFingerprint
            ? cached.name
            : input.matchName(file)

        entries.set(file.id, {
          file,
          size: file.size,
          mtimeMs: file.mtimeMs,
          patternFingerprint: input.patternFingerprint,
          parsed: cached.parsed,
          name,
        })
        nextCache.set(file.id, {
          size: file.size,
          mtimeMs: file.mtimeMs,
          patternFingerprint: input.patternFingerprint,
          parsed: cached.parsed,
          name,
        })
      } else if (input.isGameRunning && input.now - file.mtimeMs < LIVE_WRITE_WINDOW_MS) {
        // (b) new or changed, but young enough to still be mid-write while the game runs: skip.
        skippedLive += 1
      } else {
        // (c) new or changed, and safe to read: parse and name-match fresh.
        const parsed = await input.parse(file)
        const name = input.matchName(file)

        entries.set(file.id, {
          file,
          size: file.size,
          mtimeMs: file.mtimeMs,
          patternFingerprint: input.patternFingerprint,
          parsed,
          name,
        })
        nextCache.set(file.id, {
          size: file.size,
          mtimeMs: file.mtimeMs,
          patternFingerprint: input.patternFingerprint,
          parsed,
          name,
        })
      }

      scanned += 1
      processedSinceYield += 1

      if (scanned % 25 === 0 || scanned === total) {
        input.onProgress(source.sourceKey, scanned, total)
      }
      if (processedSinceYield >= 25) {
        processedSinceYield = 0
        await yieldNow()
      }
    }
  }

  return { entries, nextCache, skippedLive }
}
