import { stat } from 'node:fs/promises'
import {
  REPLAYS_EVENTS,
  demoSourceKey,
  discoveredDemoSchema,
  type DemoUnparsableReason,
  type DiscoveredDemo,
  type ReplaysOverview,
  type ReplaysScanProgress,
  type ReplaysScanStartResult,
} from '@shared/modules/replays'
import { compileNameTemplate, matchNameTemplate } from '@shared/replays/name-template'
import { readDemoHeader } from '../../lib/demo-bytes'
import type { DiscoveredDemoFile } from './discovery'
import type { CachedDemo, ReplaysIndexCache } from './index-cache'
import { runIncrementalScan, type IncrementalScanSource } from './incremental-scan'

/**
 * Story 144 D3: the replays index scan service - the one stateful thing between discovery
 * (`discovery.ts`), the incremental scan core (`incremental-scan.ts`, D2) and the index cache
 * (`index-cache.ts`, D1). Shaped after `servers/scan-service.ts`:
 *
 * - **Single-flight.** `start()` is synchronous: `{ started: false }` while a scan runs (nothing is
 *   queued, no second discovery or parse is kicked off), otherwise `{ started: true }` - the scan
 *   itself (`runScan`) is fired with `void` and continues in the background.
 * - **Lazy, cache-first.** The cache file is read once, on the first `read()`/`overview()`/scan of
 *   this service's life - never at construction. Until this process's first scan succeeds,
 *   `read()` answers the cached rows; after that, the last successful scan's rows.
 * - **Ordering on success:** in-memory snapshot swapped -> cache written -> running flag cleared ->
 *   `scan.progress { running: false }` pushed. So a renderer that re-reads on that push always gets
 *   the new rows, and an `overview.read` it triggers already says `scanning: false`.
 * - **On a throw anywhere before the swap** (discovery, stat, name templates, parse): logged, the
 *   previous snapshot stays, `cache.write` is never called (the cache file is untouched), and the
 *   `finally` still clears the running flag and pushes `running: false` - a throwing scan can never
 *   leave the flag stuck. A throw from `cache.write` itself keeps the new (correct) snapshot and the
 *   in-memory cache; only persistence is lost, and the next successful scan writes it again.
 *
 * The scan writes nothing but the D1 cache file: never a sidecar, never `state.json`.
 *
 * The cached `parsed` fact is the full IPC row (`DiscoveredDemo`, map/unparsableReason filled), so
 * the cache alone can answer `read()` before discovery has run. Rows from the file are validated
 * against `discoveredDemoSchema`; one that fails is dropped from the cache, i.e. re-parsed.
 */

/** The header facts one parse settles on - everything a row needs beyond what discovery knows. */
export interface DemoHeaderFacts {
  map: string | null
  unparsableReason: DemoUnparsableReason | null
}

/** A discovered demo plus the identity D2 compares against the cache. For a zip entry, `size` and
 * `mtimeMs` are the archive's own (its `absolutePath` is the archive), so an entry of an unchanged
 * archive is a cache hit. */
export type ReplaysScanFile = DiscoveredDemoFile & { size: number; mtimeMs: number }

export interface ReplaysNameMatcher {
  fingerprint: string
  match: (fileName: string) => unknown
}

export interface ReplaysScanLog {
  warn(message: string, error?: unknown): void
}

export interface CreateReplaysScanServiceOptions {
  emit: (type: string, payload: unknown) => void
  cache: Pick<ReplaysIndexCache, 'read' | 'write'>
  /** Runs discovery fresh; read at scan time, never captured once. */
  discover: () => Promise<DiscoveredDemoFile[]>
  /** Parses one changed/new demo's header - called only for cache misses. */
  parse: (file: ReplaysScanFile) => Promise<DemoHeaderFacts>
  /** The current naming templates' matcher and fingerprint, resolved once per scan. */
  nameMatcher: () => ReplaysNameMatcher
  /** Read once per scan, at its start - `app.launch.isRunning()` in production. */
  isGameRunning: () => boolean
  now?: () => number
  log?: ReplaysScanLog
}

export interface ReplaysScanService {
  start: () => ReplaysScanStartResult
  read: () => Promise<DiscoveredDemo[]>
  overview: () => Promise<ReplaysOverview>
}

/** Explicit field pick: `absolutePath`/`size`/`mtimeMs` never reach a row. */
function toRow(file: DiscoveredDemoFile, facts: DemoHeaderFacts): DiscoveredDemo {
  return {
    id: file.id,
    fileName: file.fileName,
    format: file.format,
    gzip: file.gzip,
    source: file.source,
    archiveEntry: file.archiveEntry,
    map: facts.map,
    unparsableReason: facts.unparsableReason,
  }
}

/** Drops every cache row whose `parsed` is not a valid row - it simply becomes a miss. */
function usableCache(raw: Map<string, CachedDemo>): Map<string, CachedDemo> {
  const out = new Map<string, CachedDemo>()
  for (const [id, entry] of raw) {
    const row = discoveredDemoSchema.safeParse(entry.parsed)
    if (row.success && row.data.id === id) out.set(id, { ...entry, parsed: row.data })
  }
  return out
}

/** Stats every discovered demo; a file that vanished since the listing is left out. One `stat()`
 * per distinct path, so a zip's entries share their archive's. */
async function statScanFiles(demos: DiscoveredDemoFile[]): Promise<ReplaysScanFile[]> {
  const byPath = new Map<string, Promise<{ size: number; mtimeMs: number } | null>>()
  const out: ReplaysScanFile[] = []
  for (const demo of demos) {
    let pending = byPath.get(demo.absolutePath)
    if (pending === undefined) {
      pending = stat(demo.absolutePath).then(
        (s) => ({ size: s.size, mtimeMs: s.mtimeMs }),
        () => null,
      )
      byPath.set(demo.absolutePath, pending)
    }
    const identity = await pending
    if (identity !== null) out.push({ ...demo, ...identity })
  }
  return out
}

/** One scan source per distinct `DemoSource` (`demoSourceKey`), in discovery's own order. */
function groupSources(files: ReplaysScanFile[]): IncrementalScanSource<ReplaysScanFile>[] {
  const bySource = new Map<string, ReplaysScanFile[]>()
  for (const file of files) {
    const key = demoSourceKey(file.source)
    const list = bySource.get(key)
    if (list) list.push(file)
    else bySource.set(key, [file])
  }
  return [...bySource].map(([sourceKey, sourceFiles]) => ({ sourceKey, files: sourceFiles }))
}

/**
 * The production `parse`: a loose file's header is read off disk; a zip entry's facts are the ones
 * discovery already parsed while expanding the archive, so it is not opened a second time.
 */
export async function readDemoFacts(file: ReplaysScanFile): Promise<DemoHeaderFacts> {
  if (file.archiveEntry !== null) {
    return { map: file.map, unparsableReason: file.unparsableReason }
  }
  const header = await readDemoHeader(file.absolutePath)
  if (!header.ok) return { map: null, unparsableReason: header.reason as DemoUnparsableReason }
  return { map: header.map, unparsableReason: null }
}

/** The first template that matches a file name wins; a template that fails to compile is
 * skipped. `null` when none matches. */
export function nameMatcherFor(templates: string[], fingerprint: string): ReplaysNameMatcher {
  const compiled = templates.flatMap((text) => {
    const result = compileNameTemplate(text)
    return result.ok ? [result.template] : []
  })
  return {
    fingerprint,
    match: (fileName) => {
      for (const template of compiled) {
        const matched = matchNameTemplate(template, fileName)
        if (matched.kind === 'match') return matched.facts
      }
      return null
    },
  }
}

export function createReplaysScanService(options: CreateReplaysScanServiceOptions): ReplaysScanService {
  const { emit, cache, discover, parse, nameMatcher, isGameRunning, log } = options
  const now = options.now ?? Date.now

  let running = false
  let loaded: Promise<Map<string, CachedDemo>> | null = null
  /** The last successful scan's `nextCache` - newer than the file once a scan has run. */
  let lastCache: Map<string, CachedDemo> | null = null
  /** The last successful scan's rows; `null` until this process's first scan succeeds. */
  let snapshot: DiscoveredDemo[] | null = null

  const loadCache = (): Promise<Map<string, CachedDemo>> =>
    (loaded ??= cache.read().then(usableCache, () => new Map<string, CachedDemo>()))

  async function runScan(): Promise<void> {
    const progress = new Map<string, { scanned: number; total: number }>()
    const emitProgress = (isRunning: boolean): void => {
      const payload: ReplaysScanProgress = {
        running: isRunning,
        sources: [...progress].map(([sourceKey, counts]) => ({ sourceKey, ...counts })),
      }
      emit(REPLAYS_EVENTS.scanProgress, payload)
    }

    try {
      // Runs synchronously inside `start()`: the first push goes out before `start()` returns.
      emitProgress(true)

      const previous = lastCache ?? (await loadCache())
      const names = nameMatcher()
      const sources = groupSources(await statScanFiles(await discover()))
      for (const source of sources) {
        progress.set(source.sourceKey, { scanned: 0, total: source.files.length })
      }
      emitProgress(true)

      const result = await runIncrementalScan<ReplaysScanFile>({
        sources,
        cache: previous,
        patternFingerprint: names.fingerprint,
        parse: async (file) => toRow(file, await parse(file)),
        matchName: (file) => names.match(file.fileName),
        now: now(),
        isGameRunning: isGameRunning(),
        onProgress: (sourceKey, scanned, total) => {
          progress.set(sourceKey, { scanned, total })
          emitProgress(true)
        },
      })

      // Hit or fresh, `parsed` is always a row this service built (the file's are validated by
      // `usableCache`); the row's discovery fields come from this scan's `file`, never the cache.
      snapshot = [...result.entries.values()].map((entry) =>
        toRow(entry.file, entry.parsed as DiscoveredDemo),
      )
      lastCache = result.nextCache
      await cache.write(result.nextCache)
    } catch (error) {
      log?.warn('replays index scan failed; the previous index is kept', error)
    } finally {
      running = false
      try {
        emitProgress(false)
      } catch (error) {
        // `runScan` is fire-and-forget: a throwing `emit` must not become an unhandled rejection.
        log?.warn('replays scan progress push failed', error)
      }
    }
  }

  function start(): ReplaysScanStartResult {
    if (running) return { started: false }
    running = true
    void runScan()
    return { started: true }
  }

  async function read(): Promise<DiscoveredDemo[]> {
    if (snapshot !== null) return snapshot
    const cached = await loadCache()
    // A scan may have finished while the cache was loading.
    if (snapshot !== null) return snapshot
    return [...cached.values()].map((entry) => entry.parsed as DiscoveredDemo)
  }

  async function overview(): Promise<ReplaysOverview> {
    const rows = await read()
    return { scanning: running, demoCount: rows.length }
  }

  return { start, read, overview }
}
