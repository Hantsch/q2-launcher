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
  it('renders title, body, image and buttons when an image is present', () => {
    const onOpenUrl = vi.fn()
    const slide = baseSlide({
      template: 'split',
      image: 'https://example.com/img/q2pro.png',
      buttons: [{ label: 'Download', url: 'https://github.com/skullernet/q2pro/releases/latest' }],
    })

    const { container } = render(<SlideSplit slide={slide} onOpenUrl={onOpenUrl} />)

    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(slide.title)
    expect(screen.getByText(slide.body)).toBeTruthy()
    const img = container.querySelector('img') as HTMLImageElement
    expect(img.getAttribute('src')).toBe(slide.image)
    expect(screen.getByRole('button', { name: 'Download' })).toBeTruthy()
  })

  it('falls back to the text layout when the slide has no image', () => {
    const onOpenUrl = vi.fn()
    const slide = baseSlide({ template: 'split' })

    const { container } = render(<SlideSplit slide={slide} onOpenUrl={onOpenUrl} />)

    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(slide.title)
    expect(container.querySelector('img')).toBeNull()
  })
})

describe('SlideBanner', () => {
  it('renders title, body, image and buttons when an image is present', () => {
    const onOpenUrl = vi.fn()
    const slide = baseSlide({
      template: 'banner',
      image: 'https://example.com/img/q2pro.png',
      buttons: [{ label: 'Changelog', url: 'https://github.com/skullernet/q2pro/releases' }],
    })

    const { container } = render(<SlideBanner slide={slide} onOpenUrl={onOpenUrl} />)

    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(slide.title)
    expect(container.querySelector('img')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Changelog' })).toBeTruthy()
  })

  it('falls back to the text layout when the slide has no image', () => {
    const onOpenUrl = vi.fn()
    const slide = baseSlide({ template: 'banner' })

    const { container } = render(<SlideBanner slide={slide} onOpenUrl={onOpenUrl} />)

    expect(container.querySelector('img')).toBeNull()
  })
})

describe('resolveSlideTemplate', () => {
  it('resolves a known template with an image to itself', () => {
    expect(resolveSlideTemplate({ template: 'split', image: 'img/x.png' })).toBe('split')
    expect(resolveSlideTemplate({ template: 'banner', image: 'img/x.png' })).toBe('banner')
  })

  it('falls back to text when a known template has no image', () => {
    expect(resolveSlideTemplate({ template: 'split' })).toBe('text')
    expect(resolveSlideTemplate({ template: 'banner' })).toBe('text')
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
