import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AppWindow,
  FastForward,
  Maximize2,
  Pause,
  Play,
  Rewind,
  RotateCcw,
  RotateCw,
} from 'lucide-react'
import type { LocalizedMessage } from '@shared/types'
import { CINEMA_IDLE_MS, cinemaKeyAction } from '@shared/replays/cinema'
import {
  JUMP_STEP_S,
  PAGE_STEP_S,
  SPEED_STEPS,
  formatPlaybackPosition,
  seekSecondsForFraction,
  type TimelineAction,
} from '@shared/replays/timeline'
import { IconButton } from '../../../components/ui/Button'
import { Select } from '../../../components/ui/controls'
import { cn } from '../../../lib/cn'
import { usePlaybackStore } from '../playback-store'
import { createTimeline } from '../optimistic-timeline'
import { useExpectedTimeline } from '../components/DemoTimeline'
import { useIdleFade } from './useIdleFade'

const FOCUS_RING =
  'focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-flame-500'
const createEmpty = createTimeline({ view: null }, 0)

/**
 * Story 187 D7: the controls of the transparent cinema overlay. The overlay window is its own
 * renderer, so it runs its own playback session in the shared store (fed by the position/display
 * events main broadcasts) and sends the same timeline actions as the launcher's strip.
 * The bar fades after `CINEMA_IDLE_MS` of no input; a click on the picture only brings it back.
 */
export function CinemaOverlay() {
  const { t } = useTranslation()
  const session = usePlaybackStore((state) => state.session)
  const beginSession = usePlaybackStore((state) => state.beginSession)
  const sendTimeline = usePlaybackStore((state) => state.sendTimeline)
  const setCinema = usePlaybackStore((state) => state.setCinema)
  const rootRef = useRef<HTMLDivElement>(null)
  const [hovered, setHovered] = useState(false)
  const [error, setError] = useState<LocalizedMessage | null>(null)

  useEffect(() => {
    if (usePlaybackStore.getState().session === null) beginSession('', null)
    rootRef.current?.focus()
  }, [beginSession])

  const shown = useExpectedTimeline(
    session?.optimistic ?? createEmpty,
    session !== null && !session.fullscreen,
  )
  const paused = shown.paused
  const { visible, show } = useIdleFade(CINEMA_IDLE_MS, hovered || paused)

  const view = session?.view ?? null
  const durationMs = view?.durationMs ?? session?.knownDurationMs ?? null
  const hasDuration = durationMs !== null && durationMs > 0
  const positionText = formatPlaybackPosition(shown.positionMs)
  const durationText = hasDuration
    ? formatPlaybackPosition(durationMs)
    : t('replays.timeline.durationUnknown')
  const durationS = hasDuration ? Math.floor(durationMs / 1000) : 0
  const positionS = Math.min(durationS, Math.floor(shown.positionMs / 1000))
  const fraction = hasDuration ? Math.min(1, shown.positionMs / durationMs) : 0

  async function send(action: TimelineAction): Promise<boolean> {
    setError(null)
    const refusal = await sendTimeline(action)
    if (refusal) setError(refusal)
    return refusal === null
  }

  async function fullscreen(): Promise<void> {
    // A paused demo would sit frozen behind the fullscreen window with no visible way to resume.
    if (paused && !(await send({ kind: 'togglePause' }))) return
    await send({ kind: 'fullscreen' })
  }

  async function leave(): Promise<void> {
    setError(null)
    const refusal = await setCinema(false)
    if (refusal) setError(refusal)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    show()
    const action = cinemaKeyAction(
      { key: event.key, code: event.code, shiftKey: event.shiftKey },
      usePlaybackStore.getState().session?.speed ?? shown.speed,
    )
    if (action === null) return
    // Keep a focused button from also activating on Space.
    event.preventDefault()
    if (action.kind === 'leave') void leave()
    else if (action.kind === 'fullscreen') void fullscreen()
    else void send(action)
  }

  function handleSeekClick(event: MouseEvent<HTMLDivElement>): void {
    if (!hasDuration) return
    const rect = event.currentTarget.getBoundingClientRect()
    const clickFraction = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0
    void send({ kind: 'seekTo', seconds: seekSecondsForFraction(clickFraction, durationMs) })
  }

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      className="relative size-full outline-none"
      data-testid="cinema-root"
      data-controls={visible ? 'visible' : 'hidden'}
      onKeyDown={handleKeyDown}
      onMouseMove={show}
      onClick={show}
      onDoubleClick={show}
    >
      {session !== null && (
        <section
          aria-label={t('replays.timeline.cinema.label')}
          data-testid="cinema-controls"
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          className={cn(
            'absolute inset-x-0 bottom-0 flex flex-col gap-1 bg-panel/90 px-5 pt-1 pb-2 transition-opacity duration-300',
            visible ? 'opacity-100' : 'pointer-events-none opacity-0',
          )}
        >
          <div
            role="slider"
            tabIndex={0}
            aria-label={t('replays.timeline.seek')}
            aria-valuemin={0}
            aria-valuemax={durationS}
            aria-valuenow={positionS}
            aria-valuetext={t('replays.timeline.seekValueText', {
              position: positionText,
              duration: durationText,
            })}
            aria-disabled={!hasDuration}
            onClick={handleSeekClick}
            className={cn(
              'group relative flex h-5 items-center rounded-sm',
              hasDuration ? 'cursor-pointer' : 'cursor-not-allowed opacity-60',
              FOCUS_RING,
            )}
            data-testid="cinema-seek"
            data-position-ms={Math.round(shown.positionMs)}
          >
            <div className="pointer-events-none relative h-1.5 w-full rounded-full bg-line-strong transition-[height] group-hover:h-2.5">
              <div
                className="h-full rounded-full bg-flame-500"
                style={{ width: `${fraction * 100}%` }}
              />
            </div>
          </div>
          <div className="flex items-center gap-1">
            <IconButton
              size="lg"
              label={paused ? t('replays.timeline.play') : t('replays.timeline.pause')}
              onClick={() => void send({ kind: 'togglePause' })}
              className={FOCUS_RING}
              data-testid="cinema-toggle"
            >
              {paused ? <Play className="size-7" /> : <Pause className="size-7" />}
            </IconButton>
            <IconButton
              size="lg"
              label={t('replays.timeline.cinema.back60')}
              onClick={() => void send({ kind: 'jump', deltaS: -PAGE_STEP_S })}
              className={FOCUS_RING}
              data-testid="cinema-back60"
            >
              <Rewind className="size-6" />
            </IconButton>
            <IconButton
              size="lg"
              label={t('replays.timeline.back')}
              onClick={() => void send({ kind: 'jump', deltaS: -JUMP_STEP_S })}
              className={FOCUS_RING}
              data-testid="cinema-back"
            >
              <RotateCcw className="size-6" />
            </IconButton>
            <IconButton
              size="lg"
              label={t('replays.timeline.forward')}
              onClick={() => void send({ kind: 'jump', deltaS: JUMP_STEP_S })}
              className={FOCUS_RING}
              data-testid="cinema-forward"
            >
              <RotateCw className="size-6" />
            </IconButton>
            <IconButton
              size="lg"
              label={t('replays.timeline.cinema.forward60')}
              onClick={() => void send({ kind: 'jump', deltaS: PAGE_STEP_S })}
              className={FOCUS_RING}
              data-testid="cinema-forward60"
            >
              <FastForward className="size-6" />
            </IconButton>
            <span className="ml-2 text-base text-ink tabular-nums">
              <span data-testid="cinema-position">{positionText}</span>
              {' / '}
              <span data-testid="cinema-duration">{durationText}</span>
            </span>
            <span className="flex-1" />
            {error && (
              <span className="mr-2 text-sm text-danger" role="alert" data-testid="cinema-error">
                {t(error.key, error.params)}
              </span>
            )}
            <Select
              aria-label={t('replays.timeline.speed')}
              value={String(shown.speed)}
              onChange={(event) => void send({ kind: 'speed', value: Number(event.target.value) })}
              options={SPEED_STEPS.map((step) => ({
                value: String(step),
                label: t('replays.timeline.speedOption', { value: step }),
              }))}
              className={cn('h-11! w-24', FOCUS_RING)}
              data-testid="cinema-speed"
            />
            <IconButton
              size="lg"
              label={t('replays.timeline.cinema.leave')}
              onClick={() => void leave()}
              className={FOCUS_RING}
              data-testid="cinema-leave"
            >
              {/* The launcher strip's cinema toggle in its "in cinema" state: back to the window. */}
              <AppWindow className="size-6" />
            </IconButton>
            <IconButton
              size="lg"
              label={t('replays.timeline.fullscreen')}
              onClick={() => void fullscreen()}
              className={FOCUS_RING}
              data-testid="cinema-fullscreen"
            >
              <Maximize2 className="size-6" />
            </IconButton>
          </div>
        </section>
      )}
    </div>
  )
}
