// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createInstance, type i18n as I18nInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import type { NewsFeed } from '@shared/modules/home'
import type { Outcome } from '@shared/types'
import { initI18n } from '../../i18n'
import en from '../../i18n/locales/en.json'
import { HomeView } from './HomeView'

/**
 * Story 081 D2 (plus story 083 D4's fixup, see below). Three things are proven here:
 *
 * - AC1's renderer half - the `home` module really provides the view for `/home`,
 *   asserted against the *real* registry (mirrors `modules/index.test.ts`), because a
 *   mocked registry would hide exactly the registration this story is about.
 * - AC4 - nothing planned-module-shaped survived on the screen.
 * - AC6 - every string the screen shows is an i18n key that exists in `en.json`.
 *
 * D4 fixup: `HomeView` is now the feed's data-fetching boundary, so `./client` is stubbed here
 * (mirrors `DownloadsView.test.tsx`'s `vi.mock('./client', ...)`) rather than letting these tests
 * go through the real `window.q2` bridge.
 */

/** Default stub: an empty, "never fetched" feed - keeps the pre-existing assertions below (no
 * planned-module content, every visible string is an i18n key) unaffected by the D4 fixup, since
 * an empty feed renders only the built-in, i18n-sourced welcome slide. */
const emptyFeed: NewsFeed = {
  slides: [],
  retrievedAt: '2026-01-01T00:00:00.000Z',
  schemaAhead: false,
  lastRefreshFailed: false,
}

/** A feed with one real slide - used only by the test that proves `getNews()`'s result reaches
 * `NewsHero`. */
const filledFeed: NewsFeed = {
  slides: [
    {
      id: 'slide-1',
      template: 'text',
      order: 0,
      title: 'A slide',
      body: 'Body text',
      buttons: [],
    },
  ],
  retrievedAt: '2026-01-01T00:00:00.000Z',
  schemaAhead: false,
  lastRefreshFailed: false,
}

const getNews = vi.fn<() => Promise<Outcome<NewsFeed>>>(async () => ({ ok: true, value: emptyFeed }))
const refreshNews = vi.fn<() => Promise<Outcome<NewsFeed>>>(async () => ({
  ok: true,
  value: emptyFeed,
}))
const onNewsChanged = vi.fn<(listener: (feed: NewsFeed) => void) => () => void>(() => () => {})

vi.mock('./client', () => ({
  getNews: () => getNews(),
  refreshNews: () => refreshNews(),
  onNewsChanged: (listener: (feed: NewsFeed) => void) => onNewsChanged(listener),
}))

// `../index` pulls in the other modules' views -> the renderer store -> `lib/bridge.ts`, which
// resolves `window.q2` at *module* scope. This test only asserts on the registry, never on IPC
// traffic. Stubbed via `vi.hoisted` (the way `DownloadsView.test.tsx` does it) rather than in the
// module body: since story 083 D3 `HomeView` itself reaches the store through `NewsHero` ->
// `useReducedMotion`, so the bridge has to exist before this file's *imports* run, not just
// before its first statement.
vi.hoisted(() => {
  ;(globalThis as unknown as { q2: unknown }).q2 = { invoke: vi.fn(), on: vi.fn(() => () => {}) }
})

const { rendererModule } = await import('../index')

/** An i18n instance with no resources at all, so `t(key)` echoes the key back. */
let keyEcho: I18nInstance

beforeAll(async () => {
  await initI18n('en')
  keyEcho = createInstance()
  await keyEcho.init({ lng: 'en', resources: { en: { translation: {} } } })
})

afterEach(() => {
  cleanup()
  getNews.mockClear()
  refreshNews.mockClear()
  onNewsChanged.mockClear()
})

describe('the home module', () => {
  it('the home module provides the view for the home route', () => {
    const module = rendererModule('home')

    expect(module).toBeDefined()
    expect(module?.View).toBeDefined()
    // The registered view is this file's subject, not some other module's screen.
    expect(module?.View).toBe(HomeView)
  })
})

describe('the home screen', () => {
  it('the home screen shows no planned module', () => {
    const { container } = render(<HomeView />)

    // A module card was a button carrying the module's title and, for a parked module,
    // the "Planned" badge. None of the five may appear, in any shape.
    for (const title of ['Gamebrowser', 'Friendlist', 'Downloads', 'Mods', 'Assets', 'Library']) {
      expect(screen.queryByText(title)).toBeNull()
    }
    expect(screen.queryByText(en.module.planned.badge)).toBeNull()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(screen.queryAllByRole('link')).toHaveLength(0)

    // ...and neither may the hero: its generated key art and its four inert carousel dots.
    expect(container.querySelector('.hero-fallback')).toBeNull()
    expect(container.querySelector('[aria-label^="Show item"]')).toBeNull()

    // What is left is the placeholder block, so the screen is not blank either.
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(en.home.title)
    expect(screen.getByText(en.home.lead)).toBeTruthy()
  })

  it('every string on the home screen is an i18n key', () => {
    const { container } = render(
      <I18nextProvider i18n={keyEcho}>
        <HomeView />
      </I18nextProvider>,
    )

    const texts = visibleTexts(container)
    expect(texts.length).toBeGreaterThan(0)

    for (const text of texts) {
      // With a key-echoing `t`, anything on screen that is not a dotted key is prose
      // somebody hardcoded into the component.
      expect(text).toMatch(/^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9]+)+$/)
      expect(typeof translationFor(text)).toBe('string')
    }

    // Guards the regex above against passing on an empty render.
    expect(texts).toContain('home.title')
    expect(texts).toContain('home.lead')
  })
})

describe('the home screen feed wiring (story 083 D4 fixup)', () => {
  it('fetches the feed on mount and passes it into the hero', async () => {
    getNews.mockResolvedValueOnce({ ok: true, value: filledFeed })

    render(<HomeView />)

    expect(getNews).toHaveBeenCalledTimes(1)
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'A slide' })).toBeTruthy()
    })
  })

  it('subscribes to onNewsChanged and cleans up on unmount', () => {
    const unsubscribe = vi.fn()
    onNewsChanged.mockReturnValueOnce(unsubscribe)

    const { unmount } = render(<HomeView />)

    expect(onNewsChanged).toHaveBeenCalledTimes(1)
    expect(unsubscribe).not.toHaveBeenCalled()

    unmount()

    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('calls refreshNews when the hero requests a refresh, and shows its result', async () => {
    getNews.mockResolvedValueOnce({ ok: true, value: filledFeed })
    refreshNews.mockResolvedValueOnce({
      ok: true,
      value: { ...filledFeed, slides: [{ ...filledFeed.slides[0], title: 'Refreshed slide' }] },
    })

    render(<HomeView />)
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'A slide' })).toBeTruthy()
    })

    // The refresh control only renders in the `stale` state - drive that state directly by
    // pushing a `lastRefreshFailed` feed through the same `onNewsChanged` subscription the
    // component already registered, rather than reaching into `NewsHero`'s internals.
    const pushChangedFeed = onNewsChanged.mock.calls[0]?.[0]
    if (!pushChangedFeed) throw new Error('onNewsChanged listener was not registered')
    pushChangedFeed({ ...filledFeed, lastRefreshFailed: true })

    const refreshButton = await screen.findByRole('button', { name: en.home.hero.stale.refresh })
    fireEvent.click(refreshButton)

    expect(refreshNews).toHaveBeenCalledTimes(1)
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Refreshed slide' })).toBeTruthy()
    })
  })

  it('leaves the last-known feed in place when a refresh fails', async () => {
    getNews.mockResolvedValueOnce({ ok: true, value: filledFeed })
    refreshNews.mockResolvedValueOnce({ ok: false as const, error: { key: 'home.hero.stale.refresh' } })

    render(<HomeView />)
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'A slide' })).toBeTruthy()
    })

    const pushChangedFeed = onNewsChanged.mock.calls[0]?.[0]
    if (!pushChangedFeed) throw new Error('onNewsChanged listener was not registered')
    pushChangedFeed({ ...filledFeed, lastRefreshFailed: true })

    const refreshButton = await screen.findByRole('button', { name: en.home.hero.stale.refresh })
    fireEvent.click(refreshButton)

    expect(refreshNews).toHaveBeenCalledTimes(1)
    // Still the same slide - a failed refresh never throws and never clears what was there.
    expect(screen.getByRole('heading', { name: 'A slide' })).toBeTruthy()
  })
})

/** Every non-blank piece of text the user can read, in document order. */
function visibleTexts(root: HTMLElement): string[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const texts: string[] = []
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent?.trim()
    if (text) texts.push(text)
  }
  return texts
}

/** Resolves a dotted i18n key against the shipped English bundle. */
function translationFor(key: string): unknown {
  return key
    .split('.')
    .reduce<unknown>(
      (node, part) =>
        node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined,
      en,
    )
}
