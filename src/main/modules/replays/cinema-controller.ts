import type { ReplaysPlaybackState } from '@shared/modules/replays'
import type { CinemaAvailability } from '@shared/replays/cinema'
import { fail, ok, type Outcome } from '@shared/types'
import type { CinemaWindow } from '../../cinema-window'
import { FULLSCREEN_REASON_KEY, NO_STAGE_REASON_KEY } from './cinema'
import { NO_SESSION } from './playback-control'

/**
 * Story 187 D5: the single owner of "cinema is open" for the running demo.
 *
 * The follower must never send `win_alwaysontop` while the overlay is up - opening the overlay takes
 * focus from the main window, and a follower that reacted to that blur would drop (or, on the way
 * back, lift) the game against the overlay. So the order is fixed:
 *
 * - **enter**: availability, then `pin(display geometry)`, then - once the game has run the pin -
 *   open the overlay: the follower is pinned before the first focus change the overlay causes, and
 *   the game's own re-placement (topmost + foreground) is over before the overlay goes on top.
 * - **leave** (handler or the overlay closing on its own): close the overlay, then unpin.
 * - **fullscreen from cinema**: close the overlay but keep the pin, so the focus change reaches a
 *   pinned follower; back to the window (display `stage`) unpins, and the stage geometry is sent again.
 * - **finished**: close and unpin. **ended**: close (the follower is gone with the game).
 */

export interface CinemaControllerDeps {
  availability: () => CinemaAvailability
  /** The primary display's rect as the engine's physical `vid_geometry`. */
  displayGeometry: () => string
  /** The live stage session's follower pin (`null` unpins). */
  pin: (geometry: string | null) => boolean
  /** Resolves once the lines sent so far (the pin) have run in the game. */
  settled: () => Promise<void>
  window: Pick<CinemaWindow, 'open' | 'close' | 'isOpen' | 'onClosed'>
  /** A demo is playing (a live, unfinished session). */
  hasSession: () => boolean
  /** The playback channel's own `enterFullscreen`. */
  enterFullscreen: () => Outcome<void>
  /** Pushes `playback.display`. */
  emitDisplay: () => void
}

export interface CinemaController {
  set(enter: boolean): Promise<Outcome<void>>
  /** The overlay is open (or opening) for cinema. */
  isOpen(): boolean
  /** `enterFullscreen` for every caller: from cinema it closes the overlay and keeps the pin. */
  enterFullscreen(): Outcome<void>
  /** The channel reported fullscreen (`true`) or back on the stage (`false`). */
  onDisplayChange(fullscreen: boolean): void
  onPlaybackState(state: ReplaysPlaybackState['state']): void
}

export function createCinemaController(deps: CinemaControllerDeps): CinemaController {
  let active = false
  let pinned = false
  // The channel reported fullscreen: cinema cannot be entered until it is back on the stage.
  let fullscreen = false

  const unpin = (): void => {
    if (!pinned) return
    pinned = false
    void deps.pin(null)
  }

  /** Closes the overlay without touching the pin; our own close never reads as "the user left". */
  const closeOverlay = (): boolean => {
    const was = active
    active = false
    if (deps.window.isOpen()) deps.window.close()
    return was
  }

  const leave = (): void => {
    const was = closeOverlay()
    unpin()
    if (was) deps.emitDisplay()
  }

  // The overlay closed by itself (Escape in the overlay, Alt+F4, its page gone): leave cinema.
  // Subscribed on first enter, so a module that never enters cinema never touches the overlay service.
  let subscribed = false
  const subscribe = (): void => {
    if (subscribed) return
    subscribed = true
    deps.window.onClosed(() => {
      if (!active) return
      active = false
      unpin()
      deps.emitDisplay()
    })
  }

  const enter = async (): Promise<Outcome<void>> => {
    if (active) return ok(undefined)
    if (!deps.hasSession()) return fail(NO_SESSION)
    const availability = deps.availability()
    if (!availability.available) return fail(availability.reason.key)
    if (fullscreen) return fail(FULLSCREEN_REASON_KEY)
    subscribe()
    // No follower (an unplaced play) means the pin is a no-op: the overlay would sit over an unmoved game.
    if (!deps.pin(deps.displayGeometry())) return fail(NO_STAGE_REASON_KEY)
    active = true
    pinned = true
    // Placing its window raises the game over every topmost window and takes the foreground, so the
    // overlay opens only once the game has run the pin - on top of it, and with the keyboard.
    await deps.settled()
    if (!active) return ok(undefined)
    try {
      await deps.window.open()
    } catch (error) {
      active = false
      unpin()
      throw error
    }
    // Left (or the session ended) while the page was loading: do not leave an orphan overlay up.
    if (!active) {
      if (deps.window.isOpen()) deps.window.close()
      return ok(undefined)
    }
    deps.emitDisplay()
    return ok(undefined)
  }

  return {
    set(value) {
      if (value) return enter()
      leave()
      return Promise.resolve(ok(undefined))
    },

    isOpen: () => active,

    enterFullscreen() {
      const result = deps.enterFullscreen()
      if (result.ok && active) closeOverlay()
      return result
    },

    onDisplayChange(isFullscreen) {
      fullscreen = isFullscreen
      if (isFullscreen) {
        // Fullscreen reached some other way while cinema was up: same as going fullscreen from cinema.
        if (active) closeOverlay()
        return
      }
      // Back to the window from a fullscreen entered in cinema: the stage geometry is sent again.
      if (!active) unpin()
    },

    onPlaybackState(state) {
      if (state === 'finished') {
        leave()
      } else if (state === 'ended') {
        fullscreen = false
        const was = closeOverlay()
        // The follower is disposed with the game; nothing is left to unpin.
        pinned = false
        if (was) deps.emitDisplay()
      }
    },
  }
}
