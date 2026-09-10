import { HOME_EVENTS, HOME_HANDLERS, type NewsFeed } from '@shared/modules/home'
import type { Outcome } from '@shared/types'
import { callModule, onModuleEvent } from '../moduleClient'

/**
 * Typed client for the home module's community news feed (story 082 D7). One
 * function per handler/event in its contract - mirrors `modules/library/client.ts`.
 *
 * No component, no store, no i18n string lives here: this is purely the typed
 * transport 083 builds its UI on top of.
 */
export function getNews(): Promise<Outcome<NewsFeed>> {
  return callModule<NewsFeed>('home', HOME_HANDLERS.newsGet)
}

export function refreshNews(): Promise<Outcome<NewsFeed>> {
  return callModule<NewsFeed>('home', HOME_HANDLERS.newsRefresh)
}

/**
 * Opens a slide button's `url` (story 083 D5). Main re-checks the scheme and the host allowlist
 * itself (`main/modules/home/open-slide-url.ts`) - the renderer never decides whether a url is
 * allowed to open, it only ever passes it through this call.
 *
 * The main handler already returns its own `Outcome<null>` (success or a refusal such as
 * `home.error.urlNotAllowed`), so a raw `callModule` call here would yield
 * `Outcome<Outcome<null>>`. This flattens that one level, same as
 * `assignConfigProfile`/`unassignConfigProfile`/`setDefaultConfigProfile` in
 * `modules/config/client.ts`, so a refusal actually reaches the caller as `{ ok: false, ... }`.
 */
export async function openSlideUrl(url: string): Promise<Outcome<null>> {
  const result = await callModule<Outcome<null>>('home', HOME_HANDLERS.openSlideUrl, url)
  return result.ok ? result.value : result
}

/**
 * Subscribes to the `news.changed` push (D6) - emitted only when a refresh
 * actually changed the delivered feed. The main process is the only validator
 * of this payload's shape (it is built from the already-validated `NewsFeed`
 * `news.get`/`news.refresh` resolve to); the renderer trusts it rather than
 * re-validating with zod, consistent with how `callModule`'s own `Outcome<T>`
 * results are trusted elsewhere in this client layer.
 */
export function onNewsChanged(listener: (feed: NewsFeed) => void): () => void {
  return onModuleEvent<NewsFeed>('home', HOME_EVENTS.newsChanged, listener)
}
