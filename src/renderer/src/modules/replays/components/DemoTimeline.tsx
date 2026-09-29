import { useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Maximize, Pause, Play, RotateCcw, RotateCw } from 'lucide-react'
import type { LocalizedMessage } from '@shared/types'
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
import { useOverlayRegistration } from '../../../lib/overlay-registry'
import { cn } from '../../../lib/cn'
import { playbackTimeline } from '../client'
import { usePlaybackStore } from '../playback-store'

// `outline-solid` re-enables the outline style the shared Select's `focus:outline-none` switches off.
const FOCUS_RING =
  'focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-flame-500'

/**
 * Story 165 D3: the timeline strip docked at the bottom of the Demos view while a demo session
 * exists. The seek bar is one `role="slider"` element (keyboard + click); without a known duration
 * it is `aria-disabled` and says why as visible text. Every action goes through `playbackTimeline`
 * as a fixed action object, never console text; a refusal or a rejected call shows inline.
 */
export function DemoTimeline() {
  const { t } = useTranslation()
  const session = usePlaybackStore((state) => state.session)
  const setSpeed = usePlaybackStore((state) => state.setSpeed)
  const [error, setError] = useState<LocalizedMessage | null>(null)
  // The native speed popup paints above the page (and the game window): park the game while it is open.
  const [speedOpen, setSpeedOpen] = useState(false)
  const noElement = useRef<Element | null>(null)
  useOverlayRegistration(speedOpen, noElement, true)

  if (session === null) return null

  const view = session.view
  const durationMs = view?.durationMs ?? session.knownDurationMs
  const hasDuration = durationMs !== null && durationMs > 0
  const positionMs = view?.positionMs ?? 0
  const paused = view?.paused ?? false
  const fullscreen = session.fullscreen
  const ended = view?.ended ?? false
  const positionText = formatPlaybackPosition(positionMs)
  const durationText = hasDuration ? formatPlaybackPosition(durationMs) : t('replays.timeline.durationUnknown')
  const durationS = hasDuration ? Math.floor(durationMs / 1000) : 0
  const positionS = Math.min(durationS, Math.floor(positionMs / 1000))
  const fraction = hasDuration ? Math.min(1, positionMs / durationMs) : 0

  async function send(action: TimelineAction): Promise<boolean> {
    setError(null)
    try {
      const result = await playbackTimeline(action)
      if (!result.ok) setError(result.error)
      else if (!result.value.ok) setError(result.value.error)
      else return true
    } catch {
      setError({ key: 'replays.timeline.error' })
    }
    return false
  }

  async function enterFullscreen(): Promise<void> {
    // A paused demo would sit frozen behind the fullscreen window with no visible way to resume.
    if (paused && !(await send({ kind: 'togglePause' }))) return
    await send({ kind: 'fullscreen' })
  }

  function handleSeekClick(event: MouseEvent<HTMLDivElement>): void {
    if (!hasDuration || fullscreen) return
    const rect = event.currentTarget.getBoundingClientRect()
    const clickFraction = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0
    void send({ kind: 'seekTo', seconds: seekSecondsForFraction(clickFraction, durationMs) })
  }

  function handleSeekKey(event: KeyboardEvent<HTMLDivElement>): void {
    if (!hasDuration || fullscreen) return
    let action: TimelineAction | null = null
    switch (event.key) {
      case 'ArrowLeft':
        action = { kind: 'jump', deltaS: -JUMP_STEP_S }
        break
      case 'ArrowRight':
        action = { kind: 'jump', deltaS: JUMP_STEP_S }
        break
      case 'PageUp':
        action = { kind: 'jump', deltaS: PAGE_STEP_S }
        break
      case 'PageDown':
        action = { kind: 'jump', deltaS: -PAGE_STEP_S }
        break
      case 'Home':
        action = { kind: 'seekTo', seconds: 0 }
        break
      case 'End':
        action = { kind: 'seekTo', seconds: durationS }
        break
    }
    if (action === null) return
    event.preventDefault()
    void send(action)
  }

  const stateText = ended
    ? t('replays.timeline.stateFinished')
    : paused
      ? t('replays.timeline.statePaused')
      : t('replays.timeline.statePlaying')

  return (
    <section
      className="flex flex-col gap-1 border-t border-line bg-panel px-5 py-2"
      aria-label={t('replays.timeline.label')}
      data-testid="replays-timeline"
    >
      <div className="flex items-center gap-3">
        <span className="max-w-64 truncate text-sm text-ink" title={session.demoName}>
          {session.demoName}
        </span>
        <IconButton
          size="md"
          label={paused ? t('replays.timeline.play') : t('replays.timeline.pause')}
          disabled={fullscreen}
          onClick={() => void send({ kind: 'togglePause' })}
          className={FOCUS_RING}
          data-testid="replays-timeline-toggle"
        >
          {paused ? <Play className="size-4" /> : <Pause className="size-4" />}
        </IconButton>
        <IconButton
          size="md"
          label={t('replays.timeline.back')}
          disabled={fullscreen}
          onClick={() => void send({ kind: 'jump', deltaS: -JUMP_STEP_S })}
          className={FOCUS_RING}
          data-testid="replays-timeline-back"
        >
          <RotateCcw className="size-4" />
        </IconButton>
        <IconButton
          size="md"
          label={t('replays.timeline.forward')}
          disabled={fullscreen}
          onClick={() => void send({ kind: 'jump', deltaS: JUMP_STEP_S })}
          className={FOCUS_RING}
          data-testid="replays-timeline-forward"
        >
          <RotateCw className="size-4" />
        </IconButton>
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
          aria-disabled={!hasDuration || fullscreen}
          onClick={handleSeekClick}
          onKeyDown={handleSeekKey}
          className={cn(
            'relative h-3 min-w-24 flex-1 rounded-sm border border-line-strong bg-raised',
            hasDuration && !fullscreen ? 'cursor-pointer' : 'cursor-not-allowed opacity-60',
            FOCUS_RING,
          )}
          data-testid="replays-timeline-seek"
        >
          <div
            className="pointer-events-none h-full rounded-sm bg-flame-500"
            style={{ width: `${fullscreen ? 0 : fraction * 100}%` }}
          />
        </div>
        {!fullscreen && (
          <span className="text-sm text-ink tabular-nums">
            <span data-testid="replays-timeline-position">{positionText}</span>
            {' / '}
            <span data-testid="replays-timeline-duration">{durationText}</span>
          </span>
        )}
        <Select
          disabled={fullscreen}
          aria-label={t('replays.timeline.speed')}
          value={String(session.speed)}
          onMouseDown={() => setSpeedOpen(true)}
          onKeyDown={(event) => {
            if ((event.altKey && event.key === 'ArrowDown') || event.key === 'F4') setSpeedOpen(true)
          }}
          onBlur={() => setSpeedOpen(false)}
          onChange={(event) => {
            setSpeedOpen(false)
            const value = Number(event.target.value)
            setSpeed(value)
            void send({ kind: 'speed', value })
          }}
          options={SPEED_STEPS.map((step) => ({
            value: String(step),
            label: t('replays.timeline.speedOption', { value: step }),
          }))}
          className={cn('h-9 w-24', FOCUS_RING)}
          data-testid="replays-timeline-speed"
        />
        <IconButton
          size="md"
          label={t('replays.timeline.fullscreen')}
          disabled={ended || fullscreen}
          onClick={() => void enterFullscreen()}
          className={FOCUS_RING}
          data-testid="replays-timeline-fullscreen"
        >
          <Maximize className="size-4" />
        </IconButton>
        <span className="text-xs text-ink-muted" data-testid="replays-timeline-state">
          {stateText}
        </span>
      </div>
      {fullscreen && (
        <p className="text-xs text-ink-muted" data-testid="replays-timeline-keys">
          {t('replays.timeline.fullscreenKeys')}
        </p>
      )}
      {!hasDuration && !fullscreen && (
        <p className="text-xs text-ink-muted" data-testid="replays-timeline-seek-reason">
          {t('replays.timeline.seekNeedsDuration')}
        </p>
      )}
      {error && (
        <p className="text-xs text-danger" role="alert" data-testid="replays-timeline-error">
          {t(error.key, error.params)}
        </p>
      )}
    </section>
  )
}
