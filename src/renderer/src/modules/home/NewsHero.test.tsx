// @vitest-environment jsdom
import type { NewsSlide } from '@shared/modules/home'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { initI18n } from '../../i18n'
import en from '../../i18n/locales/en.json'
import { useLauncher } from '../../store/useLauncher'
import { NewsHero, SLIDE_INTERVAL_MS } from './NewsHero'

/**
 * Story 083 D3. Proves the hero's geometry (AC1's unit half), its controls (AC3), the three
 * independent pause reasons plus the latch (AC4), reduced motion as a real kill switch rather
 * than a zeroed CSS duration (AC5) and the accessibility surface (AC9).
 *
 * Reduced motion is driven through the *real* mechanism - `useLauncher`'s `settings.motion`, the
 * same store value `App.tsx` mirrors onto `<html data-motion>` - rather than by mocking
 * `useReducedMotion`, so the hook's own wiring to the setting is under test too.
 */

// `useReducedMotion` -> `../../store/useLauncher` -> `lib/bridge.ts`, which resolves `window.q2`
// at *module* scope (same stub as `HomeView.test.tsx`/`DownloadsView.test.tsx`). No IPC traffic
// is asserted here.
vi.hoisted(() => {
  ;(globalThis as unknown as { q2: unknown }).q2 = {
    invoke: vi.fn(async () => ({ ok: true })),
    on: vi.fn(() => () => {}),
  }
})

const hero = en.home.hero

/** A dot's accessible name, built from the shipped key rather than a copy of its English text. */
function dotName(position: number): string {
  return hero.goToSlide.replace('{{position}}', String(position))
}

function slide(index: number): NewsSlide {
  return {
    id: `slide-${index}`,
    template: 'text',
    order: index * 10,
    title: `Slide ${index}`,
    body: `Body of slide ${index}.`,
    buttons: [],
  }
}

const slides = [slide(1), slide(2), slide(3)]

/** The rendered slide's title - the heading each template puts on screen. */
function currentTitle(): string {
  return screen.getByRole('heading', { level: 2 }).textContent ?? ''
}

/** Runs the fake clock forward inside `act`, so a timer-driven render is flushed like any other. */
async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

beforeAll(async () => {
  await initI18n('en')
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  useLauncher.setState({ settings: { ...useLauncher.getState().settings, motion: 'system' } })
})

describe('the news hero', () => {
  it('AC1: is a fixed 320px region the user cannot resize, move or dismiss', () => {
    render(<NewsHero slides={slides} />)

    const region = screen.getByTestId('home-hero')
    const classes = region.className.split(/\s+/)
    // 320px, and not a flex item that can be squeezed by whatever sits below it.
    expect(classes).toContain('h-80')
    expect(classes).toContain('shrink-0')
    // No height utility that would let it grow or shrink with content.
    expect(classes.some((name) => /^(h-full|h-auto|min-h-|max-h-|flex-1)/.test(name))).toBe(false)

    // No affordance to move, resize or hide it: nothing draggable, no resizer, and every control
    // it does have is one of the four documented carousel controls.
    expect(region.getAttribute('draggable')).toBeNull()
    expect(region.querySelector('[draggable="true"]')).toBeNull()
    expect(
      region.querySelector('[class*="resize"], [class*="cursor-col"], [role="separator"]'),
    ).toBeNull()
    const allowed = new Set<string>([
      hero.previous,
      hero.next,
      hero.pause,
      hero.resume,
      ...slides.map((_, index) => dotName(index + 1)),
    ])
    for (const control of screen.getAllByRole('button')) {
      expect(allowed.has(control.getAttribute('aria-label') ?? '')).toBe(true)
    }
  })

  it('AC3: dots, previous, next and pause exist and each does its job', () => {
    render(<NewsHero slides={slides} />)

    expect(currentTitle()).toBe('Slide 1')

    fireEvent.click(screen.getByRole('button', { name: hero.next }))
    expect(currentTitle()).toBe('Slide 2')

    fireEvent.click(screen.getByRole('button', { name: hero.previous }))
    expect(currentTitle()).toBe('Slide 1')

    // Previous wraps rather than sticking at the first slide.
    fireEvent.click(screen.getByRole('button', { name: hero.previous }))
    expect(currentTitle()).toBe('Slide 3')

    fireEvent.click(screen.getByRole('button', { name: dotName(2) }))
    expect(currentTitle()).toBe('Slide 2')
    expect(screen.getByRole('button', { name: dotName(2) }).getAttribute('aria-current')).toBe(
      'true',
    )

    const pause = screen.getByRole('button', { name: hero.pause })
    expect(pause.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(pause)
    expect(screen.getByRole('button', { name: hero.resume }).getAttribute('aria-pressed')).toBe(
      'true',
    )
  })

  it('AC3: rotates on its own after the tick interval when nothing holds it back', async () => {
    vi.useFakeTimers()
    render(<NewsHero slides={slides} />)

    expect(currentTitle()).toBe('Slide 1')

    await advance(SLIDE_INTERVAL_MS)
    expect(currentTitle()).toBe('Slide 2')

    await advance(SLIDE_INTERVAL_MS)
    expect(currentTitle()).toBe('Slide 3')

    // ...and wraps, without the interval having gone stale on an old index.
    await advance(SLIDE_INTERVAL_MS)
    expect(currentTitle()).toBe('Slide 1')
  })

  it('AC3: a single slide gets no rotation and no carousel controls', async () => {
    vi.useFakeTimers()
    render(<NewsHero slides={[slide(1)]} />)

    await advance(SLIDE_INTERVAL_MS * 3)

    expect(currentTitle()).toBe('Slide 1')
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  it('AC4: hovering the hero pauses the rotation, leaving it resumes', async () => {
    vi.useFakeTimers()
    render(<NewsHero slides={slides} />)
    const region = screen.getByTestId('home-hero')

    // `mouseOver`/`mouseOut`, because React synthesises `onMouseEnter`/`onMouseLeave` from those.
    fireEvent.mouseOver(region)
    await advance(SLIDE_INTERVAL_MS * 3)
    expect(currentTitle()).toBe('Slide 1')

    fireEvent.mouseOut(region)
    await advance(SLIDE_INTERVAL_MS)
    expect(currentTitle()).toBe('Slide 2')
  })

  it('AC4: focus inside the hero pauses the rotation, and tabbing between controls keeps it paused', async () => {
    vi.useFakeTimers()
    render(<NewsHero slides={slides} />)
    const next = screen.getByRole('button', { name: hero.next })
    const previous = screen.getByRole('button', { name: hero.previous })

    fireEvent.focusIn(next)
    await advance(SLIDE_INTERVAL_MS * 2)
    expect(currentTitle()).toBe('Slide 1')

    // Focus moving from one control to another inside the hero is not a focus *leave* - if it
    // were, the timer would be recreated between the focusout/focusin pair.
    fireEvent.focusOut(next, { relatedTarget: previous })
    fireEvent.focusIn(previous)
    await advance(SLIDE_INTERVAL_MS * 2)
    expect(currentTitle()).toBe('Slide 1')

    fireEvent.focusOut(previous, { relatedTarget: document.body })
    await advance(SLIDE_INTERVAL_MS)
    expect(currentTitle()).toBe('Slide 2')
  })

  it('AC4: the pause control latches, so the pause survives the pointer leaving', async () => {
    vi.useFakeTimers()
    render(<NewsHero slides={slides} />)
    const region = screen.getByTestId('home-hero')

    fireEvent.mouseOver(region)
    fireEvent.click(screen.getByRole('button', { name: hero.pause }))
    // In a real browser the click also focuses the control, so both transient reasons are
    // cleared below - leaving the latch as the only thing still holding the rotation.
    fireEvent.mouseOut(region)
    fireEvent.focusOut(region, { relatedTarget: document.body })

    await advance(SLIDE_INTERVAL_MS * 3)
    expect(currentTitle()).toBe('Slide 1')

    fireEvent.click(screen.getByRole('button', { name: hero.resume }))
    await advance(SLIDE_INTERVAL_MS)
    expect(currentTitle()).toBe('Slide 2')
  })

  it('AC5: under reduced motion no timer runs and no transition class is applied, but the controls still work', async () => {
    vi.useFakeTimers()
    useLauncher.setState({ settings: { ...useLauncher.getState().settings, motion: 'reduced' } })

    render(<NewsHero slides={slides} />)

    // No interval at all - not merely a zeroed CSS duration.
    await advance(SLIDE_INTERVAL_MS * 5)
    expect(currentTitle()).toBe('Slide 1')
    expect(screen.getByTestId('home-hero-frame').className).not.toContain('home-hero-frame-enter')

    fireEvent.click(screen.getByRole('button', { name: hero.next }))
    expect(currentTitle()).toBe('Slide 2')
    fireEvent.click(screen.getByRole('button', { name: hero.previous }))
    expect(currentTitle()).toBe('Slide 1')
    fireEvent.click(screen.getByRole('button', { name: dotName(3) }))
    expect(currentTitle()).toBe('Slide 3')
    expect(screen.getByTestId('home-hero-frame').className).not.toContain('home-hero-frame-enter')

    // Switching the setting back off hands the rotation over without a reload.
    await act(async () => {
      useLauncher.setState({ settings: { ...useLauncher.getState().settings, motion: 'full' } })
    })
    expect(screen.getByTestId('home-hero-frame').className).toContain('home-hero-frame-enter')
    await advance(SLIDE_INTERVAL_MS)
    expect(currentTitle()).toBe('Slide 1')
  })

  it('AC9: the hero is a labelled region with a live announcement, a text counter and real buttons', () => {
    render(<NewsHero slides={slides} />)

    // A named region, not an anonymous div.
    expect(screen.getByRole('region', { name: hero.label })).toBe(screen.getByTestId('home-hero'))

    const live = screen.getByTestId('home-hero-live')
    expect(live.getAttribute('aria-live')).toBe('polite')
    expect(live.textContent).toBe('Slide 1')

    expect(screen.getByText('1 / 3')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: hero.next }))
    expect(live.textContent).toBe('Slide 2')
    expect(screen.getByText('2 / 3')).toBeTruthy()

    // Every control is a real, focusable button - dots included, and grouped.
    const controls = [
      hero.previous,
      hero.next,
      hero.pause,
      ...slides.map((_, index) => dotName(index + 1)),
    ]
    for (const name of controls) {
      const control = screen.getByRole('button', { name })
      expect(control.tagName).toBe('BUTTON')
      expect(control.getAttribute('type')).toBe('button')
      expect(control.hasAttribute('disabled')).toBe(false)
      act(() => control.focus())
      expect(document.activeElement).toBe(control)
    }
    expect(screen.getByRole('group', { name: hero.dots }).querySelectorAll('button')).toHaveLength(
      3,
    )
  })
})

describe('the news hero, no cached feed (story 083 D4)', () => {
  it('AC6: shows the built-in welcome slide, named from i18n keys, with zero <img> elements', () => {
    render(<NewsHero slides={[]} />)

    const region = screen.getByTestId('home-hero')
    expect(screen.getAllByText(hero.welcome.title).length).toBeGreaterThan(0)
    expect(screen.getByText(hero.welcome.step1)).toBeTruthy()
    expect(screen.getByText(hero.welcome.step2)).toBeTruthy()
    expect(screen.getByText(hero.welcome.step3)).toBeTruthy()

    // No bitmap anywhere in the hero while welcome is showing - checked by DOM query, not merely by
    // "no image field was passed in".
    expect(region.querySelectorAll('img')).toHaveLength(0)

    // No carousel controls for a state that has no real slides to page through.
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(screen.queryByTestId('home-hero-stale')).toBeNull()
  })

  it('a real feed displaces the welcome slide', () => {
    render(<NewsHero slides={[slide(1)]} />)

    expect(screen.queryByTestId('home-hero-welcome')).toBeNull()
    expect(currentTitle()).toBe('Slide 1')
  })
})

describe('the news hero, a feed after a failed refresh (story 083 D4)', () => {
  it('AC7: shows an "as of <date>" chip and a refresh button, no toast, no dialog', () => {
    render(
      <NewsHero
        slides={slides}
        retrievedAt="2020-01-01T00:00:00.000Z"
        lastRefreshFailed
        onRefresh={vi.fn()}
      />,
    )

    // The real feed is still shown - staleness never displaces it.
    expect(screen.queryByTestId('home-hero-welcome')).toBeNull()
    expect(currentTitle()).toBe('Slide 1')

    // Story 083 finding 6: AC7's "as of <date>" is an actual date, not a fuzzy relative-time
    // string - the relative time still lives in the chip's `title` tooltip.
    const chip = screen.getByTestId('home-hero-stale')
    expect(chip.textContent).toContain('2020')
    expect(chip.querySelector('.home-hero-stale-chip')?.getAttribute('title')).toContain('ago')
    expect(screen.getByRole('button', { name: hero.stale.refresh })).toBeTruthy()

    // No toast/dialog element of any kind - this repo has no toast or dialog service at all
    // (confirmed by grep before writing this test), so the absence of `[role="alert"]` and
    // `[role="dialog"]` in the whole document is the strongest assertion available.
    expect(document.querySelector('[role="alert"]')).toBeNull()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('the refresh button calls the caller-supplied onRefresh, not a new IPC channel', () => {
    const onRefresh = vi.fn()
    render(<NewsHero slides={slides} retrievedAt="2020-01-01T00:00:00.000Z" lastRefreshFailed onRefresh={onRefresh} />)

    fireEvent.click(screen.getByRole('button', { name: hero.stale.refresh }))
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })
})
