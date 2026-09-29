import { create } from 'zustand'
import { reducePlaybackView, type PlaybackView } from '@shared/replays/timeline'
import type { LocalizedMessage } from '@shared/types'
import { onPlaybackDisplay, onPlaybackPosition, onPlaybackState, playbackStop } from './client'

/**
 * Story 165 D3: the renderer's view of the one running demo session.
 *
 * When a session begins: on `demo.play` success (`DemoPlayAction` calls `beginSession`), not on the
 * first position event. Only the play action knows the demo's name and its 138 `durationMs`, and
 * the strip should appear the moment the launch is accepted rather than up to 250 ms later.
 * Position events that arrive without a session are ignored; the session ends on a `state: ended`
 * event (or an explicit `endSession`). Event subscriptions live exactly as long as the session.
 */
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
  /** Story 173: a stop was requested; the session still ends only on `state: ended`. */
  stopping: boolean
}

export interface StageRect {
  x: number
  y: number
  width: number
  height: number
}

interface PlaybackStoreState {
  session: PlaybackSession | null
  /** Story 170 D4: stage mode is on from the play click until the session ends. */
  stageArmed: boolean
  /** The stage picture's last measured rect in viewport CSS px, or null. */
  stageRect: StageRect | null
  /** Why the stage could not place the game window (an i18n key), or null. */
  stageReason: { key: string } | null
  armStage: () => void
  disarmStage: () => void
  setStageRect: (rect: StageRect | null) => void
  setStageReason: (reason: { key: string } | null) => void
  beginSession: (demoName: string, knownDurationMs: number | null) => void
  endSession: () => void
  /** Asks main to end the demo; resolves to the refusal to show, or null when the request was accepted. */
  requestStop: () => Promise<LocalizedMessage | null>
  setSpeed: (speed: number) => void
  applyPosition: (positionMs: number | null, engineDurationMs: number | null) => void
  applyState: (state: 'playing' | 'finished' | 'ended') => void
  applyDisplay: (p: { fullscreen: boolean }) => void
}

let unsubscribers: Array<() => void> = []

function unsubscribeAll(): void {
  for (const off of unsubscribers) off()
  unsubscribers = []
}

export const usePlaybackStore = create<PlaybackStoreState>((set, get) => ({
  session: null,
  stageArmed: false,
  stageRect: null,
  stageReason: null,
  armStage: () => set({ stageArmed: true }),
  disarmStage: () => set({ stageArmed: false, stageRect: null, stageReason: null }),
  setStageRect: (rect) =>
    set((s) => {
      const p = s.stageRect
      if (p === rect) return s
      if (p && rect && p.x === rect.x && p.y === rect.y && p.width === rect.width && p.height === rect.height) return s
      return { stageRect: rect }
    }),
  setStageReason: (reason) => set({ stageReason: reason }),
  beginSession: (demoName, knownDurationMs) => {
    unsubscribeAll()
    set({ session: { demoName, knownDurationMs, view: null, speed: 1, fullscreen: false, stopping: false } })
    unsubscribers = [
      onPlaybackPosition((p) => get().applyPosition(p.positionMs, p.durationMs)),
      onPlaybackState((s) => get().applyState(s.state)),
      onPlaybackDisplay((p) => get().applyDisplay(p)),
    ]
  },
  endSession: () => {
    unsubscribeAll()
    set({ session: null, stageArmed: false, stageRect: null, stageReason: null })
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
  setSpeed: (speed) =>
    set((s) => (s.session === null ? s : { session: { ...s.session, speed } })),
  applyPosition: (positionMs, engineDurationMs) =>
    set((s) => {
      if (s.session === null || positionMs === null) return s
      const view = reducePlaybackView(s.session.view, {
        positionMs,
        engineDurationMs,
        knownDurationMs: s.session.knownDurationMs,
        ended: s.session.view?.ended ?? false,
      })
      return { session: { ...s.session, view } }
    }),
  applyDisplay: (p) =>
    set((s) =>
      s.session === null || s.session.fullscreen === p.fullscreen
        ? s
        : { session: { ...s.session, fullscreen: p.fullscreen } },
    ),
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
          : { positionMs: 0, durationMs: s.session.knownDurationMs, paused: false, ended: true, stillCount: 0 }
        return { session: { ...s.session, view } }
      })
    }
  },
}))
