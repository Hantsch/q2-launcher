import { join } from 'node:path'
import { z } from 'zod'
import { fetchContentJson } from '../../lib/content-repo'
import { JsonStore } from '../../lib/json-store'
import type { Logger } from '../../lib/logger'
import { userDataDir } from '../../lib/paths'
import { PRODUCTION_DOWNLOAD_SOURCE, type DownloadSource } from '../downloads/harness'
import type { ModCatalogEntryParsed } from './catalog-schema'
import { parseModCatalog } from './catalog-parse'

/**
 * The mod catalog's stateful half, mirroring `downloads/manifest-service.ts`: fetch
 * `mods/manifest.json`, persist the last good copy, and serve it (with its real age) when a
 * fetch fails or the file is refused. A failure with nothing cached is `unavailable`, never an
 * empty catalog. A cache read off disk never counts as fresh; only this process's own fetch does.
 */

export const MODS_CATALOG_PATH = 'mods/manifest.json'
export const CATALOG_FRESHNESS_MS = 15 * 60 * 1000
export const CATALOG_CACHE_VERSION = 1

export function catalogCacheFilePath(): string {
  return join(userDataDir(), 'cache', 'mods', 'catalog-cache.json')
}

export type CatalogSnapshot =
  | {
      status: 'ok'
      entries: ModCatalogEntryParsed[]
      fetchedAt: string
      fromCache: boolean
      ageMs: number
    }
  | { status: 'unavailable' }

interface CatalogCacheDocument {
  cacheVersion: number
  fetchedAt: string | null
  entries: ModCatalogEntryParsed[]
}

const cacheEnvelopeSchema = z.object({
  cacheVersion: z.number(),
  fetchedAt: z.string().min(1),
  entries: z.array(z.unknown()),
})

function emptyCache(): CatalogCacheDocument {
  return { cacheVersion: CATALOG_CACHE_VERSION, fetchedAt: null, entries: [] }
}

/** Never throws; anything not fully vouched for becomes "nothing cached". */
function parseCacheDocument(raw: unknown, log: Logger, httpsOnly: boolean): CatalogCacheDocument {
  const envelope = cacheEnvelopeSchema.safeParse(raw)
  if (!envelope.success) {
    log.warn('mod catalog cache discarded: malformed cache envelope')
    return emptyCache()
  }
  if (envelope.data.cacheVersion !== CATALOG_CACHE_VERSION) {
    log.warn('mod catalog cache discarded: unexpected cacheVersion')
    return emptyCache()
  }
  if (Number.isNaN(Date.parse(envelope.data.fetchedAt))) {
    log.warn('mod catalog cache discarded: unreadable fetchedAt')
    return emptyCache()
  }
  const parsed = parseModCatalog(
    { schemaVersion: 1, entries: envelope.data.entries },
    log,
    { httpsOnly },
  )
  if (!parsed.ok) {
    log.warn(`mod catalog cache discarded: ${parsed.reason}`)
    return emptyCache()
  }
  return {
    cacheVersion: CATALOG_CACHE_VERSION,
    fetchedAt: envelope.data.fetchedAt,
    entries: parsed.entries,
  }
}

export interface CatalogServiceOptions {
  log: Logger
  /** Resolved once by the caller (`resolveDownloadSource()`); defaults to production. */
  source?: DownloadSource
}

export class CatalogService {
  private readonly log: Logger
  private readonly source: DownloadSource
  private readonly store: JsonStore<CatalogCacheDocument>
  private cacheLoaded = false
  private fresh: { entries: ModCatalogEntryParsed[]; fetchedAtMs: number; fetchedAt: string } | null =
    null

  constructor(options: CatalogServiceOptions) {
    this.log = options.log
    this.source = options.source ?? PRODUCTION_DOWNLOAD_SOURCE
    this.store = new JsonStore<CatalogCacheDocument>({
      filePath: catalogCacheFilePath(),
      defaults: emptyCache,
      parse: (raw) => parseCacheDocument(raw, this.log, this.source.httpsOnly),
    })
  }

  async getCatalog(options: { refresh?: boolean } = {}): Promise<CatalogSnapshot> {
    if (options.refresh !== true && this.fresh !== null) {
      const age = Date.now() - this.fresh.fetchedAtMs
      if (age >= 0 && age < CATALOG_FRESHNESS_MS) {
        return {
          status: 'ok',
          entries: this.fresh.entries,
          fetchedAt: this.fresh.fetchedAt,
          fromCache: false,
          ageMs: age,
        }
      }
    }

    if (!this.cacheLoaded) {
      await this.store.load()
      this.cacheLoaded = true
    }

    const attempt = await this.fetchOnce()
    if (attempt.ok) {
      const fetchedAt = new Date().toISOString()
      this.fresh = { entries: attempt.entries, fetchedAtMs: Date.parse(fetchedAt), fetchedAt }
      this.store.set({ cacheVersion: CATALOG_CACHE_VERSION, fetchedAt, entries: attempt.entries })
      await this.store.settle()
      return { status: 'ok', entries: attempt.entries, fetchedAt, fromCache: false, ageMs: 0 }
    }

    const cached = this.store.get()
    if (cached.fetchedAt !== null) {
      this.log.warn(`serving the cached mod catalog: ${attempt.reason}`)
      return {
        status: 'ok',
        entries: cached.entries,
        fetchedAt: cached.fetchedAt,
        fromCache: true,
        ageMs: Math.max(0, Date.now() - Date.parse(cached.fetchedAt)),
      }
    }
    this.log.error(`mod catalog unavailable and no cached copy exists: ${attempt.reason}`)
    return { status: 'unavailable' }
  }

  private async fetchOnce(): Promise<
    { ok: true; entries: ModCatalogEntryParsed[] } | { ok: false; reason: string }
  > {
    let raw: unknown
    try {
      raw = await fetchContentJson(MODS_CATALOG_PATH, { baseUrl: this.source.baseUrl })
    } catch (error) {
      this.log.warn(`fetching ${MODS_CATALOG_PATH} failed: ${String(error)}`)
      return { ok: false, reason: `fetching ${MODS_CATALOG_PATH} failed` }
    }
    const parsed = parseModCatalog(raw, this.log, { httpsOnly: this.source.httpsOnly })
    if (!parsed.ok) return { ok: false, reason: `${MODS_CATALOG_PATH} was refused (${parsed.reason})` }
    // A non-empty list whose every row was dropped is a broken file, not an empty catalog.
    const rawCount = Array.isArray((raw as { entries?: unknown } | null)?.entries)
      ? (raw as { entries: unknown[] }).entries.length
      : 0
    if (rawCount > 0 && parsed.entries.length === 0)
      return { ok: false, reason: `${MODS_CATALOG_PATH} was refused (every entry was invalid)` }
    return { ok: true, entries: parsed.entries }
  }
}
