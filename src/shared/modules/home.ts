import { z } from 'zod'

/**
 * The home module's contract.
 *
 * Each module owns one file under `src/shared/modules/` describing the data it
 * exchanges with the UI. Main implements the handlers, the renderer gets a typed
 * client, and neither side imports the other's code - this file is the only
 * thing they share. Same pattern as `library.ts`/`downloads.ts`.
 *
 * Story 082 D1 adds only the `news/` half of this contract: the shapes and
 * per-template content schemas the community news feed is built from. No
 * handler is implemented here - `news.get`/`news.refresh` (D6) and the
 * `news.changed` push (D6/D7) are later deliverables. There is no new
 * top-level IPC channel: the feed rides the shell's existing `module:invoke`/
 * `module:event` seam under the `home` module's own namespace, exactly like
 * `library`, `config` and `downloads` already do (Decisions (Sprint)).
 */
export const HOME_HANDLERS = {
  /** Story 082 D6: resolves to the current `NewsFeed` - cache-first, no network of its own. */
  newsGet: 'news.get',
  /** Story 082 D6: re-fetches the feed; on failure resolves to the last cached `NewsFeed` instead
   * of rejecting (Decisions (Sprint): a failed fetch is silent, never a dialog or a toast). */
  newsRefresh: 'news.refresh',
  /** Story 083 D5: opens a slide button's `url` through `shell.openExternal`, but only after
   * checking it is `http(s)` and its host is on `NEWS_BUTTON_HOST_ALLOWLIST` - a feed URL is
   * foreign content, so it gets its own handler rather than reusing `app:openExternal` (which only
   * checks the scheme). Resolves to a refusal `Outcome` rather than throwing when either check
   * fails. */
  openSlideUrl: 'slide.openUrl',
} as const

/**
 * Main-to-renderer push under the `home` module's namespace. Emitted only when a refresh actually
 * changed the delivered feed (D6) - a `304`-everywhere refresh emits nothing.
 */
export const HOME_EVENTS = {
  newsChanged: 'news.changed',
} as const

/**
 * `news.get`/`news.refresh` both take no payload - the feed is not parameterised by the caller.
 * Kept as one named schema (mirrors `downloadsNoInputSchema`,
 * `src/main/modules/downloads/schemas.ts`) so both handlers share the exact same schema instance.
 */
export const newsNoInputSchema = z.void()

/**
 * `openSlideUrl`'s payload (story 083 D5): a plain string. The schema only settles the shape - a
 * renderer-supplied string is a `string`, bounded in length - the scheme and host allowlist checks
 * happen in the handler itself (`main/modules/home/open-slide-url.ts`), same division of labour as
 * `app:revealPath`'s path allowlist.
 */
export const openSlideUrlInputSchema = z.string().min(1).max(2000)

/**
 * Every `home` handler paired with its payload schema - proves AC9's "every new channel exists in
 * the shared contract with a zod payload schema before its handler" for this module's own
 * handlers, and is what `home.test.ts` iterates to check no handler is missing one.
 */
export const NEWS_HANDLER_SCHEMAS: Record<(typeof HOME_HANDLERS)[keyof typeof HOME_HANDLERS], z.ZodTypeAny> = {
  [HOME_HANDLERS.newsGet]: newsNoInputSchema,
  [HOME_HANDLERS.newsRefresh]: newsNoInputSchema,
  [HOME_HANDLERS.openSlideUrl]: openSlideUrlInputSchema,
}

/**
 * Fetched-feed schema version this launcher understands. Compared against a fetched feed's own
 * `schemaVersion` (D3/D5): a feed from a newer version is still used - an older launcher ignores
 * whatever it doesn't recognise - it just sets `NewsFeed.schemaAhead` so the renderer can show a
 * subtle note (083's scope; Decisions (Sprint)).
 */
export const NEWS_SCHEMA_VERSION = 1

/** The three slide layouts a news entry's frontmatter can select (AC5). */
export type NewsTemplate = 'split' | 'banner' | 'text'

/**
 * One call to action on a slide. `url` is checked for well-formedness here; whether its host is
 * actually on `NEWS_BUTTON_HOST_ALLOWLIST` is D3's job at parse time, not this shape's.
 */
export interface NewsButton {
  label: string
  url: string
}

export const newsButtonSchema = z
  .object({
    label: z.string().min(1),
    url: z.string().url(),
  })
  .strict()

/**
 * One slide of the feed, as `news.get`/`news.refresh` deliver it to the renderer - already
 * validated, template-resolved and button-capped (D3). `image` is carried through as the declared
 * relative path only; downloading and serving it is story 084's scope (Decisions (Sprint)).
 */
export interface NewsSlide {
  id: string
  template: NewsTemplate
  /** Ascending sort key (AC4). Equal values keep the source order (stable sort) - a duplicate
   * `order` is a cosmetic mistake, not a nondeterministic feed. */
  order: number
  title: string
  body: string
  image?: string
  /** Capped at 3 by the pipeline (D3, AC6); the type itself only bounds it loosely since real
   * enforcement happens against content arriving from the network, not against this delivered
   * shape. */
  buttons: NewsButton[]
  /** ISO date strings carried through from the frontmatter, or `undefined` for "no bound on this
   * side" (missing field, or a malformed date - see `feed-pipeline.ts`'s `parseBound()`). Kept on
   * the delivered shape - rather than consumed and discarded at build time - so the cache can store
   * "validated-but-unfiltered" slides and every delivery can re-apply the visibility window against
   * the current time (Decisions (Sprint), AC3). */
  visibleFrom?: string
  visibleUntil?: string
}

/**
 * What `news.get`/`news.refresh` resolve to. `retrievedAt` is when this feed was last
 * successfully retrieved (AC7's "states when it was retrieved" - rendered by 083); it does not
 * change on a `304` reuse-everything refresh beyond being the same cached value, and is not
 * touched at all by a failed refresh.
 */
export interface NewsFeed {
  slides: NewsSlide[]
  /** ISO timestamp of the last successful retrieval (fetch, or a fetch that reused the cache via
   * conditional GET) that produced these slides. */
  retrievedAt: string
  /** True when a fetched feed's own `schemaVersion` is newer than `NEWS_SCHEMA_VERSION` - this
   * launcher understood only part of what it received. */
  schemaAhead: boolean
  /** True when the most recent `news.refresh` attempt failed (network error, timeout, bad
   * response) and this feed is therefore the last-known-good one rather than a fresh retrieval
   * (story 083 D4). Never true for a feed that has never been fetched at all - `feedState.ts`
   * checks `slides` for that case first. Reset to `false` by the next successful refresh. */
  lastRefreshFailed: boolean
}

/**
 * Fields shared by every template's raw frontmatter content, before per-template rules narrow it
 * further. Not exported: each template's own schema below is what D3 actually validates against.
 */
const newsContentBaseShape = {
  title: z.string().min(1),
  body: z.string().min(1),
  buttons: z.array(newsButtonSchema).max(3).optional(),
}

/**
 * `split` template: a title/body pane alongside an image. `image` is expected but the field
 * itself is optional here - a missing image is what makes D3 fall back an entry to `text` (AC5),
 * not something this schema rejects outright.
 */
export const newsSplitContentSchema = z
  .object({
    ...newsContentBaseShape,
    image: z.string().min(1).optional(),
  })
  .strict()

/** `banner` template: a full-width title/body strip, optionally backed by an image. */
export const newsBannerContentSchema = z
  .object({
    ...newsContentBaseShape,
    image: z.string().min(1).optional(),
  })
  .strict()

/** `text` template: title and body only - the fallback shape for an unknown template value or a
 * `split`/`banner` entry missing its image, as long as title and body exist (AC5). */
export const newsTextContentSchema = z
  .object({
    ...newsContentBaseShape,
  })
  .strict()

/**
 * The community content repo's own hosts - the only places a news button's `url` may point to
 * (AC6). Fixed, not user-configurable (Decisions (Sprint)): exact host match, https only
 * (`isAllowedButtonHost` below), no subdomain or path wildcards.
 */
export const NEWS_BUTTON_HOST_ALLOWLIST = ['github.com', 'raw.githubusercontent.com'] as const

/**
 * Whether `url` is `https:` and its host is exactly one of `NEWS_BUTTON_HOST_ALLOWLIST` - no
 * subdomain match, no path allowance beyond the host check itself. Used by D3 to drop an
 * off-allowlist button (AC6); returns `false` for anything that fails to parse as a URL rather
 * than throwing.
 */
export function isAllowedButtonHost(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  return (
    parsed.protocol === 'https:' &&
    (NEWS_BUTTON_HOST_ALLOWLIST as readonly string[]).includes(parsed.hostname)
  )
}
