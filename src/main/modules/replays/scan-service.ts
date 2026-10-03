import { stat } from 'node:fs/promises'
import { demoReadability } from '@shared/demos/readability'
import type { DemoUnreadable } from '@shared/demos/readability'
import {
  REPLAYS_EVENTS,
  demoSourceKey,
  discoveredDemoSchema,
  type DemoUnparsableReason,
  type DiscoveredDemo,
  type ReplaysOverview,
  type ReplaysScanProgress,
  type ReplaysScanStartResult,
  type ReplaysSourceError,
} from '@shared/modules/replays'
import {
  compileNameTemplate,
  matchNameTemplate,
  type NameFacts,
} from '@shared/replays/name-template'
import { readDemoDuration, readDemoHeader } from '../../lib/demo-bytes'
import { demoIdForPath, type DiscoveredDemoFile } from './discovery'
import type { CachedDemo, ReplaysIndexCache } from './index-cache'
import { runIncrementalScan, type IncrementalScanSource } from './incremental-scan'

/**
 * The replays index scan service - the one stateful thing between discovery
 * (`discovery.ts`), the incremental scan core (`incremental-scan.ts`) and the index cache
 * (`index-cache.ts`). Shaped after `servers/scan-service.ts`:
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
 * The scan writes nothing but the index cache file: never a sidecar, never `state.json`.
 *
 * The cached `parsed` fact is the full IPC row (`DiscoveredDemo`, map/unparsableReason filled), so
 * the cache alone can answer `read()` before discovery has run. Rows from the file are validated
 * against `discoveredDemoSchema`; one that fails is dropped from the cache, i.e. re-parsed
 * (story 144)
 */

/** The header facts one parse settles on - everything a row needs beyond what discovery knows.
 * `readable`/`unreadable` are the `demoReadability` projection of the same parse -
 * carried alongside `map`/`unparsableReason` rather than replacing them, so existing readers of
 * those two fields keep working unchanged (story 145) */
export interface DemoHeaderFacts {
  map: string | null
  unparsableReason: DemoUnparsableReason | null
  readable: boolean
  unreadable: DemoUnreadable | null
  /** An ok header's game dir / POV / players (null/null/[] otherwise), and the frame
   * count's duration (null when it could not be counted, or the header was unreadable). Same
   * shape as the row's fields, so a cached row (`entry.parsed`) satisfies this type as-is (story 150) */
  gameDir: string | null
  pov: string | null
  players: string[]
  durationMs: number | null
}

/** A discovered demo plus the identity the incremental scan compares against the cache. For a zip entry, `size`,
 * `mtimeMs` and `birthtimeMs` are the archive's own (its `absolutePath` is the archive), so an entry
 * of an unchanged archive is a cache hit. */
export type ReplaysScanFile = DiscoveredDemoFile & {
  size: number
  mtimeMs: number
  birthtimeMs: number
}

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
  discover: () => Promise<{ demos: DiscoveredDemoFile[]; sourceErrors: ReplaysSourceError[] }>
  /** Parses one changed/new demo's header - called only for cache misses. */
  parse: (file: ReplaysScanFile) => Promise<DemoHeaderFacts>
  /** The current naming templates' matcher and fingerprint, resolved once per scan. */
  nameMatcher: () => ReplaysNameMatcher
  /** Read once per scan, at its start - `app.launch.isRunning()` in production. */
  isGameRunning: () => boolean
  /** Awaited right after the post-discovery progress push (the one carrying the
   * totals) and before the incremental scan itself - the harness's scan-hold seam
   * (`scanHoldMs`/`index.ts`). Skipped entirely when absent. */
  holdAfterDiscovery?: () => Promise<void>
  now?: () => number
  log?: ReplaysScanLog
}

export interface ReplaysScanService {
  start: () => ReplaysScanStartResult
  read: () => Promise<DiscoveredDemo[]>
  overview: () => Promise<ReplaysOverview>
  /** Resolves a demo id to the file identity a sidecar store needs: its absolute path
   * and whether it's a zip entry. `undefined` before this process's first successful scan has seen
   * the id, same as any other id the index doesn't know about - never backfilled from the cache
   * (the cache does not retain `absolutePath`) (story 146) */
  resolveFile: (
    id: string,
  ) => { absolutePath: string; archiveEntry: DiscoveredDemo['archiveEntry'] } | undefined
  /** Renames a demo's identity in place, without a re-scan. Looks the old id up in
   * `fileById`; `undefined` (a no-op) when it is not known - no successful scan has seen it, or a
   * later scan has already replaced it. Otherwise re-keys `snapshot`, `fileById` and `lastCache`
   * (persisted via `cache.write`, same as a normal scan) to the new id/path/name, re-matching
   * `nameFacts` against the current `nameMatcher()` since the name changed; every other parsed fact
   * is carried over unchanged. Returns the updated row (story 157) */
  applyRename: (
    oldId: string,
    newAbsolutePath: string,
    newFileName: string,
  ) => Promise<DiscoveredDemo | undefined>
  /** Whether a scan is currently running - the same flag `overview()` reports as `scanning`. */
  isScanning: () => boolean
}

/** Explicit field pick: `absolutePath`/`size`/`mtimeMs`/`birthtimeMs` never reach a row.
 *
 * `fileTime` for a loose file (`file.archiveEntry === null`) is this scan's own `stat()`
 * (`file.birthtimeMs`/`file.mtimeMs`); for a zip entry it is whatever `expandZip` already settled
 * on (the entry's own modified stamp, or the archive's) and is carried through unchanged via
 * `facts` - see `readDemoFacts`.
 *
 * `nameFacts` is never set here (it comes from the incremental scan's own name
 * matcher, resolved once name and header facts are both known - see `withNameFacts` below); every
 * row still gets the field so it always satisfies `discoveredDemoSchema` (story 145)
 */
function toRow(file: ReplaysScanFile, facts: DemoHeaderFacts): DiscoveredDemo {
  return {
    id: file.id,
    fileName: file.fileName,
    format: file.format,
    gzip: file.gzip,
    source: file.source,
    archiveEntry: file.archiveEntry,
    map: facts.map,
    unparsableReason: facts.unparsableReason,
    readable: facts.readable,
    unreadable: facts.unreadable,
    // Picked from `facts` on every path: a fresh parse's `DemoHeaderFacts`, or - on a cache hit -
    // the cached row itself (`runScan`'s `toRow(entry.file, entry.parsed)`), never from `file`,
    // whose loose-file values are discovery's null/[] placeholders.
    gameDir: facts.gameDir,
    pov: facts.pov,
    players: facts.players,
    durationMs: facts.durationMs,
    fileTime:
      file.archiveEntry !== null
        ? file.fileTime
        : { birthtimeMs: file.birthtimeMs, mtimeMs: file.mtimeMs },
    nameFacts: null,
  }
}

/** Merges this scan's (possibly freshly re-matched) name facts onto an already-built row. Applied
 * as the very last step, uniformly to a fresh parse, a reused cache hit, and a row served straight
 * from the on-disk cache before this process's first scan - so a template change is reflected even
 * when the header facts themselves were reused untouched. */
function withNameFacts(row: DiscoveredDemo, name: unknown): DiscoveredDemo {
  return { ...row, nameFacts: (name ?? null) as NameFacts | null }
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
  const byPath = new Map<
    string,
    Promise<{ size: number; mtimeMs: number; birthtimeMs: number } | null>
  >()
  const out: ReplaysScanFile[] = []
  for (const demo of demos) {
    let pending = byPath.get(demo.absolutePath)
    if (pending === undefined) {
      pending = stat(demo.absolutePath).then(
        (s) => ({ size: s.size, mtimeMs: s.mtimeMs, birthtimeMs: s.birthtimeMs }),
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
    // The zip layer (`zip-demos.ts`) already ran `demoReadability` (or its own zip-stage reasons)
    // at discovery time; never re-open the archive here.
    return {
      map: file.map,
      unparsableReason: file.unparsableReason,
      readable: file.readable,
      unreadable: file.unreadable,
      gameDir: file.gameDir,
      pov: file.pov,
      players: file.players,
      durationMs: file.durationMs,
    }
  }
  const header = await readDemoHeader(file.absolutePath)
  // `readDemoHeader` adds one I/O-only reason (`unreadable`) beyond the real parsers' own union;
  // it is still a member of `DemoUnreadableReason`, `demoReadability`'s actual contract.
  const readability = demoReadability(header as Parameters<typeof demoReadability>[0])
  if (!header.ok) {
    // An unreadable header is never worth a full-file frame count.
    return {
      map: null,
      unparsableReason: header.reason as DemoUnparsableReason,
      readable: false,
      unreadable: readability.unreadable,
      gameDir: null,
      pov: null,
      players: [],
      durationMs: null,
    }
  }
  const duration = await readDemoDuration(file.absolutePath)
  return {
    map: header.map,
    unparsableReason: null,
    readable: true,
    unreadable: null,
    gameDir: header.gameDir,
    pov: header.pov,
    players: header.players,
    durationMs: duration.ok ? duration.durationMs : null,
  }
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

export function createReplaysScanService(
  options: CreateReplaysScanServiceOptions,
): ReplaysScanService {
  const { emit, cache, discover, parse, nameMatcher, isGameRunning, holdAfterDiscovery, log } =
    options
  const now = options.now ?? Date.now

  let running = false
  let loaded: Promise<Map<string, CachedDemo>> | null = null
  /** The last successful scan's `nextCache` - newer than the file once a scan has run. */
  let lastCache: Map<string, CachedDemo> | null = null
  /** The last successful scan's rows; `null` until this process's first scan succeeds. */
  let snapshot: DiscoveredDemo[] | null = null
  /** The last successful scan's source errors - `[]` until any scan has succeeded.
   * Every push while a scan runs carries this (still the *previous* scan's), swapped for this
   * scan's own right after the snapshot swap, so the final `running: false` push carries the fresh
   * set. A throwing scan leaves this untouched, same as `lastCache`/`snapshot` (story 151) */
  let lastSourceErrors: ReplaysSourceError[] = []
  /** `id -> file` for the last successful scan's rows - the sidecar store's only index
   * dependency (`resolveFile`), kept in lockstep with `snapshot`/`lastCache` and never populated on
   * a failed scan (story 146) */
  const fileById = new Map<string, ReplaysScanFile>()

  const loadCache = (): Promise<Map<string, CachedDemo>> =>
    (loaded ??= cache.read().then(usableCache, () => new Map<string, CachedDemo>()))

  async function runScan(): Promise<void> {
    const progress = new Map<string, { scanned: number; total: number }>()
    const emitProgress = (isRunning: boolean): void => {
      const payload: ReplaysScanProgress = {
        running: isRunning,
        sources: [...progress].map(([sourceKey, counts]) => ({ sourceKey, ...counts })),
        sourceErrors: lastSourceErrors,
      }
      emit(REPLAYS_EVENTS.scanProgress, payload)
    }

    try {
      // Runs synchronously inside `start()`: the first push goes out before `start()` returns.
      emitProgress(true)

      const previous = lastCache ?? (await loadCache())
      const names = nameMatcher()
      const discovered = await discover()
      const sources = groupSources(await statScanFiles(discovered.demos))
      for (const source of sources) {
        progress.set(source.sourceKey, { scanned: 0, total: source.files.length })
      }
      emitProgress(true)

      if (holdAfterDiscovery) await holdAfterDiscovery()

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
      // `withNameFacts` merges in this scan's own name match last, so a template change is
      // reflected even on a cache hit that only re-matched the name (story 145)
      snapshot = [...result.entries.values()].map((entry) =>
        withNameFacts(toRow(entry.file, entry.parsed as DiscoveredDemo), entry.name),
      )
      for (const [id, entry] of result.entries) fileById.set(id, entry.file)
      lastCache = result.nextCache
      lastSourceErrors = discovered.sourceErrors
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
    return [...cached.values()].map((entry) =>
      withNameFacts(entry.parsed as DiscoveredDemo, entry.name),
    )
  }

  async function overview(): Promise<ReplaysOverview> {
    const rows = await read()
    return { scanning: running, demoCount: rows.length }
  }

  function resolveFile(
    id: string,
  ): { absolutePath: string; archiveEntry: DiscoveredDemo['archiveEntry'] } | undefined {
    const file = fileById.get(id)
    return file ? { absolutePath: file.absolutePath, archiveEntry: file.archiveEntry } : undefined
  }

  async function applyRename(
    oldId: string,
    newAbsolutePath: string,
    newFileName: string,
  ): Promise<DiscoveredDemo | undefined> {
    const oldFile = fileById.get(oldId)
    if (!oldFile) return undefined
    if (snapshot === null) return undefined
    const oldRowIndex = snapshot.findIndex((row) => row.id === oldId)
    if (oldRowIndex === -1) return undefined

    const newId = demoIdForPath(newAbsolutePath)
    const matched = nameMatcher().match(newFileName)
    const newRow = withNameFacts(
      { ...snapshot[oldRowIndex], id: newId, fileName: newFileName },
      matched,
    )

    snapshot = snapshot.map((row, i) => (i === oldRowIndex ? newRow : row))

    fileById.delete(oldId)
    fileById.set(newId, {
      ...oldFile,
      id: newId,
      fileName: newFileName,
      absolutePath: newAbsolutePath,
    })

    if (lastCache) {
      const oldCached = lastCache.get(oldId)
      if (oldCached) {
        lastCache.delete(oldId)
        lastCache.set(newId, { ...oldCached, parsed: newRow, name: matched ?? null })
        await cache.write(lastCache)
      }
    }

    return newRow
  }

  function isScanning(): boolean {
    return running
  }

  return { start, read, overview, resolveFile, applyRename, isScanning }
}
