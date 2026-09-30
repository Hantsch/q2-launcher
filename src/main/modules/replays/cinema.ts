import type { CinemaAvailability } from '@shared/replays/cinema'
import type { StageAvailability, StageRect } from './stage'

/**
 * Story 187 D2: pure helpers for cinema mode - whether it can run, the physical geometry of the
 * display it covers, and the UI-harness knob that fakes which display the launcher is on. No electron
 * import: the display lookup is done by the caller.
 */

export const NOT_PRIMARY_REASON_KEY = 'replays.cinema.unavailable.notPrimaryDisplay'

export const NO_STAGE_REASON_KEY = 'replays.cinema.unavailable.noStage'
export const FULLSCREEN_REASON_KEY = 'replays.cinema.unavailable.fullscreen'

/** A stage reason wins (Wayland), then a non-primary display; otherwise cinema is available. */
export function cinemaAvailability(input: {
  stageReason: StageAvailability | { key: string } | null | undefined
  onPrimary: boolean
  /** A stage follower is live, so pinning the game window works. Defaults to true. */
  hasFollower?: boolean
}): CinemaAvailability {
  const r = input.stageReason
  if (r) {
    if ('available' in r) {
      if (!r.available) return { available: false, reason: { key: r.reason.key } }
    } else {
      return { available: false, reason: { key: r.key } }
    }
  }
  if (!input.onPrimary) return { available: false, reason: { key: NOT_PRIMARY_REASON_KEY } }
  if (input.hasFollower === false) return { available: false, reason: { key: NO_STAGE_REASON_KEY } }
  return { available: true }
}

/** The display rect (physical px) as the engine's `vid_geometry` 'WxH+X+Y'. */
export function displayGeometry(physicalRect: StageRect): string {
  return `${Math.round(physicalRect.width)}x${Math.round(physicalRect.height)}+${Math.round(physicalRect.x)}+${Math.round(physicalRect.y)}`
}

/**
 * `Q2L_UI_CINEMA_DISPLAY=primary|secondary` overrides `onPrimary` - honoured only with
 * `Q2L_UI_HARNESS` set, like `Q2L_UI_SESSION_TYPE` in `stage.ts`.
 */
export function resolveOnPrimary(onPrimary: boolean, env: Record<string, string | undefined>): boolean {
  if (!env['Q2L_UI_HARNESS']) return onPrimary
  const knob = env['Q2L_UI_CINEMA_DISPLAY']
  if (knob === 'primary') return true
  if (knob === 'secondary') return false
  return onPrimary
}
