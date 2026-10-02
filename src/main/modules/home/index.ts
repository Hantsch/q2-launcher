import { ok } from '@shared/types'
import { defineModule } from '../define-module'
import {
  HOME_EVENTS,
  HOME_HANDLERS,
  HOME_HANDLER_SCHEMAS,
  type HomeContract,
} from '@shared/modules/home'
import type { MainModule } from '../types'
import { createNewsService } from './news/news-service'
import { openSlideUrl } from './open-slide-url'
import { defaultHomeLayout, homeState, parseHomeLayout } from './persisted'

/**
 * The home module - story 081 D1 registered it with nothing to add yet. Story 082 D6 gives it its
 * first handlers: `news.get`/`news.refresh`, backed by `news/news-service.ts`. Mirrors
 * `src/main/modules/library/index.ts`'s shape - `setup()` registers handlers and does nothing
 * else; all the news logic (fetch-or-not, cache, filter+sort, change detection) lives in the
 * service, which is what `news-service.test.ts` exercises directly.
 */
export const homeModule: MainModule = {
  id: 'home',

  setup(setup) {
    const { app, log } = setup
    const layout = homeState(app.state)
    const { handle, emit } = defineModule<HomeContract>('home', HOME_HANDLER_SCHEMAS).bind(setup)
    const newsService = createNewsService({
      harness: app.harness,
      persistence: app.persistence,
      log,
      onChanged: (feed) => emit(HOME_EVENTS.newsChanged, feed),
    })

    handle(HOME_HANDLERS.newsGet, async () => ok(await newsService.getNews()))
    handle(HOME_HANDLERS.newsRefresh, async () => ok(await newsService.refreshNews()))
    handle(HOME_HANDLERS.openSlideUrl, (url) => openSlideUrl(url, app.os.openExternal, log))

    // Story 086 D1: `getLayout` returns the persisted layout verbatim - no failure mode, like
    // `downloads.getSettings`. `setLayout` re-validates the whole incoming layout through
    // `parseHomeLayout` before persisting it - the shared schema is deliberately permissive on
    // `moduleId`, so an unknown module is dropped here, server-side, rather than rejected at the
    // IPC boundary.
    handle(HOME_HANDLERS.getLayout, () => ok(layout.get()))
    handle(HOME_HANDLERS.setLayout, (incoming) =>
      ok(layout.update(() => parseHomeLayout(incoming))),
    )
    handle(HOME_HANDLERS.resetLayout, () => ok(layout.update(() => defaultHomeLayout())))

    // AC1: exactly one fetch happens on its own, right here at registration - fire-and-forget, so a
    // slow or unreachable content repo never delays the app finishing startup. Story 082 D4's
    // `resolveNewsSource()` (`news/harness.ts`) already decides whether that fetch is a no-op: under
    // the UI-verification harness with no loopback base configured (every registry-driven
    // `ui:verify` screen, and any `ui:flow` script that does not set one), it answers `'skip'` and
    // `refreshNews()` makes no network call at all - which is what keeps the three hero screens
    // (`home-hero`/`home-hero-welcome`/`home-hero-stale`) fed purely from the fixture's seeded cache.
    // A harness-gated launch that *does* name a loopback base (e.g. `scripts/flows/news-feed.mjs`)
    // must still fetch for real, so this call is never itself gated on the harness - doing
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
