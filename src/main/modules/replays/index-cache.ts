import { join } from 'node:path'
import { z } from 'zod'
import { JsonStore } from '../../lib/json-store'
import { userDataDir } from '../../lib/paths'

/**
 * Story 144 D1: the replays/demos index's own disposable cache file under `userData`, mirroring
 * `src/main/modules/home/news/feed-cache.ts`.
 *
 * `replays-index.json` holds one entry per discovered demo, keyed by discovery's opaque entry id,
 * so a re-scan can skip re-parsing a demo whose size/mtime have not changed since the last cache
 * write. Its own file, not a section of `state.json`: a regenerable cache of derived facts has no
 * business next to the installation list.
 *
 * `read()` answers an empty `Map` when the file is missing, empty, unparseable JSON, from another
 * cache version, or does not satisfy the schema below - never throws. "No cache" costs a full
 * re-read of every demo; a throw on a cache read would break app start.
 */

/** Bump whenever any cached fact shape changes - parsed facts, name facts - a bump discards,
 * never migrates, exactly like `NEWS_CACHE_VERSION` in feed-cache.ts. */
export const REPLAYS_INDEX_CACHE_VERSION = 2

export const REPLAYS_INDEX_CACHE_FILE = 'replays-index.json'

/** `userData/replays-index.json`. */
export function replaysIndexCacheFilePath(): string {
  return join(userDataDir(), REPLAYS_INDEX_CACHE_FILE)
}

/** Structurally satisfied by `Logger` (`src/main/lib/logger.ts`). */
export interface ReplaysIndexCacheLog {
  warn(message: string): void
}

/**
 * One cached demo's facts, keyed elsewhere by discovery's entry id. `size`/`mtimeMs` and
 * `patternFingerprint` are what a re-scan compares against the file on disk to decide whether
 * `parsed`/`name` can be reused instead of re-derived.
 */
export interface CachedDemo {
  size: number
  mtimeMs: number
  patternFingerprint: string
  /**
   * No exported schema for parsed header / name facts to reuse yet; validated permissively,
   * guarded by the cacheVersion check - a bump here discards this shape along with everything
   * else.
   */
  parsed: unknown
  /** See `parsed`'s comment above - same reasoning applies. */
  name: unknown
}

const cachedDemoSchema = z.object({
  size: z.number().finite(),
  mtimeMs: z.number().finite(),
  patternFingerprint: z.string(),
  parsed: z.unknown(),
  name: z.unknown(),
}) satisfies z.ZodType<CachedDemo>

/** The on-disk envelope: JSON has no native Map, so entries round-trip as a plain record. */
const cacheDocumentSchema = z.object({
  cacheVersion: z.literal(REPLAYS_INDEX_CACHE_VERSION),
  entries: z.record(z.string(), cachedDemoSchema),
})

type CacheDocument = z.infer<typeof cacheDocumentSchema> | null

/**
 * `JsonStore`'s `parse`, which may never throw. Anything it cannot fully vouch for becomes `null`,
 * i.e. "no cache" - one wasted re-read of every demo instead of an index built from junk.
 */
function parseCacheDocument(raw: unknown, log?: ReplaysIndexCacheLog): CacheDocument {
  const parsed = cacheDocumentSchema.safeParse(raw)
  if (!parsed.success) {
    log?.warn(
      `replays index cache discarded: ${parsed.error.issues[0]?.message ?? 'malformed cache file'}`,
    )
    return null
  }
  return parsed.data
}

export interface ReplaysIndexCacheOptions {
  /** Defaults to `replaysIndexCacheFilePath()`; a parameter so the tests write to a temp directory. */
  filePath?: string
  log?: ReplaysIndexCacheLog
}

/**
 * The replays index cache. `JsonStore` serialises its own writes, so two scans cannot interleave
 * on the file.
 */
export class ReplaysIndexCache {
  private readonly store: JsonStore<CacheDocument>

  constructor(options: ReplaysIndexCacheOptions = {}) {
    const log = options.log
    this.store = new JsonStore<CacheDocument>({
      filePath: options.filePath ?? replaysIndexCacheFilePath(),
      defaults: () => null,
      parse: (raw) => parseCacheDocument(raw, log),
    })
  }

  /** The cached entries, or an empty `Map` when there is nothing usable to read. Never rejects. */
  async read(): Promise<Map<string, CachedDemo>> {
    const document = await this.store.load()
    if (document === null) return new Map()
    return new Map(Object.entries(document.entries))
  }

  /** Persists `entries` and resolves once it has reached the disk. */
  async write(entries: Map<string, CachedDemo>): Promise<void> {
    this.store.set({
      cacheVersion: REPLAYS_INDEX_CACHE_VERSION,
      entries: Object.fromEntries(entries),
    })
    await this.store.settle()
  }

  /** Resolves once pending writes have reached the disk; `ok: false` if one failed. */
  settle(): Promise<{ ok: boolean }> {
    return this.store.settle()
  }
}
