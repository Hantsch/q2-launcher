import type { ReplaysStageRect } from '@shared/modules/replays'
import type { Outcome } from '@shared/types'

/**
 * Story 171 D1: the stage follower. The launcher's stage rect (and window) moves; the game window
 * follows it by console lines. While the launcher is being dragged/resized, minimized or has no
 * stage, the game window is parked off the virtual desktop (immediately, once); otherwise it is
 * placed at the stage geometry after 250 ms without a new input. Pure logic: the clock and the
 * console channel are injected, the rect -> `WxH+X+Y` math is story 170's `stageGeometry`.
 */
export const STAGE_FOLLOW_QUIET_MS = 250

/**
 * Frames between a geometry's set and its re-set. On Windows a `win_*` change repositions the game
 * window from its old rect and writes that rect back into `vid_geometry` - on the next event pump and
 * again when the resulting window messages arrive - so a geometry landing in the same control-loop
 * pass as `win_alwaysontop` is silently undone (cinema's pin right after the click that focused the
 * launcher). The re-set a few frames later is a no-op when the first one took (Q2PRO ignores an
 * unchanged cvar) and puts the rect back when it did not. Measured against Q2PRO: 3 frames suffice.
 */
export const GEOMETRY_RESET_WAIT_FRAMES = 5

/** The console line that places the game window at `geometry` and survives a same-pass `win_*` change. */
export function geometryLine(geometry: string): string {
  return `set vid_geometry ${geometry}; wait ${GEOMETRY_RESET_WAIT_FRAMES}; set vid_geometry ${geometry}`
}

export interface StageFollowWindow {
  contentBounds: { x: number; y: number }
  scaleFactor: number
  minimized: boolean
  focused: boolean
}

export interface StageFollowInput {
  stageRect: ReplaysStageRect | null
  window: StageFollowWindow
  /** True when this input is a window move/resize tick. */
  tick?: boolean
}

export interface StageFollower {
  update(input: StageFollowInput): void
  /**
   * Story 187 D2: pin the game window to `geometry` (cinema). While pinned only that geometry is sent,
   * the always-on-top flag is frozen and focus/blur/move inputs are ignored. `null` unpins and re-sends
   * the current stage geometry.
   */
  pin(geometry: string | null): void
  dispose(): void
}

export interface StageFollowerDeps {
  /** Sends one console line; a failure (busy included) keeps the value desired for a retry. */
  send: (line: string) => Outcome<void>
  computeGeometry: (stageRect: ReplaysStageRect, window: StageFollowWindow) => string
  /** The same WxH as `geometry`, moved beyond the virtual desktop's right edge (+64 px), same Y. */
  parkGeometry: (geometry: string) => string
  /** The geometry the game window was launched at; the follower starts out placed there. */
  launchGeometry: string
  /**
   * Owns the game window's always-on-top flag out of band (X11): the top decision goes to `setTop`
   * instead of a `win_alwaysontop` console line, and every geometry the follower places is reported
   * through `placed` in the same `WxH+X+Y` form. Absent: the console line is used.
   */
  windowState?: { setTop(top: 0 | 1): Outcome<void>; placed(geometry: string): void }
  now?: () => number
  setTimeout?: (fn: () => void, ms: number) => unknown
  clearTimeout?: (handle: unknown) => void
}

export function createStageFollower(deps: StageFollowerDeps): StageFollower {
  const now = deps.now ?? Date.now
  const setT = deps.setTimeout ?? ((fn, ms) => setTimeout(fn, ms))
  const clearT = deps.clearTimeout ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>))

  let placedGeo = deps.launchGeometry
  let desiredGeo = deps.launchGeometry
  let sentGeo = deps.launchGeometry
  let desiredIsPark = false
  let sentIsPark = false
  let desiredTop = 1
  let sentTop = 1
  let lastTickAt = Number.NEGATIVE_INFINITY
  let quietTimer: unknown = null
  let retryTimer: unknown = null
  let disposed = false
  let pinned: string | null = null

  deps.windowState?.placed(deps.launchGeometry)

  function clearQuiet(): void {
    if (quietTimer !== null) clearT(quietTimer)
    quietTimer = null
  }

  function scheduleQuiet(): void {
    quietTimer = setT(() => {
      quietTimer = null
      desiredGeo = placedGeo
      desiredIsPark = false
      flush()
    }, STAGE_FOLLOW_QUIET_MS)
  }

  // Sends are synchronous, so at most one command per kind is ever in flight.
  function flush(): void {
    if (disposed) return
    let failed = false
    if (pinned === null && desiredTop !== sentTop) {
      const topped = deps.windowState
        ? deps.windowState.setTop(desiredTop === 1 ? 1 : 0)
        : deps.send(`set win_alwaysontop ${desiredTop}`)
      if (topped.ok) sentTop = desiredTop
      else failed = true
    }
    if (desiredGeo !== sentGeo) {
      if (deps.send(geometryLine(desiredGeo)).ok) {
        sentGeo = desiredGeo
        sentIsPark = desiredIsPark
        deps.windowState?.placed(sentGeo)
      } else failed = true
    }
    if (failed && retryTimer === null) {
      retryTimer = setT(() => {
        retryTimer = null
        flush()
      }, STAGE_FOLLOW_QUIET_MS)
    }
  }

  return {
    update(input) {
      if (disposed) return
      const t = now()
      if (input.tick === true) lastTickAt = t
      if (input.stageRect !== null) placedGeo = deps.computeGeometry(input.stageRect, input.window)
      if (pinned !== null) return
      desiredTop = input.window.focused ? 1 : 0
      const moving = t - lastTickAt < STAGE_FOLLOW_QUIET_MS
      const parked = input.stageRect === null || input.window.minimized
      clearQuiet()
      if (parked || moving) {
        // Once parked, stay put: the park line follows the stage's Y, and a diagonal drag must not
        // queue one park command per step.
        if (sentIsPark) {
          desiredGeo = sentGeo
        } else {
          desiredGeo = deps.parkGeometry(placedGeo)
        }
        desiredIsPark = true
        // A drag ends by silence: place once no tick has arrived for the quiet period.
        if (!parked) scheduleQuiet()
      } else {
        scheduleQuiet()
        // Not moving: the last desired geometry stands (the placed one only after the quiet timer).
      }
      flush()
    },
    pin(geometry) {
      if (disposed) return
      clearQuiet()
      pinned = geometry
      desiredGeo = geometry ?? placedGeo
      desiredIsPark = false
      flush()
    },
    dispose() {
      disposed = true
      clearQuiet()
      if (retryTimer !== null) clearT(retryTimer)
      retryTimer = null
    },
  }
}
