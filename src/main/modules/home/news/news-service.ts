import type { NewsFeed, NewsSlide } from '@shared/modules/home'
import type { UiHarnessGateInput } from '../../../lib/ui-harness'
import { resolveNewsSource } from './harness'
import { filterAndSortSlides, resolveFeed } from './feed-pipeline'
import {
  fetchNewsDocuments,
  type NewsFetchImpl,
  type NewsFetchLog,
} from './feed-fetcher'
import { NewsFeedCache, type NewsFeedCacheData } from './feed-cache'

/**
 * Story 082 D6: the module's own service - the only thing in `home` that decides *when* the news
 * feed is fetched and *what* the renderer is handed back. `news-service.test.ts` "only start and
 * refresh trigger a fetch" is the acceptance test for the sentence that matters most here: there is
 * no timer and no focus hook anywhere in this file. The only two callers of `refreshNews()` are
 * `src/main/modules/home/index.ts`'s one fire-and-forget call at registration, and the
 * `news.refresh` handler answering a renderer-triggered call.
 *
 * ## Delivery-time filter+sort
 *
 * The story's Decision is that the cache stores validated-but-unfiltered slides, and that the
 * visibility filter and the `order` sort both run again on every delivery, using the *current*
 * `now` - so a three-day-old cache read back later ages correctly instead of showing a stale
 * verdict from the day it was fetched. The `changed` branch of `refreshNews()` below builds what
 * gets cached with `resolveFeed()` (`feed-pipeline.ts`), not `buildFeed()`: `resolveFeed()` never
 * filters by visibility, so an entry whose `visibleFrom` is still in the future at fetch time is
 * still persisted, rather than dropped before it is ever cached. `deliverSlides()` then calls
 * `filterAndSortSlides()` - the same function `buildFeed()` composes internally - on every
 * `getNews()`/`refreshNews()` delivery, so a slide ages in or out of view purely from the cached data
 * and the current `now`, never from whether a fetch happened to run recently.
 *
 * `schemaAhead` has the same shape of gap: `NewsFeedCacheData` (D5, merged) does not persist it, so
 * a cold start that only has the on-disk cache (no in-memory state yet) cannot know whether the
 * feed that produced it was schema-ahead - this service defaults that case to `false` rather than
 * guessing. Once a refresh has run in this process, the in-memory state carries the real flag.
 */

/** Structurally satisfied by `Logger` (`src/main/lib/logger.ts`); kept minimal for the tests. */
export type NewsServiceLog = NewsFetchLog

/** In-memory state kept between calls - what the cache holds, plus the two fields it does not
 * persist (see the module comment). Neither `schemaAhead` nor `lastRefreshFailed` survives a
 * restart: both describe the *last refresh attempt in this process*, not a property of the cached
 * slides themselves. */
interface NewsServiceState extends NewsFeedCacheData {
  schemaAhead: boolean
  /** Story 083 D4: true once a refresh attempt has failed against an existing feed, until the next
   * successful refresh clears it. See `deliver()`/`refreshNews()`'s `'failed'` branch below. */
  lastRefreshFailed: boolean
}

/** "Never successfully retrieved" sentinel for the cold-start-with-nothing-cached case, so
 * `NewsFeed.retrievedAt` (which the type requires as a string) does not have to lie about a
 * retrieval that never happened. */
const NEVER_RETRIEVED = new Date(0).toISOString()

export interface NewsServiceOptions {
  /** `AppContext.isDev` - see `resolveNewsSource()`/`isUiHarnessEnabled()`. */
  isDev: boolean
  /** Defaults to `process.env`; a parameter so tests never touch the real one. */
  env?: NodeJS.ProcessEnv
  log: NewsServiceLog
  /** Called only when a refresh delivers a feed whose content differs from what was last
   * delivered (AC9). Never called for an `unchanged` fetch result, a `failed`/`skipped` one, or a
   * `changed` one that happens to rebuild to identical content. */
  onChanged: (feed: NewsFeed) => void
  /** Injection seams for the tests below; all default to the real implementations. Typed as the
   * narrow `read`/`write` shape rather than the concrete class, so a test double needs no `store`
   * field. */
  cache?: Pick<NewsFeedCache, 'read' | 'write'>
  fetchImpl?: NewsFetchImpl
  fetchDocuments?: typeof fetchNewsDocuments
  now?: () => Date
  timeoutMs?: number
  retries?: number
}

export interface NewsService {
  /** Resolves to the current feed without fetching - in-memory state if a refresh has already run
   * in this process, otherwise the on-disk cache, otherwise an empty feed. Never throws. */
  getNews(): Promise<NewsFeed>
  /** Re-fetches the feed. Never throws and never rejects: a failed or skipped fetch resolves with
   * the last-known-good feed, with its original `retrievedAt` left untouched (AC7/AC8). */
  refreshNews(): Promise<NewsFeed>
}

/** AC3 + AC4, re-applied on every delivery per the Decision quoted in the module comment: filters
 * by visibility window against `deliveredAt`, then sorts by `order` ascending. */
function deliverSlides(slides: NewsSlide[], deliveredAt: Date): NewsSlide[] {
  return filterAndSortSlides(slides, deliveredAt)
}

function deliver(state: NewsServiceState | undefined, deliveredAt: Date): NewsFeed {
  if (!state) {
    return { slides: [], retrievedAt: NEVER_RETRIEVED, schemaAhead: false, lastRefreshFailed: false }
  }
  return {
    slides: deliverSlides(state.slides, deliveredAt),
    retrievedAt: state.retrievedAt,
    schemaAhead: state.schemaAhead,
    lastRefreshFailed: state.lastRefreshFailed,
  }
}

/** Whether two states would be delivered with different content - ignores `retrievedAt`, which is
 * exactly the field a same-content refresh is allowed to change without anyone being told (AC9:
 * "an identical one does not" emit). Compared at the same `deliveredAt` so a visibility-window
 * difference between the two calls can never masquerade as a content change. */
function sameContent(
  a: NewsServiceState | undefined,
  b: NewsServiceState | undefined,
  deliveredAt: Date,
): boolean {
  const contentOf = (state: NewsServiceState | undefined): string =>
    JSON.stringify({
      slides: state ? deliverSlides(state.slides, deliveredAt) : [],
      schemaAhead: state?.schemaAhead ?? false,
    })
  return contentOf(a) === contentOf(b)
}

export function createNewsService(options: NewsServiceOptions): NewsService {
  const fetchDocuments = options.fetchDocuments ?? fetchNewsDocuments
  const now = options.now ?? (() => new Date())

  // The real `NewsFeedCache` resolves `userData/news-feed.json` through Electron's `app.getPath()`
  // (`newsFeedCacheFilePath()`), which is only safe to call once Electron itself is ready.
  // `createNewsService()` runs synchronously inside `MainModule.setup()` (`home/index.ts`), so
  // building it here - rather than lazily, on first actual use below - would make constructing the
  // service itself capable of throwing before a single handler is registered. Deferred instead: the
  // first `read()`/`write()` call is always reached from inside an already-`async` function
  // (`ensureLoaded()`/`refreshNews()`), so a failure there rejects a promise instead of throwing out
  // of `setup()`.
  let cacheInstance: Pick<NewsFeedCache, 'read' | 'write'> | undefined
  function cache(): Pick<NewsFeedCache, 'read' | 'write'> {
    if (options.cache !== undefined) return options.cache
    cacheInstance ??= new NewsFeedCache({ log: options.log })
    return cacheInstance
  }

  let state: NewsServiceState | undefined
  let loadedFromDisk = false

  /** Lazily reads the on-disk cache exactly once - the only reason `getNews()`/`refreshNews()`
   * ever touch the filesystem when nothing has refreshed yet in this process. */
  async function ensureLoaded(): Promise<NewsServiceState | undefined> {
    if (loadedFromDisk) return state
    loadedFromDisk = true
    if (state !== undefined) return state
    const cached = await cache().read()
    if (cached !== undefined) {
      // Cold start from disk only: no way to know the retrieval's schemaAhead flag (see the module
      // comment) - it defaults to `false` until a refresh in this process learns the real value. A
      // cache file a running app writes on its own only ever holds a feed from a *successful*
      // retrieval (`NewsFeedCache.write()` is never called after a failure), so `false` is also the
      // accurate answer there, not just a safe guess. `lastRefreshFailed` is different: story 083 D6
      // lets a cache file carry it explicitly (defaulting to `false` when absent, `feed-cache.ts`) so
      // a harness-seeded, already-aged-and-failed fixture can be told apart from a normal cache with
      // no in-process refresh required to prove it.
      state = { ...cached, schemaAhead: false, lastRefreshFailed: cached.lastRefreshFailed ?? false }
    }
    return state
  }

  function gateInput(): UiHarnessGateInput {
    return { isDev: options.isDev, ...(options.env !== undefined ? { env: options.env } : {}) }
  }

  async function getNews(): Promise<NewsFeed> {
    const current = await ensureLoaded()
    return deliver(current, now())
  }

  async function refreshNews(): Promise<NewsFeed> {
    const before = await ensureLoaded()
    const source = resolveNewsSource(gateInput())

    if (source.kind === 'skip') {
      // AC10/D4: no request at all when the harness gate is open but names no fixture base.
      return deliver(before, now())
    }

    const result = await fetchDocuments({
      source,
      etags: before?.etags ?? {},
      ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      ...(options.retries !== undefined ? { retries: options.retries } : {}),
      log: options.log,
    })

    if (result.kind === 'skipped') {
      return deliver(before, now())
    }

    if (result.kind === 'failed') {
      // AC7/AC8: keep serving the last-known-good feed with its ORIGINAL retrievedAt - a failed
      // refresh must not look fresher, or staler, than it actually is. Never throws.
      options.log.warn(`news: refresh failed (${result.reason}); serving the cached feed`)
      // Story 083 D4: mark the in-memory state so the renderer can show a "stale" chip instead of
      // silently pretending this refresh succeeded. Only meaningful when there is an existing feed
      // to call stale in the first place - `deliver(undefined, ...)` already answers `false`.
      if (before !== undefined) state = { ...before, lastRefreshFailed: true }
      return deliver(state, now())
    }

    if (result.kind === 'unchanged') {
      // Nothing to rebuild, but the retrieval itself succeeded - the feed's age resets even though
      // its content does not, which is why this never emits `news.changed`.
      const retrievedAt = now().toISOString()
      const next: NewsServiceState = {
        slides: before?.slides ?? [],
        etags: result.etags,
        retrievedAt,
        schemaAhead: before?.schemaAhead ?? false,
        lastRefreshFailed: false,
      }
      state = next
      await cache().write({ slides: next.slides, etags: next.etags, retrievedAt: next.retrievedAt })
      return deliver(next, now())
    }

    // result.kind === 'changed'
    for (const failure of result.failures) {
      options.log.warn(`news: document ${failure.file} could not be retrieved (${failure.reason})`)
    }

    const built = resolveFeed({ index: result.index, documents: result.documents })
    for (const warning of built.warnings) {
      const location = [warning.id, warning.file].filter(Boolean).join('/')
      options.log.warn(`news: ${warning.reason}${location ? ` (${location})` : ''}`)
    }

    const retrievedAt = now().toISOString()
    const next: NewsServiceState = {
      slides: built.slides,
      etags: result.etags,
      retrievedAt,
      schemaAhead: built.schemaAhead,
      lastRefreshFailed: false,
    }

    const deliveredAt = now()
    const changed = !sameContent(before, next, deliveredAt)
    state = next
    await cache().write({ slides: next.slides, etags: next.etags, retrievedAt: next.retrievedAt })

    const delivered = deliver(next, deliveredAt)
    if (changed) options.onChanged(delivered)
    return delivered
  }

  return { getNews, refreshNews }
}
