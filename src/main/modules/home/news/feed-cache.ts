import { join } from 'node:path'
import { z } from 'zod'
import {
  isAllowedButtonHost,
  newsButtonSchema,
  type NewsSlide,
  type NewsTemplate,
} from '@shared/modules/home'
import { JsonStore } from '../../../lib/json-store'
import { userDataDir } from '../../../lib/paths'
import { MAX_BUTTONS_PER_SLIDE } from './feed-pipeline'

/**
 * Story 082 D5, second half: the feed's own file under `userData`.
 *
 * `news-feed.json`, its own file via `JsonStore` and deliberately **not** part of `state.json`
 * (Decisions (Sprint)): a regenerable cache of foreign content has no business next to the
 * installation list, and keeping it separate leaves `state.ts` and its schema untouched.
 *
 * It holds three things, and all three are needed together:
 *
 *  - `slides` - the validated slides of the last successfully retrieved feed. Not the raw
 *    documents: the pipeline has already had its say, so nothing unvalidated is ever read back in.
 *  - `etags` - one entry per document plus one for the index (`NEWS_INDEX_DOCUMENT`), which is what
 *    makes the next start's conditional GET possible at all. It belongs in the same file as the
 *    slides *because* the two must not drift: an ETag for a document that is not represented in
 *    `slides` would produce a `304`, a "nothing changed" verdict, and a slide that never comes back
 *    (see `feed-fetcher.ts`'s module comment).
 *  - `retrievedAt` - when that feed was last successfully retrieved, which is what 083 renders as
 *    the feed's age.
 *
 * ## A damaged file degrades to "no cache", never to an exception
 *
 * `read()` answers `undefined` when the file is missing, empty, unparseable JSON, from another
 * cache version, or does not satisfy the schema below. This is a file on disk: it can be
 * hand-edited, truncated by a full disk, or left over from an older launcher. "No cache" costs one
 * fetch; a throw on a cache read would break app start, which is precisely the path AC8 says must
 * stay quiet. `JsonStore` already sets an unparseable file aside as `<file>.corrupt-<n>` and falls
 * back to `<file>.bak`, so the degradation is not silent to a developer reading the log either.
 *
 * The buttons are re-checked against the host allowlist on the way back in, even though the
 * pipeline checked them on the way out. The pipeline's guarantee covers the network path; the file
 * is a second, independent input, and "nothing unvalidated reaches the renderer" has to hold for
 * both.
 */

/** Bumping this discards existing files instead of reading an older layout - a cache nobody would
 * miss is not worth a migration. */
export const NEWS_CACHE_VERSION = 1

export const NEWS_FEED_CACHE_FILE = 'news-feed.json'

/** `userData/news-feed.json`. */
export function newsFeedCacheFilePath(): string {
  return join(userDataDir(), NEWS_FEED_CACHE_FILE)
}

/** Structurally satisfied by `Logger` (`src/main/lib/logger.ts`). */
export interface NewsCacheLog {
  warn(message: string): void
}

/** What one successful retrieval leaves behind. Exactly the three fields above. */
export interface NewsFeedCacheData {
  /** Validated slides as `resolveFeed()` produced them (`feed-pipeline.ts`) - resolved, but never
   * visibility-filtered or `order`-sorted. Every delivery re-applies `filterAndSortSlides()` against
   * the current `now`, so a slide's visibility is decided fresh on every read of this cache, not once
   * at the time it was written. */
  slides: NewsSlide[]
  /** `NEWS_INDEX_DOCUMENT` plus one key per document; `''` means "known, but no ETag". */
  etags: Record<string, string>
  /** ISO timestamp of the retrieval these slides came from. */
  retrievedAt: string
}

/** The persisted document: the data plus the envelope version. `null` is "no cache". */
type NewsCacheDocument = (NewsFeedCacheData & { cacheVersion: number }) | null

const NEWS_TEMPLATES = ['split', 'banner', 'text'] as const satisfies readonly NewsTemplate[]

/**
 * The slide shape as it may come back off disk. Not `.strict()`: an extra field from a newer
 * launcher is ignored rather than allowed to discard the whole file. The button cap is *not* a
 * `.max()` here - a file with four buttons is trimmed below, not thrown away.
 */
const cachedSlideSchema = z.object({
  id: z.string().trim().min(1),
  template: z.enum(NEWS_TEMPLATES),
  order: z.number().finite(),
  title: z.string().min(1),
  body: z.string().min(1),
  image: z.string().min(1).optional(),
  buttons: z.array(newsButtonSchema),
  visibleFrom: z.string().optional(),
  visibleUntil: z.string().optional(),
})

const cacheDocumentSchema = z.object({
  cacheVersion: z.literal(NEWS_CACHE_VERSION),
  retrievedAt: z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
    message: 'retrievedAt is not a readable timestamp',
  }),
  slides: z.array(cachedSlideSchema),
  etags: z.record(z.string(), z.string()),
})

/**
 * `JsonStore`'s `parse`, which may never throw. Anything it cannot fully vouch for becomes `null`,
 * i.e. "no cache" - one wasted fetch instead of a feed built from junk.
 */
function parseCacheDocument(raw: unknown, log?: NewsCacheLog): NewsCacheDocument {
  const parsed = cacheDocumentSchema.safeParse(raw)
  if (!parsed.success) {
    log?.warn(`news cache discarded: ${parsed.error.issues[0]?.message ?? 'malformed cache file'}`)
    return null
  }

  const slides = parsed.data.slides.map((slide) => ({
    ...slide,
    // Filter then cap, exactly as the pipeline does (AC6): a slide carrying one off-allowlist URL
    // still delivers its remaining buttons.
    buttons: slide.buttons
      .filter((button) => isAllowedButtonHost(button.url))
      .slice(0, MAX_BUTTONS_PER_SLIDE),
  }))

  return {
    cacheVersion: NEWS_CACHE_VERSION,
    retrievedAt: parsed.data.retrievedAt,
    slides,
    etags: parsed.data.etags,
  }
}

export interface NewsFeedCacheOptions {
  /** Defaults to `newsFeedCacheFilePath()`; a parameter so the tests write to a temp directory. */
  filePath?: string
  log?: NewsCacheLog
}

/**
 * The feed cache. One instance per process (D6 owns it): `JsonStore` serialises its own writes, so
 * two refreshes cannot interleave on the file.
 */
export class NewsFeedCache {
  private readonly store: JsonStore<NewsCacheDocument>

  constructor(options: NewsFeedCacheOptions = {}) {
    const log = options.log
    this.store = new JsonStore<NewsCacheDocument>({
      filePath: options.filePath ?? newsFeedCacheFilePath(),
      defaults: () => null,
      parse: (raw) => parseCacheDocument(raw, log),
    })
  }

  /** The cached feed, or `undefined` when there is none to be had. Never rejects on a bad file. */
  async read(): Promise<NewsFeedCacheData | undefined> {
    const document = await this.store.load()
    if (document === null) return undefined
    const { cacheVersion: _cacheVersion, ...data } = document
    return data
  }

  /** Persists `data` and resolves once it has reached the disk. */
  async write(data: NewsFeedCacheData): Promise<void> {
    this.store.set({ cacheVersion: NEWS_CACHE_VERSION, ...data })
    await this.store.settle()
  }
}
