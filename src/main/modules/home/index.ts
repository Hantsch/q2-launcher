import { HOME_EVENTS, HOME_HANDLERS, newsNoInputSchema } from '@shared/modules/home'
import type { MainModule } from '../types'
import { createNewsService } from './news/news-service'

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

    // AC1: exactly one fetch happens on its own, right here at registration - fire-and-forget, so a
    // slow or unreachable content repo never delays the app finishing startup. `refreshNews()` is
    // designed to never reject (a failed/skipped fetch resolves with the cached feed instead), but
    // this `catch` is belt-and-suspenders against a bug turning that into an unhandled rejection.
    void newsService.refreshNews().catch((error: unknown) => {
      log.error('news: startup refresh failed unexpectedly', error)
    })

    log.debug('home module ready')
  },
}
