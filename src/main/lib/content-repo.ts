/**
 * Transport helper for the curated download manifests published in the
 * public `Hantsch/q2_community_content` repository, served over the
 * raw.githubusercontent.com CDN.
 *
 * This is the ONLY place the launcher's download pipeline may hardcode that
 * repo's base URL — other modules (e.g. `manifest-service.ts`) must import
 * `CONTENT_REPO_RAW_BASE` or `contentRepoUrl()` rather than duplicating it.
 */

import { z } from 'zod'
import { fetchWithPolicy } from './http'
import { JsonStore } from './json-store'
import type { Logger } from './logger'

const MAX_MANIFEST_BYTES = 4 * 1024 * 1024

export const CONTENT_REPO_RAW_BASE =
  'https://raw.githubusercontent.com/Hantsch/q2_community_content/main'

/** Thrown by `fetchContentJson` when the response status is not 2xx. */
export class ContentRepoHttpError extends Error {
  public readonly status: number

  constructor(status: number, url: string) {
    super(`content repo request failed: ${status} ${url}`)
    this.name = 'ContentRepoHttpError'
    this.status = status
  }
}

/**
 * Joins `baseUrl` (`CONTENT_REPO_RAW_BASE` unless told otherwise) with `path`, avoiding a double
 * or missing slash.
 *
 * `baseUrl` is a parameter as of story 074, so the UI-verification harness can point manifest
 * traffic at its own `127.0.0.1` fixture server. It is **not** read from the environment here:
 * the only producer of a non-default value is `resolveDownloadSource()`
 * (`src/main/services/content/source.ts`), which is gated on `Q2L_UI_HARNESS === '1'` alone
 * and resolved once at module registration. This file has no opinion about that gate and no way to
 * open it - it just joins two strings.
 */
export function contentRepoUrl(path: string, baseUrl: string = CONTENT_REPO_RAW_BASE): string {
  const cleanPath = path.startsWith('/') ? path.slice(1) : path
  return `${baseUrl}/${cleanPath}`
}

export interface FetchContentJsonOptions {
  /** Abort timeout in milliseconds. Defaults to 10s. */
  timeoutMs?: number
  /** Base URL to fetch from; defaults to `CONTENT_REPO_RAW_BASE`. See `contentRepoUrl()`. */
  baseUrl?: string
}

/**
 * Fetches `path` from the content repo and parses the response as JSON.
 *
 * No retries, no mirror fallback: one request, one timeout, one 2xx check.
 * The result is raw, unvalidated JSON — callers are responsible for
 * validating it (see `src/main/services/content/manifest-parse.ts`).
 */
export async function fetchContentJson<T = unknown>(
  path: string,
  opts?: FetchContentJsonOptions,
): Promise<T> {
  const url = contentRepoUrl(path, opts?.baseUrl)
  const outcome = await fetchWithPolicy(url, {
    // Read `fetch` per call so a stubbed global is honoured.
    fetchImpl: (u, i) => fetch(u, i),
    timeoutMs: opts?.timeoutMs ?? 10_000,
    retries: 0,
    maxBytes: MAX_MANIFEST_BYTES,
  })
  if (!outcome.ok) {
    if (outcome.kind === 'http-status' && outcome.status !== undefined) {
      throw new ContentRepoHttpError(outcome.status, url)
    }
    throw new Error(`content repo request failed: ${outcome.reason} ${url}`)
  }
  return JSON.parse(new TextDecoder().decode(outcome.body)) as T
}

export interface CachedContentDocumentOptions<T extends object> {
  filePath: string
  /** How long a value this process fetched itself is served again without refetching. */
  freshnessMs: number
  /** Version of the cache file's own layout; a different version on disk discards the file. */
  cacheVersion: number
  /**
   * Validates the document body (everything but `cacheVersion`/`fetchedAt`) read off disk. A
   * failure discards the cache; the first issue's message is logged as the reason.
   */
  schema: z.ZodType<T, unknown>
  /** Names the document in log lines, e.g. "manifest". */
  label: string
  log: Logger
  /** One live attempt; rejects with an `Error` whose message is the reason it produced nothing. */
  fetch: () => Promise<T>
}

export type CachedContentResult<T> =
  | {
      status: 'ok'
      data: T
      fetchedAt: string
      ageMs: number
      /** True only when a live fetch failed and the persisted copy answered. */
      fromCache: boolean
      /** Why the live attempt failed; set exactly when `fromCache` is true. */
      fallbackReason?: string
    }
  | { status: 'unavailable'; reason: string }

const cacheEnvelopeSchema = z.object({ cacheVersion: z.number(), fetchedAt: z.string().min(1) })

/**
 * A remote JSON document with a fresh-in-memory window and a persisted last-good copy.
 *
 * Only a live fetch made by this instance counts as fresh; a value read off disk never does, or
 * the first `get()` after a restart would skip the refresh the user expects. The persisted copy
 * answers only when a live fetch failed. The file is the body's own fields next to
 * `cacheVersion` and `fetchedAt`.
 */
export class CachedContentDocument<T extends object> {
  private readonly options: CachedContentDocumentOptions<T>
  private readonly store: JsonStore<Record<string, unknown>>
  private loaded = false
  private fresh: { data: T; fetchedAt: string; fetchedAtMs: number } | null = null
  /** Mirrors the store: set by a live fetch and by `parseDocument`, the only disk validation. */
  private cached: { data: T; fetchedAt: string } | null = null

  constructor(options: CachedContentDocumentOptions<T>) {
    this.options = options
    // Nothing is read or fetched here; the store loads on the first `get()`.
    this.store = new JsonStore<Record<string, unknown>>({
      filePath: options.filePath,
      defaults: () => this.emptyDocument(),
      parse: (raw) => this.parseDocument(raw),
    })
  }

  async get(opts: { refresh?: boolean } = {}): Promise<CachedContentResult<T>> {
    if (opts.refresh !== true && this.fresh !== null) {
      const age = Date.now() - this.fresh.fetchedAtMs
      if (age >= 0 && age < this.options.freshnessMs) {
        return {
          status: 'ok',
          data: this.fresh.data,
          fetchedAt: this.fresh.fetchedAt,
          ageMs: age,
          fromCache: false,
        }
      }
    }

    if (!this.loaded) {
      await this.store.load()
      this.loaded = true
    }

    let reason: string
    try {
      const data = await this.options.fetch()
      const fetchedAt = new Date().toISOString()
      this.fresh = { data, fetchedAt, fetchedAtMs: Date.parse(fetchedAt) }
      this.cached = { data, fetchedAt }
      this.store.set({ cacheVersion: this.options.cacheVersion, fetchedAt, ...data })
      // `JsonStore` logs write failures itself; awaiting only makes "persisted" true on return.
      await this.store.settle()
      return { status: 'ok', data, fetchedAt, ageMs: 0, fromCache: false }
    } catch (error) {
      reason = error instanceof Error ? error.message : String(error)
    }

    if (this.cached !== null) {
      return {
        status: 'ok',
        data: this.cached.data,
        fetchedAt: this.cached.fetchedAt,
        // Clamped: a clock that moved backwards must not report a negative age.
        ageMs: Math.max(0, Date.now() - Date.parse(this.cached.fetchedAt)),
        fromCache: true,
        fallbackReason: reason,
      }
    }
    return { status: 'unavailable', reason }
  }

  /** Resolves once pending writes have reached the disk; `ok: false` if one failed. */
  settle(): Promise<{ ok: boolean }> {
    return this.store.settle()
  }

  private emptyDocument(): Record<string, unknown> {
    return { cacheVersion: this.options.cacheVersion, fetchedAt: null }
  }

  /** Never throws; anything not fully vouched for becomes "nothing cached". */
  private parseDocument(raw: unknown): Record<string, unknown> {
    const { label, log, cacheVersion } = this.options
    const discard = (why: string): Record<string, unknown> => {
      log.warn(`${label} cache discarded: ${why}`)
      this.cached = null
      return this.emptyDocument()
    }
    const envelope = cacheEnvelopeSchema.safeParse(raw)
    if (!envelope.success) return discard('malformed cache envelope')
    if (envelope.data.cacheVersion !== cacheVersion) {
      return discard(`cacheVersion ${envelope.data.cacheVersion} (expected ${cacheVersion})`)
    }
    if (Number.isNaN(Date.parse(envelope.data.fetchedAt))) {
      return discard('unreadable fetchedAt (its age could not be computed)')
    }
    const body = this.options.schema.safeParse(raw)
    if (!body.success) return discard(body.error.issues[0]?.message ?? 'invalid content')
    this.cached = { data: body.data, fetchedAt: envelope.data.fetchedAt }
    return { cacheVersion, fetchedAt: envelope.data.fetchedAt, ...body.data }
  }
}
