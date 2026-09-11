import {
  DEFAULT_HOME_LAYOUT,
  HOME_EVENTS,
  HOME_HANDLERS,
  homeLayoutNoInputSchema,
  newsNoInputSchema,
  openSlideUrlInputSchema,
  setLayoutInputSchema,
} from '@shared/modules/home'
import { parseHomeLayout } from '../../lib/schemas'
import type { MainModule } from '../types'
import { createNewsService } from './news/news-service'
import { openSlideUrl } from './open-slide-url'

/**
 * The home module - story 081 D1 registered it with nothing to add yet. Story 082 D6 gives it its
 * first handlers: `news.get`/`news.refresh`, backed by `news/news-service.ts`. Mirrors
 * `src/main/modules/library/index.ts`'s shape - `setup()` registers handlers and does nothing
 * else; all the news logic (fetch-or-not, cache, filter+sort, change detection) lives in the
 * service, which is what `news-service.test.ts` exercises directly.
 */
export const homeModule: MainModule = {
  id: 'home',

  setup({ handle, emit, app, log }) {
    const newsService = createNewsService({
      isDev: app.isDev,
      log,
      onChanged: (feed) => emit(HOME_EVENTS.newsChanged, feed),
    })

    handle(HOME_HANDLERS.newsGet, newsNoInputSchema, () => newsService.getNews())
    handle(HOME_HANDLERS.newsRefresh, newsNoInputSchema, () => newsService.refreshNews())
    handle(HOME_HANDLERS.openSlideUrl, openSlideUrlInputSchema, (url) => openSlideUrl(url, log))

    // Story 086 D1: `getLayout` returns the persisted layout verbatim - no failure mode, like
    // `downloads.getSettings`. `setLayout` re-validates the whole incoming layout through
    // `parseHomeLayout` before persisting it - the shared schema is deliberately permissive on
    // `moduleId`, so an unknown module is dropped here, server-side, rather than rejected at the
    // IPC boundary.
    handle(HOME_HANDLERS.getLayout, homeLayoutNoInputSchema, () => app.state.homeLayout())
    handle(HOME_HANDLERS.setLayout, setLayoutInputSchema, (layout) =>
      app.state.setHomeLayout(parseHomeLayout(layout)),
    )
    // Story 086 D1 review fix: clone `tiles` rather than passing `DEFAULT_HOME_LAYOUT` by
    // reference - it is a shared, module-level singleton, and this would otherwise let anything
    // that later mutated the persisted layout's `tiles` array in place corrupt the shipped default
    // too.
    handle(HOME_HANDLERS.resetLayout, homeLayoutNoInputSchema, () =>
      app.state.setHomeLayout({ tiles: DEFAULT_HOME_LAYOUT.tiles.map((tile) => ({ ...tile })) }),
    )

    // AC1: exactly one fetch happens on its own, right here at registration - fire-and-forget, so a
    // slow or unreachable content repo never delays the app finishing startup. Story 082 D4's
    // `resolveNewsSource()` (`news/harness.ts`) already decides whether that fetch is a no-op: under
    // the UI-verification harness with no loopback base configured (every registry-driven
    // `ui:verify` screen, and any `ui:flow` script that does not set one), it answers `'skip'` and
    // `refreshNews()` makes no network call at all - which is what keeps the three hero screens
    // (`home-hero`/`home-hero-welcome`/`home-hero-stale`) fed purely from the fixture's seeded cache.
    // A harness-gated launch that *does* name a loopback base (e.g. `scripts/flows/news-feed.mjs`)
    // must still fetch for real, so this call is never itself gated on `isUiHarnessEnabled` - doing
    // so would skip the fetch unconditionally under the harness, loopback base or not, and silently
    // starve any flow that relies on it. `refreshNews()` is designed to never reject (a failed/skipped
    // fetch resolves with the cached feed instead), but this `catch` is belt-and-suspenders against a
    // bug turning that into an unhandled rejection.
    void newsService.refreshNews().catch((error: unknown) => {
      log.error('news: startup refresh failed unexpectedly', error)
    })

    log.debug('home module ready')
  },
}
