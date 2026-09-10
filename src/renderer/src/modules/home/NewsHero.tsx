import type { NewsSlide } from '@shared/modules/home'
import { ChevronLeft, ChevronRight, Pause, Play, RefreshCw } from 'lucide-react'
import { useEffect, useReducer, type FocusEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/cn'
import { formatRelativeTime } from '../../lib/format'
import { carouselReducer, createCarouselState, isRunning } from './carousel'
import { SlideBanner } from './components/SlideBanner'
import { resolveSlideTemplate } from './components/resolveSlideTemplate'
import { SlideSplit } from './components/SlideSplit'
import { SlideText } from './components/SlideText'
import { feedState } from './feedState'
import { useReducedMotion } from './useReducedMotion'

/**
 * The home screen's news hero (story 083 D3): a fixed 320px carousel across the top of the home
 * view, driven by `carousel.ts`'s pure state machine (D1) and rendering one slide through the
 * three fixed templates (D2).
 *
 * The timer is the delicate part, so it is deliberately structured to make the failure modes
 * impossible rather than unlikely:
 *
 * - There is exactly **one** `setInterval`, owned by one effect whose dependencies are the derived
 *   `isRunning` and the current index - nothing else can start or stop rotation.
 * - The interval callback dispatches `tick` and reads *nothing* from the closure, so it can never
 *   advance from a stale index; `carouselReducer` computes the next index from the live state and
 *   `tick` is itself a no-op whenever `isRunning` is false (belt and braces with the effect).
 * - The three pause reasons stay independent, exactly as D1 tests them: hover and focus are
 *   transient, `latched` is the pause button's own state and is never touched by a hover or focus
 *   transition - which is what lets a latched pause survive the pointer leaving.
 * - Reduced motion is a kill switch, not a pause: no interval is created at all (a zeroed
 *   `--dur-*` via `data-motion` cannot stop a timer, see `useReducedMotion.ts`) and no
 *   slide-change animation class is applied - while dots, prev and next keep working.
 *
 * Story 083 D4 adds the welcome/stale states on top of D3's carousel shell: `feedState.ts` maps
 * `{ slides, lastRefreshFailed }` to `'welcome' | 'stale' | 'filled'` and this component renders
 * accordingly - a built-in, i18n-sourced welcome slide when there is no cached feed at all (no
 * `<img>`, nothing sent from main beyond keys), the real carousel plus an "as of" chip and a
 * refresh button when the cached feed's last refresh failed, and the plain carousel otherwise.
 * Opening a slide button's URL is D5's job: `SlideButtons` itself calls the home client's
 * `openSlideUrl` on click, so `onOpenUrl` below is only the D2-era callback kept for callers that
 * still want to observe the click.
 */

/** Auto-rotation period (story 083, Decisions: 8 seconds). */
export const SLIDE_INTERVAL_MS = 8_000

/**
 * Story 083 finding 6: AC7/D4 call the stale chip an "as of `<date>`" note - a date, not a fuzzy
 * relative-time string (which is what `formatRelativeTime` alone renders as, e.g. "2 years ago").
 * `lib/format.ts` has no date-formatting helper today (checked before adding this), so this stays a
 * small local formatter rather than a new shared one for a single caller. Locale-aware via `Intl`,
 * consistent with every other formatter in `lib/format.ts`.
 */
function formatAsOfDate(iso: string | undefined): string | null {
  if (!iso) return null
  const timestamp = Date.parse(iso)
  if (Number.isNaN(timestamp)) return null
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(timestamp)
}

const TEMPLATES = {
  split: SlideSplit,
  banner: SlideBanner,
  text: SlideText,
} as const

export interface NewsHeroProps {
  slides: NewsSlide[]
  /** ISO timestamp of the feed's last successful retrieval (`NewsFeed.retrievedAt`) - only read for
   * the stale chip's "as of" text. Omitted when there is no feed at all yet. */
  retrievedAt?: string
  /** `NewsFeed.lastRefreshFailed` (story 083 D4). Defaults to `false`, matching a caller that has
   * not wired the real feed in yet (D5). */
  lastRefreshFailed?: boolean
  /** Optional observer for a slide button click - `SlideButtons` calls the home client's
   * `openSlideUrl` itself (D5), so nothing here needs to open a URL. */
  onOpenUrl?: (url: string) => void
  /** Reuses the existing `news.refresh` handler via the caller's client wiring (082/D5) - this
   * component never calls into `client.ts` or IPC directly. */
  onRefresh?: () => void
}

export function NewsHero({ slides, retrievedAt, lastRefreshFailed, onOpenUrl, onRefresh }: NewsHeroProps) {
  const { t } = useTranslation()
  const reducedMotion = useReducedMotion()
  const count = slides.length
  const heroState = feedState({ slides, lastRefreshFailed: lastRefreshFailed ?? false })
  const [state, dispatch] = useReducer(carouselReducer, undefined, () =>
    createCarouselState(count, reducedMotion),
  )

  // Both syncs are guarded against dispatching a value the reducer already holds. Without the
  // guard each would re-render on every mount (the reducer returns a fresh object even for an
  // unchanged field); with the compared value in the dependency list, the guard is also what
  // makes the effect provably terminate instead of looping through its own dispatch.
  useEffect(() => {
    if (state.count !== count) dispatch({ type: 'setCount', count })
  }, [count, state.count])

  useEffect(() => {
    if (state.reducedMotion !== reducedMotion) dispatch({ type: 'setReducedMotion', reducedMotion })
  }, [reducedMotion, state.reducedMotion])

  const running = isRunning(state)

  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => dispatch({ type: 'tick' }), SLIDE_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [running, state.index])

  // `setCount` clamps the index, but that only lands on the render *after* a shrinking feed, so
  // the read itself is bounded too - nothing here may index past the array or divide by zero.
  const index = count > 0 ? Math.min(state.index, count - 1) : 0
  const slide = count > 0 ? slides[index] : undefined
  const Template = slide ? TEMPLATES[resolveSlideTemplate(slide)] : null

  function hoverLeave() {
    if (state.hovered) dispatch({ type: 'hoverLeave' })
  }

  function focusIn() {
    if (!state.focused) dispatch({ type: 'focusEnter' })
  }

  function focusOut(event: FocusEvent<HTMLElement>) {
    // Focus moving between two controls *inside* the hero is not a focus leave. Without this the
    // pause would flicker off and on between the focusout/focusin pair - long enough to recreate
    // the interval - every time the user tabbed from prev to next.
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) {
      return
    }
    if (state.focused) dispatch({ type: 'focusLeave' })
  }

  return (
    <section
      aria-label={t('home.hero.label')}
      data-testid="home-hero"
      className="home-hero h-80 shrink-0 border-b border-line bg-panel"
      onMouseEnter={() => {
        if (!state.hovered) dispatch({ type: 'hoverEnter' })
      }}
      onMouseLeave={hoverLeave}
      onFocus={focusIn}
      onBlur={focusOut}
    >
      <div className="home-hero-stage">
        {heroState === 'welcome' ? (
          // AC6: the built-in welcome slide - i18n keys only, no bitmap of any kind. Not one of the
          // three feed templates: it never has real slide data to render, so it renders its own
          // fixed markup instead of going through `resolveSlideTemplate`/`TEMPLATES`.
          <div className="home-hero-frame" data-testid="home-hero-welcome">
            <div className="home-hero-slide home-hero-slide-text">
              <div className="home-hero-content">
                <h2 className="home-hero-title">{t('home.hero.welcome.title')}</h2>
                <ol className="home-hero-welcome-steps">
                  <li>{t('home.hero.welcome.step1')}</li>
                  <li>{t('home.hero.welcome.step2')}</li>
                  <li>{t('home.hero.welcome.step3')}</li>
                </ol>
              </div>
            </div>
          </div>
        ) : slide && Template ? (
          <div
            key={slide.id}
            className={cn('home-hero-frame', !reducedMotion && 'home-hero-frame-enter')}
            data-testid="home-hero-frame"
          >
            <Template slide={slide} onOpenUrl={onOpenUrl ?? noop} />
          </div>
        ) : null}

        {heroState === 'stale' ? (
          // AC7: shown alongside the real feed, never instead of it - no toast, no dialog, just a
          // chip and a button inside the hero itself (Decisions (Sprint)).
          <div className="home-hero-stale" data-testid="home-hero-stale">
            <span
              className="home-hero-stale-chip"
              title={formatRelativeTime(retrievedAt) ?? undefined}
            >
              {t('home.hero.stale.asOf', { time: formatAsOfDate(retrievedAt) ?? '' })}
            </span>
            <button
              type="button"
              className="home-hero-stale-refresh"
              onClick={() => onRefresh?.()}
            >
              <RefreshCw className="size-3.5" aria-hidden="true" />
              {t('home.hero.stale.refresh')}
            </button>
          </div>
        ) : null}
      </div>

      {/* The slide change is announced rather than only shown, since the rotation is what moves
          the screen and nothing else reports it. Polite: news never interrupts. */}
      <div aria-live="polite" className="sr-only" data-testid="home-hero-live">
        {heroState === 'welcome' ? t('home.hero.welcome.title') : (slide?.title ?? '')}
      </div>

      {count > 1 ? (
        <div className="home-hero-controls">
          <button
            type="button"
            className="home-hero-ctl"
            aria-label={t('home.hero.previous')}
            onClick={() => dispatch({ type: 'prev' })}
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
          </button>

          <div role="group" aria-label={t('home.hero.dots')} className="home-hero-dots">
            {slides.map((item, dotIndex) => (
              <button
                key={item.id}
                type="button"
                className="home-hero-ctl"
                aria-label={t('home.hero.goToSlide', { position: dotIndex + 1 })}
                aria-current={dotIndex === index ? 'true' : undefined}
                onClick={() => dispatch({ type: 'goto', index: dotIndex })}
              >
                <span className="home-hero-dot-mark" />
              </button>
            ))}
          </div>

          {/* AC9: the position is readable as text, not only as a lit dot. */}
          <p className="home-hero-counter">
            {/* `total`, not `count`: an interpolation named `count` would send i18next looking
                for a plural suffix this key deliberately does not have. */}
            {t('home.hero.counter', { position: index + 1, total: count })}
          </p>

          <button
            type="button"
            className="home-hero-ctl"
            aria-label={t('home.hero.next')}
            onClick={() => dispatch({ type: 'next' })}
          >
            <ChevronRight className="size-4" aria-hidden="true" />
          </button>

          <button
            type="button"
            className="home-hero-ctl"
            aria-pressed={state.latched}
            aria-label={state.latched ? t('home.hero.resume') : t('home.hero.pause')}
            onClick={() => dispatch({ type: 'toggleLatch' })}
          >
            {state.latched ? (
              <Play className="size-4" aria-hidden="true" />
            ) : (
              <Pause className="size-4" aria-hidden="true" />
            )}
          </button>
        </div>
      ) : null}
    </section>
  )
}

function noop() {}
