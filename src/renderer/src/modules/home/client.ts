import {
  HOME_EVENTS,
  HOME_HANDLERS,
  type HomeContract,
  type HomeLayout,
  type NewsFeed,
} from '@shared/modules/home'
import type { Outcome } from '@shared/types'
import { createModuleClient } from '../moduleClient'

const client = createModuleClient<HomeContract>('home')

/**
 * Typed client for the home module's community news feed (story 082). One
 * function per handler/event in its contract - mirrors `modules/library/client.ts`.
 *
 * No component, no store, no i18n string lives here: this is purely the typed
 * transport 083 builds its UI on top of.
 */
export function getNews(): Promise<Outcome<NewsFeed>> {
  return client.call(HOME_HANDLERS.newsGet)
}

export function refreshNews(): Promise<Outcome<NewsFeed>> {
  return client.call(HOME_HANDLERS.newsRefresh)
}

/**
 * Opens a slide button's `url` (story 083). Main re-checks the scheme and the host allowlist
 * itself (`main/modules/home/open-slide-url.ts`) - the renderer never decides whether a url is
 * allowed to open, it only ever passes it through this call.
 */
export function openSlideUrl(url: string): Promise<Outcome<null>> {
  return client.call(HOME_HANDLERS.openSlideUrl, url)
}

/**
 * Subscribes to the `news.changed` push - emitted only when a refresh
 * actually changed the delivered feed. The main process is the only validator
 * of this payload's shape (it is built from the already-validated `NewsFeed`
 * `news.get`/`news.refresh` resolve to); the renderer trusts it rather than
 * re-validating with zod, consistent with how `callModule`'s own `Outcome<T>`
 * results are trusted elsewhere in this client layer.
 */
export function onNewsChanged(listener: (feed: NewsFeed) => void): () => void {
  return client.on(HOME_EVENTS.newsChanged, listener)
}

/** Story 086: the persisted dashboard tile arrangement. */
export function getHomeLayout(): Promise<Outcome<HomeLayout>> {
  return client.call(HOME_HANDLERS.getLayout)
}

export function setHomeLayout(layout: HomeLayout): Promise<Outcome<HomeLayout>> {
  return client.call(HOME_HANDLERS.setLayout, layout)
}

export function resetHomeLayout(): Promise<Outcome<HomeLayout>> {
  return client.call(HOME_HANDLERS.resetLayout)
}
