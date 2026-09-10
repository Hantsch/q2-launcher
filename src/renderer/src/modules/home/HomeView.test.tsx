// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createInstance, type i18n as I18nInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { initI18n } from '../../i18n'
import en from '../../i18n/locales/en.json'
import { HomeView } from './HomeView'

/**
 * Story 081 D2. Three things are proven here:
 *
 * - AC1's renderer half - the `home` module really provides the view for `/home`,
 *   asserted against the *real* registry (mirrors `modules/index.test.ts`), because a
 *   mocked registry would hide exactly the registration this story is about.
 * - AC4 - nothing planned-module-shaped survived on the screen.
 * - AC6 - every string the screen shows is an i18n key that exists in `en.json`.
 */

// `../index` pulls in the other modules' views -> the renderer store -> `lib/bridge.ts`, which
// resolves `window.q2` at *module* scope. Stubbed the way `modules/index.test.ts` stubs it; this
// test only asserts on the registry, never on IPC traffic.
;(globalThis as unknown as { q2: unknown }).q2 = { invoke: vi.fn(), on: vi.fn(() => () => {}) }

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
