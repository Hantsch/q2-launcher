import { useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AppWindow,
  Maximize2,
  MessageSquarePlus,
  MonitorPlay,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Square,
} from 'lucide-react'
import type { LocalizedMessage } from '@shared/types'
import type { DemoRow } from '@shared/modules/replays'
import { SIDECAR_LIMITS } from '@shared/replays/sidecar'
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
import { usePlaybackStore } from '../playback-store'
import type { RowPatcher } from '../demo-editor-store'
import { VolumeControl } from './VolumeControl'
import { CommentField, CommentMarks } from './TimelineComments'
import {
  createTimeline,
  expected,
  type ExpectedTimeline,
  type OptimisticTimeline,
} from '../optimistic-timeline'

// `outline-solid` re-enables the outline style the shared Select's `focus:outline-none` switches off.
// Only read when there is no session, where the component renders nothing anyway.
const createEmpty = createTimeline({ view: null }, 0)

const FOCUS_RING =
  'focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-flame-500'

/**
 * Story 184: the expected timeline at this instant. While the demo plays in the window the
 * position moves between readbacks, so the component re-renders once per animation frame.
 */
export function useExpectedTimeline(
  optimistic: OptimisticTimeline,
  running: boolean,
): ExpectedTimeline {
  const [, setFrame] = useState(0)
  const now = Date.now()
  const current = expected(optimistic, now)
  const animate = running && !current.paused
  useEffect(() => {
    if (!animate) return
    let handle = requestAnimationFrame(function tick() {
      setFrame((n) => n + 1)
      handle = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(handle)
  }, [animate])
  return current
}

export interface DemoTimelineProps {
  /** The session's demo row, when the list holds it; without it the strip offers no comments. */
  demo?: DemoRow | null
  onRowPatched?: RowPatcher
}

/**
 * Story 165: the timeline strip docked at the bottom of the Demos view while a demo session
 * exists. The seek bar is one `role="slider"` element (keyboard + click); without a known duration
 * it is `aria-disabled` and says why as visible text. Every action goes through `playbackTimeline`
 * as a fixed action object, never console text; a refusal or a rejected call shows inline.
 */
export function DemoTimeline({ demo = null, onRowPatched }: DemoTimelineProps) {
  const { t } = useTranslation()
  const session = usePlaybackStore((state) => state.session)
  const sendTimeline = usePlaybackStore((state) => state.sendTimeline)
  const requestStop = usePlaybackStore((state) => state.requestStop)
  const setCinema = usePlaybackStore((state) => state.setCinema)
  const setVolume = usePlaybackStore((state) => state.setVolume)
  const [error, setError] = useState<LocalizedMessage | null>(null)
  // The native speed popup paints above the page (and the game window): park the game while it is open.
  const [speedOpen, setSpeedOpen] = useState(false)
  const noElement = useRef<Element | null>(null)
  useOverlayRegistration(speedOpen, noElement, true)
  const waitingId = useId()
  const cinemaReasonId = useId()
  const commentReasonId = useId()
  const [composing, setComposing] = useState<{ demoId: string; atMs: number } | null>(null)
  const addCommentRef = useRef<HTMLButtonElement>(null)
  const optimistic = session?.optimistic
  const shown = useExpectedTimeline(
    optimistic ?? createEmpty,
    session !== null && !session.fullscreen && !(session.view?.ended ?? false),
  )

  if (session === null) return null

  const view = session.view
  const durationMs = view?.durationMs ?? session.knownDurationMs
  const hasDuration = durationMs !== null && durationMs > 0
  const displayedMs = shown.positionMs
  const positionMs = displayedMs
  const paused = shown.paused
  const fullscreen = session.fullscreen
  const inCinema = session.mode === 'cinema'
  const cinemaReason = session.cinemaAvailability.available
    ? null
    : session.cinemaAvailability.reason
  const ended = view?.ended ?? false
  // Leaving cinema is always possible; entering needs availability and a demo that has not ended.
  const cinemaBlocked = !inCinema && (cinemaReason !== null || ended)
  const positionText = formatPlaybackPosition(positionMs)
  const durationText = hasDuration
    ? formatPlaybackPosition(durationMs)
    : t('replays.timeline.durationUnknown')
  const durationS = hasDuration ? Math.floor(durationMs / 1000) : 0
  const positionS = Math.min(durationS, Math.floor(positionMs / 1000))
  const fraction = hasDuration ? Math.min(1, positionMs / durationMs) : 0

  async function send(action: TimelineAction): Promise<boolean> {
    setError(null)
    const refusal = await sendTimeline(action)
    if (refusal) setError(refusal)
    return refusal === null
  }

  const waitingChain = session.waiting.has('pause')
    ? 'pause'
    : session.waiting.has('position')
      ? 'seek'
      : session.waiting.has('speed')
        ? 'speed'
        : null
  const busy = (chain: 'pause' | 'seek' | 'speed') =>
    waitingChain === chain ? { 'aria-busy': true as const, 'aria-describedby': waitingId } : {}

  const comments = demo?.sidecar.values.comments ?? []
  const commentReason =
    demo === null
      ? null
      : session.archived
        ? 'replays.comments.archiveReadOnly'
        : comments.length >= SIDECAR_LIMITS.comments
          ? 'replays.comments.error.limit'
          : null
  const canComment = demo !== null && onRowPatched !== undefined && session.demoId === demo.id
  const showMarks = canComment && hasDuration && !fullscreen && comments.length > 0

  async function startComment(): Promise<void> {
    if (!canComment || fullscreen || commentReason !== null) return
    // Pinned to what the strip shows at the click, before the pause round-trip moves the clock.
    const clicked = hasDuration ? Math.min(durationMs, displayedMs) : displayedMs
    const atMs = Math.max(0, Math.round(clicked))
    if (!paused && !ended && !(await send({ kind: 'togglePause' }))) return
    setComposing({ demoId: demo.id, atMs })
  }

  function closeComment(): void {
    setComposing(null)
    addCommentRef.current?.focus()
  }

  async function stop(): Promise<void> {
    setError(null)
    const refusal = await requestStop()
    if (refusal) setError(refusal)
  }

  async function enterFullscreen(): Promise<void> {
    // A paused demo would sit frozen behind the fullscreen window with no visible way to resume.
    if (paused && !(await send({ kind: 'togglePause' }))) return
    await send({ kind: 'fullscreen' })
  }

  async function changeVolume(volume: { percent: number; muted: boolean }): Promise<void> {
    setError(null)
    const refusal = await setVolume(volume)
    if (refusal) setError(refusal)
  }

  async function toggleCinema(): Promise<void> {
    if (cinemaBlocked) return
    setError(null)
    const refusal = await setCinema(!inCinema)
    if (refusal) setError(refusal)
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
      className="flex flex-col gap-1 border-t border-line bg-panel px-5 pt-1 pb-2"
      aria-label={t('common.label.demoPlayback')}
      data-testid="replays-timeline"
    >
      {/* YouTube-style: the seek bar spans the full strip above the controls; the element itself is
          a taller hit area around a thin track that thickens on hover. */}
      <div className="relative">
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
            'group relative flex h-5 items-center rounded-sm',
            hasDuration && !fullscreen ? 'cursor-pointer' : 'cursor-not-allowed opacity-60',
            FOCUS_RING,
          )}
          data-testid="replays-timeline-seek"
          data-position-ms={Math.round(displayedMs)}
          {...busy('seek')}
        >
          <div className="pointer-events-none relative h-1.5 w-full rounded-full bg-line-strong transition-[height] group-hover:h-2.5">
            <div
              className="h-full rounded-full bg-flame-500"
              style={{ width: `${fullscreen ? 0 : fraction * 100}%` }}
            />
            {hasDuration && !fullscreen && (
              <div
                className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-flame-500 opacity-0 transition-opacity group-hover:opacity-100"
                style={{ left: `${fraction * 100}%` }}
              />
            )}
          </div>
        </div>
        {showMarks && (
          <CommentMarks
            comments={comments}
            durationMs={durationMs}
            onSeek={(seconds) => void send({ kind: 'seekTo', seconds })}
            focusRing={FOCUS_RING}
          />
        )}
      </div>
      {canComment && composing !== null && composing.demoId === demo.id && !fullscreen && (
        <CommentField
          demoId={demo.id}
          atMs={composing.atMs}
          onRowPatched={onRowPatched}
          onClose={closeComment}
        />
      )}
      <div className="flex items-center gap-1">
        <IconButton
          size="lg"
          label={paused ? t('common.action.play') : t('replays.timeline.pause')}
          disabled={fullscreen}
          onClick={() => void send({ kind: 'togglePause' })}
          className={FOCUS_RING}
          data-testid="replays-timeline-toggle"
          {...busy('pause')}
        >
          {paused ? <Play className="size-7" /> : <Pause className="size-7" />}
        </IconButton>
        <IconButton
          size="lg"
          label={t('replays.timeline.back')}
          disabled={fullscreen}
          onClick={() => void send({ kind: 'jump', deltaS: -JUMP_STEP_S })}
          className={FOCUS_RING}
          data-testid="replays-timeline-back"
          {...busy('seek')}
        >
          <RotateCcw className="size-6" />
        </IconButton>
        <IconButton
          size="lg"
          label={t('replays.timeline.forward')}
          disabled={fullscreen}
          onClick={() => void send({ kind: 'jump', deltaS: JUMP_STEP_S })}
          className={FOCUS_RING}
          data-testid="replays-timeline-forward"
          {...busy('seek')}
        >
          <RotateCw className="size-6" />
        </IconButton>
        {!fullscreen && (
          <span className="ml-2 text-base text-ink tabular-nums">
            <span data-testid="replays-timeline-position">{positionText}</span>
            {' / '}
            <span data-testid="replays-timeline-duration">{durationText}</span>
          </span>
        )}
        <span
          className="ml-4 min-w-0 flex-1 truncate text-sm text-ink-muted"
          title={session.demoName}
        >
          {session.demoName}
        </span>
        {waitingChain === null ? (
          <span className="mr-2 text-sm text-ink-muted" data-testid="replays-timeline-state">
            {stateText}
          </span>
        ) : (
          <span
            id={waitingId}
            className="mr-2 text-sm text-ink-muted"
            data-testid="replays-timeline-waiting"
          >
            {t(`replays.timeline.waiting.${waitingChain}`)}
          </span>
        )}
        <VolumeControl
          volume={session.volume}
          disabled={fullscreen}
          focusRing={FOCUS_RING}
          onChange={(volume) => void changeVolume(volume)}
        />
        <Select
          disabled={fullscreen}
          aria-label={t('replays.timeline.speed')}
          value={String(shown.speed)}
          onMouseDown={() => setSpeedOpen(true)}
          onKeyDown={(event) => {
            if ((event.altKey && event.key === 'ArrowDown') || event.key === 'F4')
              setSpeedOpen(true)
          }}
          onBlur={() => setSpeedOpen(false)}
          onChange={(event) => {
            setSpeedOpen(false)
            const value = Number(event.target.value)
            void send({ kind: 'speed', value })
          }}
          options={SPEED_STEPS.map((step) => ({
            value: String(step),
            label: t('replays.timeline.speedOption', { value: step }),
          }))}
          className={cn('h-11! w-24', FOCUS_RING)}
          data-testid="replays-timeline-speed"
          {...busy('speed')}
        />
        {canComment && (
          <IconButton
            ref={addCommentRef}
            size="lg"
            label={t('replays.comments.add')}
            disabled={fullscreen}
            // Stays focusable when refused so its reason is reachable.
            aria-disabled={commentReason !== null || undefined}
            aria-describedby={commentReason !== null ? commentReasonId : undefined}
            onClick={() => void startComment()}
            className={cn(FOCUS_RING, commentReason !== null && 'cursor-not-allowed opacity-45')}
            data-testid="replays-timeline-add-comment"
          >
            <MessageSquarePlus className="size-6" />
          </IconButton>
        )}
        {/* Story 187: YouTube-style view buttons - cinema (theater) and fullscreen; none once fullscreen. */}
        {!fullscreen && (
          <>
            <IconButton
              size="lg"
              label={
                inCinema ? t('replays.timeline.cinema.leave') : t('replays.timeline.cinema.enter')
              }
              // Stays focusable when unavailable so its reason is reachable.
              aria-disabled={cinemaBlocked || undefined}
              aria-describedby={cinemaReason !== null && !inCinema ? cinemaReasonId : undefined}
              onClick={() => void toggleCinema()}
              className={cn(FOCUS_RING, cinemaBlocked && 'cursor-not-allowed opacity-45')}
              data-testid="replays-timeline-cinema"
              data-mode={session.mode}
            >
              {/* Three distinct shapes: monitor+play enters cinema, the app window returns to it,
                  diagonal arrows go fullscreen, the filled square stops. */}
              {inCinema ? <AppWindow className="size-6" /> : <MonitorPlay className="size-6" />}
            </IconButton>
            <IconButton
              size="lg"
              label={t('common.label.fullscreen')}
              disabled={ended}
              onClick={() => void enterFullscreen()}
              className={FOCUS_RING}
              data-testid="replays-timeline-fullscreen"
            >
              <Maximize2 className="size-6" />
            </IconButton>
          </>
        )}
        <IconButton
          size="lg"
          label={session.stopping ? t('common.action.stopping') : t('common.action.stopDemo')}
          disabled={session.stopping}
          onClick={() => void stop()}
          className={FOCUS_RING}
          data-testid="replays-timeline-stop"
        >
          <Square className="size-5 fill-current" />
        </IconButton>
      </div>
      {fullscreen && (
        <p className="text-xs text-ink-muted" data-testid="replays-timeline-keys">
          {t('replays.timeline.fullscreenKeys')}
        </p>
      )}
      {cinemaReason !== null && !fullscreen && !inCinema && (
        <p
          id={cinemaReasonId}
          className="text-xs text-ink-muted"
          data-testid="replays-timeline-cinema-reason"
        >
          {t(cinemaReason.key)}
        </p>
      )}
      {canComment && commentReason !== null && !fullscreen && (
        <p
          id={commentReasonId}
          className="text-xs text-ink-muted"
          data-testid="replays-timeline-comment-reason"
        >
          {t(commentReason)}
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
