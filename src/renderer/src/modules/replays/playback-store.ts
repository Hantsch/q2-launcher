import { create } from 'zustand'
import {
  reducePlaybackView,
  type PlaybackView,
  type TimelineAction,
} from '@shared/replays/timeline'
import type { LocalizedMessage } from '@shared/types'
import type { CinemaAvailability } from '@shared/replays/cinema'
import type { ReplaysPlaybackDisplay } from '@shared/modules/replays'
import {
  onPlaybackDisplay,
  onPlaybackPosition,
  onPlaybackState,
  playbackCinema,
  playbackDisplayRead,
  playbackStop,
  playbackTimeline,
} from './client'
import {
  applyReadback,
  confirmSpeed,
  createTimeline,
  enqueue,
  giveUp,
  refuse,
  waiting,
  GIVE_UP_AFTER_MS,
  WAITING_AFTER_MS,
  type OptimisticTimeline,
  type TimelineChain,
} from './optimistic-timeline'

/**
 * Story 165: the renderer's view of the one running demo session.
 *
 * When a session begins: on `demo.play` success (`useDemoPlay` calls `beginSession`), not on the
 * first position event. Only the play action knows the demo's name and its 138 `durationMs`, and
 * the strip should appear the moment the launch is accepted rather than up to 250 ms later.
 * Position events that arrive without a session are ignored; the session ends on a `state: ended`
 * event (or an explicit `endSession`). Event subscriptions live exactly as long as the session.
 */
/** Story 187: how the running demo is shown. */
export type PlaybackMode = 'preview' | 'cinema' | 'fullscreen'

export interface PlaybackSession {
  demoName: string
  /** The playing demo's 138 `durationMs`; wins over the engine's own figure in the reducer. */
  knownDurationMs: number | null
  /** Null until the first position sample arrives. */
  view: PlaybackView | null
  /** Last speed the user set; 1x at session start. Local only - the engine has no read-back. */
  speed: number
  /** Story 172: the game window is fullscreen; the strip shows the keys text instead of stale position. */
  fullscreen: boolean
  /** Story 187: preview (the stage), cinema (the overlay) or fullscreen, from the display event. */
  mode: PlaybackMode
  /** Story 187: whether cinema can run now, and the reason key when it cannot. */
  cinemaAvailability: CinemaAvailability
  /** Story 173: a stop was requested; the session still ends only on `state: ended`. */
  stopping: boolean
  /** Story 184: the expected timeline - last readback plus commands still in flight. */
  optimistic: OptimisticTimeline
  /** Story 184: chains whose oldest pending command has waited over 1 s for its readback. */
  waiting: ReadonlySet<TimelineChain>
}

export interface StageRect {
  x: number
  y: number
  width: number
  height: number
}

interface PlaybackStoreState {
  session: PlaybackSession | null
  /** Story 170: stage mode is on from the play click until the session ends. */
  stageArmed: boolean
  /** The stage picture's last measured rect in viewport CSS px, or null. */
  stageRect: StageRect | null
  /** Why the stage could not place the game window (an i18n key), or null. */
  stageReason: { key: string } | null
  /** Invariant: true only while `stageReason` came from a display-event notice; a null notice clears just those. */
  stageReasonIsNotice: boolean
  armStage: () => void
  disarmStage: () => void
  setStageRect: (rect: StageRect | null) => void
  setStageReason: (reason: { key: string } | null) => void
  beginSession: (demoName: string, knownDurationMs: number | null) => void
  endSession: () => void
  /** Asks main to end the demo; resolves to the refusal to show, or null when the request was accepted. */
  requestStop: () => Promise<LocalizedMessage | null>
  /** Story 184: sends a timeline action optimistically; resolves to the refusal to show, or null. */
  sendTimeline: (action: TimelineAction) => Promise<LocalizedMessage | null>
  setSpeed: (speed: number) => void
  applyPosition: (
    positionMs: number | null,
    engineDurationMs: number | null,
    enginePaused?: boolean | null,
  ) => void
  applyState: (state: 'playing' | 'finished' | 'ended') => void
  /** Story 187: asks main to enter or leave cinema; resolves to the refusal to show, or null. */
  setCinema: (enter: boolean) => Promise<LocalizedMessage | null>
  applyDisplay: (p: DisplayUpdate) => void
}

/** The display event; `cinema`, `speed` and `cinemaAvailability` are optional for older callers. */
type DisplayUpdate = Pick<ReplaysPlaybackDisplay, 'fullscreen'> &
  Partial<Omit<ReplaysPlaybackDisplay, 'fullscreen'>>

let unsubscribers: Array<() => void> = []
let timers = new Set<ReturnType<typeof setTimeout>>()

function clearTimers(): void {
  for (const t of timers) clearTimeout(t)
  timers = new Set()
}

function unsubscribeAll(): void {
  for (const off of unsubscribers) off()
  unsubscribers = []
}

type SetState = (fn: (s: PlaybackStoreState) => Partial<PlaybackStoreState>) => void

/** Applies `fn` to the session's optimistic state and recomputes `waiting`. */
function update(
  set: SetState,
  fn: (o: OptimisticTimeline) => OptimisticTimeline,
  dropStale = false,
): void {
  set((s) => {
    if (s.session === null) return s
    const now = Date.now()
    let optimistic = fn(s.session.optimistic)
    if (dropStale) optimistic = giveUp(optimistic, now)
    return { session: { ...s.session, optimistic, waiting: waiting(optimistic, now) } }
  })
}

/** Re-evaluates `waiting` at +1 s and gives up stale chains at +5 s after a command was sent. */
function scheduleReevaluation(set: SetState): void {
  const at = (ms: number, dropStale: boolean): void => {
    const t = setTimeout(() => {
      timers.delete(t)
      update(set, (o) => o, dropStale)
    }, ms)
    timers.add(t)
  }
  at(WAITING_AFTER_MS, false)
  at(GIVE_UP_AFTER_MS, true)
}

export const usePlaybackStore = create<PlaybackStoreState>((set, get) => ({
  session: null,
  stageArmed: false,
  stageRect: null,
  stageReason: null,
  stageReasonIsNotice: false,
  armStage: () => set({ stageArmed: true }),
  disarmStage: () =>
    set({ stageArmed: false, stageRect: null, stageReason: null, stageReasonIsNotice: false }),
  setStageRect: (rect) =>
    set((s) => {
      const p = s.stageRect
      if (p === rect) return s
      if (
        p &&
        rect &&
        p.x === rect.x &&
        p.y === rect.y &&
        p.width === rect.width &&
        p.height === rect.height
      )
        return s
      return { stageRect: rect }
    }),
  setStageReason: (reason) => set({ stageReason: reason, stageReasonIsNotice: false }),
  beginSession: (demoName, knownDurationMs) => {
    unsubscribeAll()
    clearTimers()
    const optimistic = createTimeline({ view: null, durationMs: knownDurationMs }, Date.now())
    set({
      session: {
        demoName,
        knownDurationMs,
        view: null,
        speed: 1,
        fullscreen: false,
        mode: 'preview',
        cinemaAvailability: { available: true },
        stopping: false,
        optimistic,
        waiting: new Set(),
      },
    })
    unsubscribers = [
      onPlaybackPosition((p) => get().applyPosition(p.positionMs, p.durationMs, p.paused)),
      onPlaybackState((s) => get().applyState(s.state)),
      onPlaybackDisplay((p) => get().applyDisplay(p)),
    ]
    // The display event only fires on change; read the state the session starts in (cinema availability).
    void playbackDisplayRead()
      .then((result) => {
        if (result.ok && get().session !== null) get().applyDisplay(result.value)
      })
      .catch(() => {})
  },
  endSession: () => {
    unsubscribeAll()
    clearTimers()
    set({
      session: null,
      stageArmed: false,
      stageRect: null,
      stageReason: null,
      stageReasonIsNotice: false,
    })
  },
  requestStop: async () => {
    const setStopping = (stopping: boolean): void =>
      set((s) => (s.session === null ? s : { session: { ...s.session, stopping } }))
    setStopping(true)
    try {
      const result = await playbackStop()
      if (result.ok) return null
      setStopping(false)
      return result.error
    } catch {
      setStopping(false)
      return { key: 'replays.timeline.error' }
    }
  },
  sendTimeline: async (action) => {
    // The game window is the launcher's to toggle; it has no chain and no readback.
    if (action.kind === 'fullscreen') {
      try {
        const result = await playbackTimeline(action)
        return result.ok ? null : result.error
      } catch {
        return { key: 'replays.timeline.error' }
      }
    }
    const current = get().session
    if (current === null) return null
    const { state, id } = enqueue(current.optimistic, action, Date.now())
    update(set, () => state)
    scheduleReevaluation(set)
    const fail = (error: LocalizedMessage): LocalizedMessage => {
      update(set, (o) => refuse(o, id))
      return error
    }
    try {
      const result = await playbackTimeline(action)
      if (!result.ok) return fail(result.error)
    } catch {
      return fail({ key: 'replays.timeline.error' })
    }
    if (action.kind === 'speed') {
      update(set, (o) => confirmSpeed(o, id))
      if (get().session !== null) get().setSpeed(action.value)
    }
    return null
  },
  setSpeed: (speed) => set((s) => (s.session === null ? s : { session: { ...s.session, speed } })),
  applyPosition: (positionMs, engineDurationMs, enginePaused = null) =>
    set((s) => {
      if (s.session === null || positionMs === null) return s
      const view = reducePlaybackView(s.session.view, {
        positionMs,
        engineDurationMs,
        knownDurationMs: s.session.knownDurationMs,
        ended: s.session.view?.ended ?? false,
        enginePaused,
      })
      const now = Date.now()
      const optimistic = applyReadback(s.session.optimistic, view, now)
      return { session: { ...s.session, view, optimistic, waiting: waiting(optimistic, now) } }
    }),
  setCinema: async (enter) => {
    try {
      const result = await playbackCinema(enter)
      return result.ok ? null : result.error
    } catch {
      return { key: 'replays.timeline.error' }
    }
  },
  applyDisplay: (p) =>
    set((s) => {
      if (s.session === null) return s
      const mode: PlaybackMode = p.fullscreen ? 'fullscreen' : p.cinema ? 'cinema' : 'preview'
      const speed = p.speed ?? s.session.speed
      const cinemaAvailability = p.cinemaAvailability ?? s.session.cinemaAvailability
      const c = s.session
      // The display event's speed is authoritative: the optimistic timeline (what the speed select shows)
      // follows it unless a speed change of this window's own is still pending.
      const followSpeed = c.optimistic.speed === null && c.optimistic.confirmed.speed !== speed
      const notice = p.stageNotice
      const noticeChange =
        notice === undefined
          ? null
          : notice !== null
            ? { stageReason: notice, stageReasonIsNotice: true }
            : s.stageReasonIsNotice
              ? { stageReason: null, stageReasonIsNotice: false }
              : null
      const noticeSame =
        noticeChange === null ||
        (s.stageReasonIsNotice === noticeChange.stageReasonIsNotice &&
          JSON.stringify(s.stageReason) === JSON.stringify(noticeChange.stageReason))
      const same =
        noticeSame &&
        c.fullscreen === p.fullscreen &&
        c.mode === mode &&
        c.speed === speed &&
        !followSpeed &&
        JSON.stringify(c.cinemaAvailability) === JSON.stringify(cinemaAvailability)
      if (same) return s
      const optimistic = followSpeed
        ? { ...c.optimistic, confirmed: { ...c.optimistic.confirmed, speed } }
        : c.optimistic
      return {
        ...(noticeChange ?? {}),
        session: { ...c, fullscreen: p.fullscreen, mode, speed, cinemaAvailability, optimistic },
      }
    }),
  applyState: (state) => {
    if (state === 'ended') {
      get().endSession()
      return
    }
    if (state === 'finished') {
      set((s) => {
        if (s.session === null) return s
        const prev = s.session.view
        const view: PlaybackView = prev
          ? { ...prev, ended: true }
          : {
              positionMs: 0,
              durationMs: s.session.knownDurationMs,
              paused: false,
              ended: true,
              stillCount: 0,
            }
        return { session: { ...s.session, view } }
      })
    }
  },
}))
