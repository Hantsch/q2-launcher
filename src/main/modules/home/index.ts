import { HOME_EVENTS, HOME_HANDLERS, newsNoInputSchema, openSlideUrlInputSchema } from '@shared/modules/home'
import { isUiHarnessEnabled } from '../../lib/ui-harness'
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

    // Story 083 D6: under the UI-verification harness, the three hero screens (`home-hero` /
    // `home-hero-welcome` / `home-hero-stale`) must be fed purely by the fixture's seeded cache,
    // never by a live fetch attempt of any kind - `resolveNewsSource()` (`news/harness.ts`) already
    // answers `'skip'` for this call whenever no loopback base is configured (true for every
    // registry-driven `ui:verify`/`ui:flow` launch), but skipping the call itself, gated exactly
    // like `DialogService`'s stub (`isUiHarnessEnabled`, `src/main/lib/ui-harness.ts`), is what makes
    // that a guarantee rather than a side effect of `resolveNewsSource()`'s own fallback - and avoids
    // the on-disk cache read racing the renderer's own first `getNews()` for no benefit under a run
    // that can never usefully change the result.
    if (!isUiHarnessEnabled({ isDev: app.isDev })) {
      // AC1: exactly one fetch happens on its own, right here at registration - fire-and-forget, so a
      // slow or unreachable content repo never delays the app finishing startup. `refreshNews()` is
      // designed to never reject (a failed/skipped fetch resolves with the cached feed instead), but
      // this `catch` is belt-and-suspenders against a bug turning that into an unhandled rejection.
      void newsService.refreshNews().catch((error: unknown) => {
        log.error('news: startup refresh failed unexpectedly', error)
      })
    }

    log.debug('home module ready')
  },
}
