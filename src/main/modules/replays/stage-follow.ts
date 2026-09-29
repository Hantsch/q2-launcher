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
    if (desiredTop !== sentTop) {
      if (deps.send(`set win_alwaysontop ${desiredTop}`).ok) sentTop = desiredTop
      else failed = true
    }
    if (desiredGeo !== sentGeo) {
      if (deps.send(`set vid_geometry ${desiredGeo}`).ok) {
        sentGeo = desiredGeo
        sentIsPark = desiredIsPark
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
    dispose() {
      disposed = true
      clearQuiet()
      if (retryTimer !== null) clearT(retryTimer)
      retryTimer = null
    },
  }
}
