// @vitest-environment jsdom
import { HOME_HANDLERS, type NewsSlide } from '@shared/modules/home'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SlideBanner } from './components/SlideBanner'
import { resolveSlideTemplate } from './components/resolveSlideTemplate'
import { SlideSplit } from './components/SlideSplit'
import { SlideText } from './components/SlideText'

/**
 * Story 083 D2. Proves:
 *
 * - AC2 - each template renders its own documented field set, an unknown template falls back to
 *   `text`, and feed data contributes no `style` or `class` to the rendered DOM.
 * - AC8 (partial) - a slide button is a real `<button>` with no `href` anywhere in the tree, and
 *   clicking it calls back out through the caller's `onOpenUrl` rather than `window.open`.
 */

// Story 083 D5: `SlideButtons` now also calls the home client's `openSlideUrl` on click, which
// reaches `window.q2` through `lib/bridge.ts` at *module* scope - same stub as
// `NewsHero.test.tsx`/`HomeView.test.tsx`. No IPC traffic is asserted here.
vi.hoisted(() => {
  ;(globalThis as unknown as { q2: unknown }).q2 = {
    invoke: vi.fn(async () => ({ ok: true, value: null })),
    on: vi.fn(() => () => {}),
  }
})

beforeEach(() => {
  ;(globalThis as unknown as { q2: { invoke: ReturnType<typeof vi.fn> } }).q2.invoke.mockClear()
})

afterEach(() => {
  cleanup()
})

function baseSlide(overrides: Partial<NewsSlide> = {}): NewsSlide {
  return {
    id: 'slide-1',
    template: 'text',
    order: 10,
    title: 'Q2PRO 1.2 is out',
    body: 'A new engine build landed with better anti-cheat and demo playback.',
    buttons: [],
    ...overrides,
  }
}

describe('SlideText', () => {
  it('renders title, body and buttons - nothing else', () => {
    const onOpenUrl = vi.fn()
    const slide = baseSlide({
      buttons: [{ label: 'Changelog', url: 'https://github.com/skullernet/q2pro/releases' }],
    })

    const { container } = render(<SlideText slide={slide} onOpenUrl={onOpenUrl} />)

    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(slide.title)
    expect(screen.getByText(slide.body)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Changelog' })).toBeTruthy()
    // No image slot in `text` at all.
    expect(container.querySelector('img')).toBeNull()
  })
})

describe('SlideSplit', () => {
  it('renders title, body, image and buttons when imageUrl is present', () => {
    const onOpenUrl = vi.fn()
    const slide = baseSlide({
      template: 'split',
      imageUrl: 'q2launcher://app/news-image/abc123.png',
      buttons: [{ label: 'Download', url: 'https://github.com/skullernet/q2pro/releases/latest' }],
    })

    const { container } = render(<SlideSplit slide={slide} onOpenUrl={onOpenUrl} />)

    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(slide.title)
    expect(screen.getByText(slide.body)).toBeTruthy()
    const img = container.querySelector('img') as HTMLImageElement
    expect(img.getAttribute('src')).toBe(slide.imageUrl)
    expect(screen.getByRole('button', { name: 'Download' })).toBeTruthy()
    // The text column keeps its normal (non-full-width) class when an image is present.
    const content = container.querySelector('.home-hero-content') as HTMLElement
    expect(content.className.split(/\s+/)).not.toContain('home-hero-content-full')
    // The hero frame's own height comes from `NewsHero`'s fixed-height ancestor, never from this
    // template - so nothing here toggles when an image is present.
    expect(container.querySelector('.home-hero-slide-split')).toBeTruthy()
  })

  it('renders title, body and buttons at full width - no broken image or empty box - when imageUrl is absent', () => {
    const onOpenUrl = vi.fn()
    const slide = baseSlide({ template: 'split' })

    const { container } = render(<SlideSplit slide={slide} onOpenUrl={onOpenUrl} />)

    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(slide.title)
    expect(screen.getByText(slide.body)).toBeTruthy()
    // No <img> at all - not even one with an empty/undefined src.
    expect(container.querySelector('img')).toBeNull()
    // No reserved media box left behind either.
    expect(container.querySelector('.home-hero-media')).toBeNull()
    // The text column takes the full width instead.
    const content = container.querySelector('.home-hero-content') as HTMLElement
    expect(content.className.split(/\s+/)).toContain('home-hero-content-full')
    // The frame/slide wrapper itself is unchanged - same classes as the with-image case, so the
    // hero's height is never conditional on image presence.
    expect(container.querySelector('.home-hero-slide-split')).toBeTruthy()
  })
})

describe('SlideBanner', () => {
  it('renders title, body, image and buttons when imageUrl is present', () => {
    const onOpenUrl = vi.fn()
    const slide = baseSlide({
      template: 'banner',
      imageUrl: 'q2launcher://app/news-image/abc123.png',
      buttons: [{ label: 'Changelog', url: 'https://github.com/skullernet/q2pro/releases' }],
    })

    const { container } = render(<SlideBanner slide={slide} onOpenUrl={onOpenUrl} />)

    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(slide.title)
    const img = container.querySelector('img') as HTMLImageElement
    expect(img.getAttribute('src')).toBe(slide.imageUrl)
    expect(screen.getByRole('button', { name: 'Changelog' })).toBeTruthy()
    const content = container.querySelector('.home-hero-content') as HTMLElement
    expect(content.className.split(/\s+/)).not.toContain('home-hero-content-full')
  })

  it('renders title, body and buttons at full width - no broken image or empty box - when imageUrl is absent', () => {
    const onOpenUrl = vi.fn()
    const slide = baseSlide({ template: 'banner' })

    const { container } = render(<SlideBanner slide={slide} onOpenUrl={onOpenUrl} />)

    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(slide.title)
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('.home-hero-media')).toBeNull()
    const content = container.querySelector('.home-hero-content') as HTMLElement
    expect(content.className.split(/\s+/)).toContain('home-hero-content-full')
    expect(container.querySelector('.home-hero-slide-banner')).toBeTruthy()
  })
})

describe('resolveSlideTemplate', () => {
  it('resolves a known template to itself regardless of image presence (story 084 AC3: the template stays intact, SlideSplit/SlideBanner render the full-width fallback when there is no image)', () => {
    expect(resolveSlideTemplate({ template: 'split' })).toBe('split')
    expect(resolveSlideTemplate({ template: 'banner' })).toBe('banner')
  })

  it('falls back to text for an unrecognised template value', () => {
    expect(resolveSlideTemplate({ template: 'carousel-of-doom' })).toBe('text')
  })
})

describe('slide buttons', () => {
  it('renders at most 3 buttons even when the slide carries more', () => {
    const onOpenUrl = vi.fn()
    const slide = baseSlide({
      buttons: [
        { label: 'One', url: 'https://github.com/a' },
        { label: 'Two', url: 'https://github.com/b' },
        { label: 'Three', url: 'https://github.com/c' },
        { label: 'Four', url: 'https://github.com/d' },
        { label: 'Five', url: 'https://github.com/e' },
      ],
    })

    render(<SlideText slide={slide} onOpenUrl={onOpenUrl} />)

    expect(screen.getAllByRole('button')).toHaveLength(3)
  })

  it('is a <button> with no href anywhere, and does not call window.open', () => {
    const onOpenUrl = vi.fn()
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    const slide = baseSlide({
      buttons: [{ label: 'Changelog', url: 'https://github.com/skullernet/q2pro/releases' }],
    })

    const { container } = render(<SlideText slide={slide} onOpenUrl={onOpenUrl} />)

    const button = screen.getByRole('button', { name: 'Changelog' })
    expect(button.tagName).toBe('BUTTON')
    expect(container.querySelectorAll('[href]')).toHaveLength(0)
    expect(container.querySelectorAll('a')).toHaveLength(0)

    button.click()

    expect(openSpy).not.toHaveBeenCalled()
    expect(onOpenUrl).toHaveBeenCalledWith('https://github.com/skullernet/q2pro/releases')

    // Story 083 D5: the click must also reach the home client's real IPC call - not just the
    // caller's own `onOpenUrl` observer above. Asserts the actual `window.q2.invoke` call made by
    // `callModule`/`moduleClient.ts`: the single `module:invoke` channel, namespaced by
    // `moduleId`/`type`, carrying the slide button's url as its payload.
    const invokeMock = (globalThis as unknown as { q2: { invoke: ReturnType<typeof vi.fn> } }).q2
      .invoke
    expect(invokeMock).toHaveBeenCalledWith('module:invoke', {
      moduleId: 'home',
      type: HOME_HANDLERS.openSlideUrl,
      payload: 'https://github.com/skullernet/q2pro/releases',
    })

    openSpy.mockRestore()
  })
})

describe('feed data cannot style itself', () => {
  it('an attacker-shaped style/className field on the slide never reaches the DOM', () => {
    const onOpenUrl = vi.fn()
    // Cast through `unknown`: a real `NewsSlide` has no `style`/`className` field at all - this
    // simulates untrusted data that made it past validation carrying extra properties anyway.
    const slide = {
      ...baseSlide(),
      style: { color: 'red', position: 'fixed' },
      className: 'attacker-injected',
    } as unknown as NewsSlide

    const { container } = render(<SlideText slide={slide} onOpenUrl={onOpenUrl} />)

    const root = container.firstElementChild as HTMLElement
    expect(root.getAttribute('style')).toBeNull()
    expect(root.className.split(/\s+/)).not.toContain('attacker-injected')
    // No descendant picked it up either.
    expect(container.querySelector('[style]')).toBeNull()
    expect(container.querySelector('.attacker-injected')).toBeNull()
  })
})
