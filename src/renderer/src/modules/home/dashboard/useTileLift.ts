import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { DashboardModuleId, TilePlacement } from '@shared/modules/home'
import type { LayoutOperationResult } from './layout'

/**
 * Story 086 D6: the keyboard half of AC8/AC9 - a hand-written lift state machine on a tile's move
 * grip. `Decisions (Sprint)` rules out `@dnd-kit`'s `KeyboardSensor`: its coordinate getters are
 * list-shaped and cannot express 2D movement plus Shift+arrow resize.
 *
 * This hook owns *interaction state only*. It knows nothing about `layout.ts` (the reducer), about
 * `setHomeLayout` (persistence) or about i18n - it calls the callbacks it is handed, which do all
 * three in `Dashboard.tsx`. That is what keeps `useTileLift.test.tsx` a fast jsdom unit test of the
 * transitions rather than an integration test, and it guarantees there is no second "is this move
 * legal?" implementation anywhere in the keyboard path.
 *
 * ## Why every accepted keystroke commits immediately
 *
 * A single lift session may mix moves (arrows) and resizes (Shift+arrows) before it is dropped, but
 * `layout.ts`'s `move()` derives the tile's `w`/`h` from `layout.tiles` itself and `resize()`
 * derives `x`/`y` the same way - neither can be told "pretend the tile is already at this
 * uncommitted candidate". A session that tracked one purely local candidate (the way the pointer
 * path's `activeDrag` does, which never touches `layout` until the drop) would therefore validate an
 * arrow-move after an in-session resize against the tile's *stale* size: silently wrong collision
 * math. So `onKeyboardChange` commits each accepted keystroke right away, and every following
 * keystroke is computed from the `tile` prop that comes back down - the freshly committed
 * placement, never a shadow copy of it. This also *is* AC10's "each change is persisted as it
 * happens".
 *
 * Two consequences the naming has to be read with:
 * - **drop** (Enter) is a pure state transition. There is nothing left to persist; it exits lift
 *   mode and announces that the placement is confirmed.
 * - **cancel** (Escape / blur / Tab) is not "discard a pending candidate" - there is none - but
 *   "revert whatever this session already committed back to `liftOrigin`", the placement the tile
 *   had at lift time. The caller does that restore (`Dashboard.tsx`'s `handleKeyboardCancel`); this
 *   hook only remembers the origin and hands it over.
 *
 * `liftOriginRef` doubles as the machine's real "am I lifted?" flag: `cancel()` is a no-op once it
 * is `null`. That is what makes the Tab exit idempotent - Tab cancels *and* moves focus, so the
 * `blur` that follows would otherwise cancel (and announce) a second time.
 */

/** One cell of travel per keystroke. For a move: the direction. For a Shift+arrow resize: Right and
 * Down grow (the natural reading for a box whose anchor is its top-left, and the same direction the
 * pointer resize grip in the bottom-right corner travels), Left and Up shrink. A shrink past
 * `MODULE_MIN_SIZE` needs no guard here - `resize()` refuses it and the refusal is announced. */
const ARROW_DELTAS: Record<string, { x: number; y: number }> = {
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
}

export interface UseTileLiftOptions {
  /** The tile's currently committed placement, straight from the layout. Because every accepted
   * keystroke commits, this is also the candidate the next keystroke is computed from. */
  tile: TilePlacement
  /** Lift is impossible outside arrange mode - mirrors the move grip's own pointer `disabled` (D5). */
  disabled: boolean
  /** Evaluates and, if the reducer accepts it, persists one keystroke. Its verdict is returned so a
   * refusal can be announced by the caller with the reducer's own reason. */
  onKeyboardChange: (
    moduleId: DashboardModuleId,
    kind: 'move' | 'resize',
    candidate: TilePlacement,
  ) => Promise<LayoutOperationResult>
  /** Restores `origin` (the pre-lift placement) and announces the cancel. */
  onCancel: (moduleId: DashboardModuleId, origin: TilePlacement) => Promise<void>
  onAnnounce: (text: string) => void
  /** Pre-translated announcement text for lift/drop - built by `DashboardTile`, which has
   * `useTranslation`, so this hook stays translation-agnostic. */
  liftedText: string
  droppedText: string
}

export interface TileLift {
  lifted: boolean
  handleKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void
  handleBlur: () => void
}

export function useTileLift(options: UseTileLiftOptions): TileLift {
  const [lifted, setLifted] = useState(false)
  /** The placement the tile had when this session lifted, and the session's own liveness flag - see
   * the doc comment above. A ref, not state: a cancel has to read it from inside an event handler
   * that may run before React has re-rendered (Tab fires keydown and blur back to back). */
  const liftOriginRef = useRef<TilePlacement | null>(null)

  function lift(): void {
    liftOriginRef.current = options.tile
    setLifted(true)
    options.onAnnounce(options.liftedText)
  }

  function drop(): void {
    liftOriginRef.current = null
    setLifted(false)
    options.onAnnounce(options.droppedText)
  }

  function cancel(): void {
    const origin = liftOriginRef.current
    if (!origin) return
    liftOriginRef.current = null
    setLifted(false)
    // `onCancel` announces the cancel itself (it is the one that knows whether a revert was even
    // needed), so nothing is announced here - a second announcement would overwrite it.
    void options.onCancel(origin.moduleId, origin)
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLElement>): void {
    if (options.disabled) return

    if (!liftOriginRef.current) {
      // Space and Enter both lift - Space is the convention, Enter is what AC8 names, and on a
      // <button> both would otherwise fire a click (and Space would scroll the page).
      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault()
        lift()
      }
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      cancel()
      return
    }
    if (event.key === 'Tab') {
      // Deliberately NOT prevented: Tab still moves focus, it just cancels the lift on the way out
      // (AC8). The `blur` that follows calls `cancel()` again and finds the session already closed.
      cancel()
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      drop()
      return
    }

    const delta = ARROW_DELTAS[event.key]
    if (!delta) return
    event.preventDefault()

    const kind = event.shiftKey ? 'resize' : 'move'
    const candidate: TilePlacement =
      kind === 'move'
        ? { ...options.tile, x: options.tile.x + delta.x, y: options.tile.y + delta.y }
        : { ...options.tile, w: options.tile.w + delta.x, h: options.tile.h + delta.y }

    // Whether this is accepted or refused, `onKeyboardChange` announces the outcome and - when
    // accepted - has already persisted it, which flows back down as a new `tile` prop. A refusal
    // leaves the session lifted so the user can simply press another arrow.
    void options.onKeyboardChange(options.tile.moduleId, kind, candidate)
  }

  function handleBlur(): void {
    cancel()
  }

  return { lifted, handleKeyDown, handleBlur }
}
