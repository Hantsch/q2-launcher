import { join } from 'node:path'
import { z } from 'zod'
import { CachedContentDocument, fetchContentJson } from '../../lib/content-repo'
import type { Logger } from '../../lib/logger'
import { userDataDir } from '../../lib/paths'
import { PRODUCTION_DOWNLOAD_SOURCE, type DownloadSource } from '../../services/content/source'
import type { ModCatalogEntryParsed } from './catalog-schema'
import { parseModCatalog } from './catalog-parse'

/**
 * The mod catalog's stateful half, mirroring `services/content/manifest-service.ts`: fetch
 * `mods/manifest.json`, persist the last good copy, and serve it (with its real age) when a
 * fetch fails or the file is refused. A failure with nothing cached is `unavailable`, never an
 * empty catalog. The freshness/cache rules live in `CachedContentDocument`.
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

/** The catalog document's body as persisted next to `cacheVersion`/`fetchedAt`. */
interface CatalogBody {
  entries: ModCatalogEntryParsed[]
}

export interface CatalogServiceOptions {
  log: Logger
  /** Resolved once by the caller (`resolveDownloadSource()`); defaults to production. */
  source?: DownloadSource
}

export class CatalogService {
  private readonly log: Logger
  private readonly source: DownloadSource
  private readonly document: CachedContentDocument<CatalogBody>

  constructor(options: CatalogServiceOptions) {
    this.log = options.log
    this.source = options.source ?? PRODUCTION_DOWNLOAD_SOURCE
    this.document = new CachedContentDocument<CatalogBody>({
      filePath: catalogCacheFilePath(),
      freshnessMs: CATALOG_FRESHNESS_MS,
      cacheVersion: CATALOG_CACHE_VERSION,
      label: 'mod catalog',
      log: this.log,
      // Rows are re-validated with the network path's own parser and URL rule.
      schema: z.object({ entries: z.array(z.unknown()) }).transform((body, ctx): CatalogBody => {
        const parsed = parseModCatalog({ schemaVersion: 1, entries: body.entries }, this.log, {
          httpsOnly: this.source.httpsOnly,
        })
        if (!parsed.ok) {
          ctx.addIssue({ code: 'custom', message: parsed.reason })
          return z.NEVER
        }
        return { entries: parsed.entries }
      }),
      fetch: async () => ({ entries: await this.fetchEntries() }),
    })
  }

  async getCatalog(options: { refresh?: boolean } = {}): Promise<CatalogSnapshot> {
    const result = await this.document.get(options)
    if (result.status === 'unavailable') {
      this.log.error(`mod catalog unavailable and no cached copy exists: ${result.reason}`)
      return { status: 'unavailable' }
    }
    if (result.fromCache) {
      this.log.warn(`serving the cached mod catalog: ${result.fallbackReason}`)
    }
    return {
      status: 'ok',
      entries: result.data.entries,
      fetchedAt: result.fetchedAt,
      fromCache: result.fromCache,
      ageMs: result.ageMs,
    }
  }

  /** Rejects with the reason no catalog came out of this attempt. */
  private async fetchEntries(): Promise<ModCatalogEntryParsed[]> {
    let raw: unknown
    try {
      raw = await fetchContentJson(MODS_CATALOG_PATH, { baseUrl: this.source.baseUrl })
    } catch (error) {
      this.log.warn(`fetching ${MODS_CATALOG_PATH} failed: ${String(error)}`)
      throw new Error(`fetching ${MODS_CATALOG_PATH} failed`)
    }
    const parsed = parseModCatalog(raw, this.log, { httpsOnly: this.source.httpsOnly })
    if (!parsed.ok) throw new Error(`${MODS_CATALOG_PATH} was refused (${parsed.reason})`)
    // A non-empty list whose every row was dropped is a broken file, not an empty catalog.
    const rawCount = Array.isArray((raw as { entries?: unknown } | null)?.entries)
      ? (raw as { entries: unknown[] }).entries.length
      : 0
    if (rawCount > 0 && parsed.entries.length === 0) {
      throw new Error(`${MODS_CATALOG_PATH} was refused (every entry was invalid)`)
    }
    return parsed.entries
  }

  /** Resolves once pending writes have reached the disk; `ok: false` if one failed. */
  settle(): Promise<{ ok: boolean }> {
    return this.document.settle()
  }
}
