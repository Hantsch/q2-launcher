import type { NewsFeed } from '@shared/modules/home'

/**
 * Story 083 D4: maps the delivered feed to one of three hero states.
 *
 * Pure and main-agnostic on purpose - `NewsHero` renders from this answer, `feedState.test.ts`
 * proves the mapping in isolation, and no DOM or i18n is involved here at all.
 *
 * - `'welcome'` - there is no cached feed at all. `slides` is the signal: an empty array is exactly
 *   what `news-service.ts`'s `deliver()` returns both for "never fetched" (the `NEVER_RETRIEVED`
 *   cold-start branch) and for a feed that genuinely resolved to zero visible slides, and in both
 *   cases the hero has nothing real to show - the built-in welcome slide is the only sensible
 *   choice regardless of `lastRefreshFailed`. Checked first, so a first-ever refresh that happens to
 *   fail can never be reported as `'stale'` (there is nothing to call stale yet).
 * - `'stale'` - there IS a cached feed (`slides` is non-empty), but the most recent refresh attempt
 *   failed. The feed itself is still shown; the hero adds an "as of <retrievedAt>" chip and a
 *   refresh button rather than a toast or dialog (Decisions (Sprint)).
 * - `'filled'` - a good, current feed. The carousel renders as normal, no chip.
 */
export type HeroFeedState = 'welcome' | 'stale' | 'filled'

/** Only the fields the mapping actually reads from `NewsFeed` - callers may pass the real feed
 * or a narrower stand-in (tests do both). */
export type FeedStateInput = Pick<NewsFeed, 'slides' | 'lastRefreshFailed'>

export function feedState(feed: FeedStateInput): HeroFeedState {
  if (feed.slides.length === 0) return 'welcome'
  if (feed.lastRefreshFailed) return 'stale'
  return 'filled'
}
