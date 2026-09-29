import { create } from 'zustand'
import { reducePlaybackView, type PlaybackView } from '@shared/replays/timeline'
import { onPlaybackPosition, onPlaybackState } from './client'

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
}

interface PlaybackStoreState {
  session: PlaybackSession | null
  beginSession: (demoName: string, knownDurationMs: number | null) => void
  endSession: () => void
  setSpeed: (speed: number) => void
  applyPosition: (positionMs: number | null, engineDurationMs: number | null) => void
  applyState: (state: 'playing' | 'finished' | 'ended') => void
}

let unsubscribers: Array<() => void> = []

function unsubscribeAll(): void {
  for (const off of unsubscribers) off()
  unsubscribers = []
}

export const usePlaybackStore = create<PlaybackStoreState>((set, get) => ({
  session: null,
  beginSession: (demoName, knownDurationMs) => {
    unsubscribeAll()
    set({ session: { demoName, knownDurationMs, view: null, speed: 1 } })
    unsubscribers = [
      onPlaybackPosition((p) => get().applyPosition(p.positionMs, p.durationMs)),
      onPlaybackState((s) => get().applyState(s.state)),
    ]
  },
  endSession: () => {
    unsubscribeAll()
    set({ session: null })
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
