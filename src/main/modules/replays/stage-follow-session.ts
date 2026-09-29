import type { ReplaysStageRect } from '@shared/modules/replays'
import { ok, type Outcome } from '@shared/types'
import type { MainWindowEvent, MainWindowObserver } from '../../main-window-observer'
import type { StageRect } from './stage'
import { createStageFollower, type StageFollower, type StageFollowerDeps, type StageFollowWindow } from './stage-follow'

/**
 * Story 171 D2: wires D1's stage follower to a live stage session. A follower exists only between
 * `begin` (a demo launched placed over the stage) and the returned `end` (that session's game is
 * gone); the main window's events and `playback.stage` reports feed it. Outside a session, both are
 * no-ops - nothing reaches the engine.
 */
export const PARK_MARGIN_PX = 64

const GEOMETRY = /^(\d+)x(\d+)\+(-?\d+)\+(-?\d+)$/

/** `WxH+X+Y` with the same size and Y, X moved `PARK_MARGIN_PX` beyond `rightEdge` (physical px). */
export function parkGeometryAt(geometry: string, rightEdge: number): string {
  const m = GEOMETRY.exec(geometry)
  if (!m) return geometry
  return `${m[1]}x${m[2]}+${Math.round(rightEdge) + PARK_MARGIN_PX}+${m[4]}`
}

/** The right edge of the virtual desktop in physical px: the rightmost display's right edge. */
export function virtualDesktopRightEdge(
  displays: ReadonlyArray<{ bounds: StageRect; scaleFactor: number }>,
  dipToScreen?: (dip: StageRect) => StageRect,
): number {
  let edge = 0
  for (const { bounds, scaleFactor } of displays) {
    const physical = dipToScreen
      ? dipToScreen(bounds)
      : { x: bounds.x * scaleFactor, y: bounds.y * scaleFactor, width: bounds.width * scaleFactor, height: bounds.height * scaleFactor }
    edge = Math.max(edge, physical.x + physical.width)
  }
  return edge
}

export interface StageFollowSessions {
  /** A placed stage session started at `geometry` for `rect`; returns its end (idempotent). */
  begin(start: { geometry: string; rect: ReplaysStageRect }): () => void
  /** `playback.stage`: the stage moved (or is gone, `null`). */
  report(rect: ReplaysStageRect | null): Outcome<void>
  /** Story 172 D5: while the demo is fullscreen the game window is not moved or resized. */
  setSuspended(suspended: boolean): void
}

export interface StageFollowSessionsDeps {
  window: MainWindowObserver
  send: StageFollowerDeps['send']
  computeGeometry: StageFollowerDeps['computeGeometry']
  parkGeometry: StageFollowerDeps['parkGeometry']
  createFollower?: (deps: StageFollowerDeps) => StageFollower
}

const TICK_EVENTS: ReadonlySet<MainWindowEvent> = new Set(['move', 'resize'])

export function createStageFollowSessions(deps: StageFollowSessionsDeps): StageFollowSessions {
  const create = deps.createFollower ?? createStageFollower
  let current: { follower: StageFollower; rect: ReplaysStageRect | null; unsubscribe: () => void } | null = null

  let suspended = false

  const feed = (session: NonNullable<typeof current>, tick: boolean): void => {
    if (suspended) return
    const snap = deps.window.snapshot()
    if (!snap) return
    const window: StageFollowWindow = {
      contentBounds: snap.contentBounds,
      scaleFactor: snap.scaleFactor,
      minimized: snap.minimized,
      focused: snap.focused,
    }
    session.follower.update({ stageRect: session.rect, window, tick })
  }

  return {
    begin({ geometry, rect }) {
      suspended = false
      current?.unsubscribe()
      current?.follower.dispose()
      const follower = create({
        send: deps.send,
        computeGeometry: deps.computeGeometry,
        parkGeometry: deps.parkGeometry,
        launchGeometry: geometry,
      })
      // Until the renderer reports one, the stage is where it was at launch.
      const session: NonNullable<typeof current> = { follower, rect, unsubscribe: () => undefined }
      session.unsubscribe = deps.window.on((event) => {
        if (current === session) feed(session, TICK_EVENTS.has(event))
      })
      current = session
      return () => {
        if (current !== session) return
        current = null
        session.unsubscribe()
        follower.dispose()
      }
    },
    setSuspended(value) {
      if (suspended === value) return
      suspended = value
      if (!value && current) feed(current, false)
    },
    report(rect) {
      if (current) {
        current.rect = rect
        feed(current, false)
      }
      return ok(undefined)
    },
  }
}
