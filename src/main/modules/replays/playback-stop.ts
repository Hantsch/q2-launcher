import type { LaunchState, Outcome } from '@shared/types'
import { fail, ok } from '@shared/types'
import { NO_SESSION, type PlaybackControl } from './playback-control'

/** Story 173: how long the game gets to act on `quit` before it is terminated. */
export const STOP_EXIT_TIMEOUT_MS = 5000

/** How long a successful kill gets to produce an exit event before the stop settles without one. */
export const STOP_KILL_SETTLE_MS = 5000

/** The slice of `LaunchService` the stop needs - a fake stands in for it in tests. */
export interface PlaybackStopLaunch {
  isPlaybackRunning(): boolean
  terminatePlayback(): boolean
  /** Ends a killed launch that never reported its exit, through the launch's own exit chain. */
  settleKilledPlayback(): void
  onStateChange(listener: (state: LaunchState) => void): () => void
}

/**
 * Story 173: `playback.stop` - quit first, then terminate. The game is asked to `quit` over the
 * playback channel; if it has not exited after `timeoutMs` it is terminated. A refused quit (the
 * demo already finished, the Windows loop stopped) terminates at once. Either way the end arrives
 * as that launch's ordinary exit: the pending stop and its timer are dropped the moment the launch
 * reaches `exited`/`failed`, which is what keeps a late timer from ever terminating a later launch.
 * Only a kill that succeeded yet produced no exit within `killSettleMs` settles the launch itself.
 */
export interface PlaybackStop {
  stop(): Outcome<void>
  /** Drops the launch observer and any pending timer; a stop after this never resubscribes. */
  dispose(): void
}

export function createPlaybackStop(deps: {
  playback: Pick<PlaybackControl, 'send'>
  launch: PlaybackStopLaunch
  timeoutMs?: number
  killSettleMs?: number
}): PlaybackStop {
  const { playback, launch } = deps
  const timeoutMs = deps.timeoutMs ?? STOP_EXIT_TIMEOUT_MS
  const killSettleMs = deps.killSettleMs ?? STOP_KILL_SETTLE_MS
  let pending = false
  let timer: ReturnType<typeof setTimeout> | null = null

  const settle = (): void => {
    if (timer !== null) clearTimeout(timer)
    timer = null
    pending = false
  }

  // A kill that succeeded normally ends in an exit event; when none arrives the launch is settled
  // through its own exit chain, so the session, follower and cvar restore end as for any exit.
  const terminate = (): void => {
    if (!launch.terminatePlayback()) {
      settle()
      return
    }
    timer = setTimeout(() => {
      settle()
      launch.settleKilledPlayback()
    }, killSettleMs)
  }

  // Subscribed on first use, like the playback control, so a module that never stops a demo never
  // touches the launch service's observers.
  let subscribed = false
  let disposed = false
  let unsubscribe: (() => void) | null = null
  const subscribe = (): void => {
    if (subscribed || disposed) return
    subscribed = true
    unsubscribe = launch.onStateChange((state) => {
      if (state.phase === 'exited' || state.phase === 'failed') settle()
    })
  }

  return {
    stop() {
      if (disposed) return fail(NO_SESSION)
      if (!launch.isPlaybackRunning()) return fail(NO_SESSION)
      if (pending) return ok(undefined)
      subscribe()
      pending = true
      if (!playback.send('quit').ok) {
        // Nothing is listening for `quit` any more: terminate now. A kill that reached nothing
        // leaves no exit to wait for, so the stop is not left pending.
        terminate()
        return ok(undefined)
      }
      timer = setTimeout(() => {
        timer = null
        terminate()
      }, timeoutMs)
      return ok(undefined)
    },
    dispose() {
      disposed = true
      settle()
      unsubscribe?.()
      unsubscribe = null
    },
  }
}
