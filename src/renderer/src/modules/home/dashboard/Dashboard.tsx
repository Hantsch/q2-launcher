import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type Active,
  type Announcements,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { Ban } from 'lucide-react'
import {
  DASHBOARD_MODULE_IDS,
  DEFAULT_HOME_LAYOUT,
  GRID_COLUMNS,
  GRID_GAP_PX,
  GRID_ROW_HEIGHT,
  MODULE_MIN_SIZE,
  NARROW_THRESHOLD_PX,
  type DashboardModuleId,
  type HomeLayout,
  type TilePlacement,
} from '@shared/modules/home'
import { getHomeLayout, resetHomeLayout, setHomeLayout } from '../client'
import { useElementWidth } from './useElementWidth'
import { DashboardGrid } from './DashboardGrid'
import { ArrangeToggle } from './ArrangeToggle'
import { ArrangeBar } from './ArrangeBar'
import { firstFreeSpot, move, place, resize, type LayoutOperationResult } from './layout'
import { DASHBOARD_MODULES } from './dashboard-modules'

/** Mirrors `components/dnd/SortableList.tsx`'s own sensor configuration: a plain click must not
 * start a drag, so the pointer has to travel this far first. */
const DRAG_ACTIVATION_DISTANCE_PX = 8

/** The real distance between the top edges of two adjacent rows - the row itself plus the grid's
 * gap. See `GRID_GAP_PX`'s doc comment for why the gap cannot be dropped from this. */
const ROW_PITCH_PX = GRID_ROW_HEIGHT + GRID_GAP_PX

const ZERO_DELTA = { x: 0, y: 0 }

/** What kind of gesture is in flight. Published by the dragged element as `data.kind`
 * (`DashboardTile.tsx`'s two grips, `ArrangeBar.tsx`'s catalog chips). */
type DragKind = 'move' | 'resize' | 'place'

interface ActiveDrag {
  kind: DragKind
  moduleId: DashboardModuleId
  /** The placement the gesture started from - the stored tile for move/resize, the module's default
   * size for a catalog drag. Fixed for the whole drag, which is what lets every candidate be
   * recomputed from scratch instead of accumulated. */
  origin: TilePlacement
  /** Where the gesture currently points. Rendered by the ghost; never written to `layout`. */
  candidate: TilePlacement
  /** The pure reducer's verdict on `candidate` - `place`/`move`/`resize`'s own `ok`, never a second
   * opinion computed here. */
  valid: boolean
  originLeftPx?: number
  originTopPx?: number
}

/**
 * Story 086 D3: the dashboard's mount point, and its read-only render path in full.
 *
 * Loads the persisted `HomeLayout` once on mount (mirrors `HomeView.tsx`'s own `getNews()` idiom:
 * unwrap the `Outcome`, apply it only if `ok`) and measures its own container width via
 * `useElementWidth`, handing both to `DashboardGrid` to render. No loading spinner - this is a
 * local read, effectively instant - so nothing renders until the layout has actually resolved
 * (`HomeView.test.tsx` relies on this too: its client mock does not stub `getHomeLayout` at all,
 * so this dashboard renders nothing in that test, same as before this D).
 *
 * The fetch is wrapped in try/catch rather than left to reject: a failed `Outcome` is already
 * handled by simply not calling `applyLayout` (same as `getNews()`), but `getHomeLayout` itself
 * is still an IPC call, and this dashboard should never crash the Home screen over a data fetch
 * that did not come back - it stays empty instead.
 *
 * Story 086 D4: this component also owns arrange mode. `ArrangeToggle` has to be disabled while the
 * dashboard is single-column, but "narrow" is only known here (via `useElementWidth`'s own ref) -
 * rather than lifting that measurement up into `HomeView.tsx` (which would have to also own
 * arrange-mode state, catalog logic, etc., turning it into a god component), `Dashboard.tsx`
 * renders `ArrangeToggle` and (conditionally) `ArrangeBar` INSIDE its own width-measured container,
 * above `DashboardGrid`. Both are gated behind `layout` being loaded, same as the grid always was -
 * there is nothing useful to arrange before the layout has resolved, and this keeps
 * `HomeView.test.tsx`'s "the home screen shows no planned module" assertion (zero buttons on an
 * unresolved fetch) true unchanged.
 *
 * The container carries `group/dashboard` for one reason: `ArrangeToggle` is invisible at rest and
 * reveals itself on hover anywhere over the dashboard (User feedback - the old "DASHBOARD" header
 * row and its labelled button were pure space cost).
 *
 * Every handler below sends/receives the *whole* `HomeLayout` through `setHomeLayout` - never a
 * per-tile patch - so move, resize (D5/D6), place and remove all go through one persistence path.
 *
 * Story 086 D5: the pointer path lives here too. The deliverable names `DashboardGrid.tsx` for the
 * `DndContext`, but a drag out of the catalog starts on an `ArrangeBar` chip and ends over the
 * grid - two siblings - so the context has to sit on their common ancestor, which is this
 * component, and it is also the only place that holds `layout` plus the `setHomeLayout` call a
 * drop has to make. Only mounted while actually arranging, so AC3's "outside arrange mode no drag
 * can start" stays true by construction and not just by the absence of grips.
 */
export function Dashboard() {
  const { t } = useTranslation()
  const [ref, width] = useElementWidth<HTMLDivElement>()
  const gridRef = useRef<HTMLDivElement>(null)
  const [layout, setLayoutState] = useState<HomeLayout | undefined>(undefined)
  /**
   * The freshest committed layout, written at the exact moment a commit's result lands rather than
   * by an effect reacting to the state above (which would lag by a tick).
   *
   * The keyboard path (D6) commits one write per keystroke and `useTileLift` fires those without
   * awaiting them, so a cancel (Escape, blur or Tab) can run before React has re-rendered off the
   * keystroke before it. A closure-read `layout` is then the *pre-keystroke* one, the cancel finds
   * the tile still sitting on `origin`, concludes there is nothing to revert - and the in-flight
   * keystroke lands anyway and sticks (AC8). Reading the layout out of this ref instead removes the
   * render from the loop entirely; `applyLayout` is the only writer of either, so the two can never
   * disagree.
   */
  const layoutRef = useRef<HomeLayout | undefined>(undefined)
  /**
   * Tail of the chain of keyboard-driven writes. `handleKeyboardChange` queues its work behind it
   * (so two fast keystrokes serialise instead of racing each other), and `handleKeyboardCancel`
   * awaits it before deciding anything - by then a keystroke that was still in flight has fully
   * landed, IPC round trip *and* its `layoutRef` update, so the comparison against `origin` is
   * correct regardless of timing. Never rejects: both settle paths are mapped to `undefined`.
   */
  const pendingKeyboardWrite = useRef<Promise<void>>(Promise.resolve())
  const [arrangeMode, setArrangeMode] = useState(false)
  const [status, setStatus] = useState('')
  const [activeDrag, setActiveDrag] = useState<ActiveDrag | null>(null)

  const isNarrow = width > 0 && width < NARROW_THRESHOLD_PX
  const isArranging = arrangeMode && !isNarrow
  const columnPitch = width / GRID_COLUMNS

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: DRAG_ACTIVATION_DISTANCE_PX } }),
  )

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const result = await getHomeLayout()
        if (!cancelled && result.ok) applyLayout(result.value)
      } catch {
        // Leave the dashboard empty rather than throwing - see the doc comment above.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  /** The only place `layout` is written - state for rendering, ref for the handlers that cannot
   * wait for a render (see `layoutRef`). Everything that commits a layout goes through here. */
  function applyLayout(next: HomeLayout): void {
    layoutRef.current = next
    setLayoutState(next)
  }

  function titleOf(moduleId: DashboardModuleId): string {
    return t(DASHBOARD_MODULES[moduleId].titleKey)
  }

  function handleToggleArrange(): void {
    setArrangeMode((wasArranging) => {
      const nextArranging = !wasArranging
      setStatus(t(nextArranging ? 'home.dashboard.status.entered' : 'home.dashboard.status.exited'))
      return nextArranging
    })
  }

  async function handlePlaceFromCatalog(moduleId: DashboardModuleId): Promise<void> {
    if (!layout) return
    const title = titleOf(moduleId)
    const size = defaultSizeFor(moduleId)

    const spot = firstFreeSpot(layout, size.w, size.h)
    if (!spot) {
      setStatus(t('home.dashboard.status.noRoom', { title }))
      return
    }

    const result = place(layout, moduleId, { x: spot.x, y: spot.y, w: size.w, h: size.h })
    if (!result.ok) {
      setStatus(t('home.dashboard.status.placeFailed', { title }))
      return
    }

    const outcome = await setHomeLayout(result.layout)
    if (outcome.ok) {
      applyLayout(outcome.value)
      setStatus(t('home.dashboard.status.placed', { title }))
    } else {
      setStatus(t('home.dashboard.status.placeFailed', { title }))
    }
  }

  async function handleRemoveTile(moduleId: DashboardModuleId): Promise<void> {
    if (!layout) return
    const title = titleOf(moduleId)
    const next: HomeLayout = { tiles: layout.tiles.filter((tile) => tile.moduleId !== moduleId) }

    const outcome = await setHomeLayout(next)
    if (outcome.ok) {
      applyLayout(outcome.value)
      setStatus(t('home.dashboard.status.removed', { title }))
    }
  }

  async function handleResetConfirmed(): Promise<void> {
    const outcome = await resetHomeLayout()
    if (outcome.ok) {
      applyLayout(outcome.value)
      setStatus(t('home.dashboard.status.reset'))
    }
  }

  /**
   * Story 086 D6: one accepted arrow-move or Shift+arrow-resize keystroke from a tile's keyboard
   * lift (`useTileLift`). Evaluated through the SAME reducer the pointer path uses (`applyToLayout`
   * -> `move`/`resize`), so both modalities share one notion of "legal".
   *
   * Unlike the pointer path - which writes once, on drop - this commits immediately: a lift session
   * may mix move and resize keystrokes, and `layout.ts` derives each operation's *other* dimension
   * from `layout.tiles` itself, so a locally tracked candidate would make the next keystroke
   * validate against a stale size. See `useTileLift.ts`'s doc comment for the full argument. The
   * reducer's own verdict is returned so the hook's caller learns why a refusal was refused.
   *
   * The work is queued behind `pendingKeyboardWrite` rather than started straight away, because
   * `useTileLift` fires this without awaiting it. Two keystrokes in quick succession would
   * otherwise both evaluate against the layout as it stood before either had committed, and a
   * cancel arriving between them could not tell that anything was in flight at all. Queued, each
   * keystroke reads `layoutRef.current` at the moment it actually runs - after its predecessor has
   * landed - and a cancel only has to await this one promise.
   */
  async function handleKeyboardChange(
    moduleId: DashboardModuleId,
    kind: 'move' | 'resize',
    candidate: TilePlacement,
  ): Promise<LayoutOperationResult> {
    const run = async (): Promise<LayoutOperationResult> => {
      const currentLayout = layoutRef.current
      if (!currentLayout) return { ok: false, reason: 'no layout loaded', layout: { tiles: [] } }
      const title = titleOf(moduleId)

      const result = applyToLayout(currentLayout, kind, moduleId, candidate)
      if (!result.ok) {
        setStatus(t('home.dashboard.status.invalidMove', { title, reason: result.reason }))
        return result
      }

      const outcome = await setHomeLayout(result.layout)
      if (!outcome.ok) {
        setStatus(t('home.dashboard.status.saveFailed', { title }))
        return { ok: false, reason: 'save failed', layout: currentLayout }
      }
      applyLayout(outcome.value)
      setStatus(
        kind === 'move'
          ? t('home.dashboard.status.moved', {
              title,
              column: candidate.x + 1,
              row: candidate.y + 1,
            })
          : t('home.dashboard.status.resized', { title, w: candidate.w, h: candidate.h }),
      )
      return result
    }

    const settled = pendingKeyboardWrite.current.then(run, run)
    pendingKeyboardWrite.current = settled.then(
      () => undefined,
      () => undefined,
    )
    return settled
  }

  /**
   * Story 086 D6: the keyboard lift's cancel (Escape, blur or Tab) - it reverts whatever the session
   * already committed back to `origin`, the placement the tile had when it was lifted (AC8).
   *
   * This needs no `layout.ts` validation: nothing else on the grid moves during a lift, so a rect
   * that fitted before the lift still fits now. A cancel with nothing to revert (lift, then straight
   * out again) still announces itself (AC9).
   *
   * It waits for `pendingKeyboardWrite` first, and then reads `layoutRef` rather than the `layout`
   * closure. Both halves are load-bearing for a fast keyboard user (or a key held down to repeat):
   * Escape/blur can fire while the preceding arrow's `setHomeLayout` is still in flight, and the
   * wait is what makes "did this session change anything?" a question about the committed layout
   * instead of about whichever render happened to be mounted when the key came down.
   */
  async function handleKeyboardCancel(
    moduleId: DashboardModuleId,
    origin: TilePlacement,
  ): Promise<void> {
    await pendingKeyboardWrite.current
    const title = titleOf(moduleId)
    const currentLayout = layoutRef.current
    const current = currentLayout?.tiles.find((tile) => tile.moduleId === moduleId)
    if (currentLayout && current && !samePlacement(current, origin)) {
      const reverted: HomeLayout = {
        tiles: currentLayout.tiles.map((tile) => (tile.moduleId === moduleId ? origin : tile)),
      }
      const outcome = await setHomeLayout(reverted)
      if (outcome.ok) applyLayout(outcome.value)
    }
    setStatus(t('home.dashboard.status.cancelled', { title }))
  }

  /** The lift/drop announcements, which `DashboardTile` translates itself (it already builds the
   * grip's own label the same way) - this is only the wire into the one status line D5's pointer
   * path already writes to, which `ArrangeBar.tsx` makes a live region for D6 (AC9). */
  function announce(text: string): void {
    setStatus(text)
  }

  /** The candidate this drag currently points at, plus the reducer's verdict on it. `null` when the
   * geometry is unusable (see `candidateFrom`), which leaves the drag showing its last candidate
   * rather than inventing one. */
  function evaluateDrag(
    drag: ActiveDrag,
    delta: { x: number; y: number },
    activatorEvent: Event | null,
  ): { candidate: TilePlacement; result: LayoutOperationResult } | null {
    if (!layout) return null
    const candidate = candidateFrom(
      drag,
      delta,
      activatorEvent,
      gridRef.current?.getBoundingClientRect(),
      columnPitch,
    )
    if (!candidate) return null
    return { candidate, result: applyToLayout(layout, drag.kind, drag.moduleId, candidate) }
  }

  /** Status text for a candidate: the reducer's own refusal reason while it is invalid, otherwise
   * the neutral "you are dragging this" line. Setting it from `onDragMove` is what makes AC5's
   * "shown as invalid *while dragging*" true rather than a post-drop verdict. */
  function dragStatus(drag: ActiveDrag, result: LayoutOperationResult): string {
    const title = titleOf(drag.moduleId)
    return result.ok
      ? t('home.dashboard.status.lifted', { title })
      : t('home.dashboard.status.invalidDrop', { title, reason: result.reason })
  }

  function handleDragStart(event: DragStartEvent): void {
    const parsed = readDragData(event.active)
    if (!parsed || !layout) return

    const origin =
      parsed.kind === 'place'
        ? { moduleId: parsed.moduleId, x: 0, y: 0, ...defaultSizeFor(parsed.moduleId) }
        : layout.tiles.find((tile) => tile.moduleId === parsed.moduleId)
    if (!origin) return

    const gridRect = gridRef.current?.getBoundingClientRect()
    const started: ActiveDrag = {
      kind: parsed.kind,
      moduleId: parsed.moduleId,
      origin,
      candidate: origin,
      valid: true,
      // Where the tile's own top-left sits on screen right now, so the ghost can start exactly on
      // top of it and travel with the pointer from there. A catalog drag has no tile yet, so its
      // ghost keeps dnd-kit's default anchor (the chip it was picked up from).
      originLeftPx:
        parsed.kind === 'place' || !gridRect ? undefined : gridRect.left + origin.x * columnPitch,
      originTopPx:
        parsed.kind === 'place' || !gridRect ? undefined : gridRect.top + origin.y * ROW_PITCH_PX,
    }

    const evaluated = evaluateDrag(started, ZERO_DELTA, event.activatorEvent)
    if (!evaluated) {
      setActiveDrag(started)
      setStatus(t('home.dashboard.status.lifted', { title: titleOf(parsed.moduleId) }))
      return
    }
    setActiveDrag({ ...started, candidate: evaluated.candidate, valid: evaluated.result.ok })
    setStatus(dragStatus(started, evaluated.result))
  }

  /**
   * Recomputes the candidate on every pointer move. Deliberately derived from `event.delta` (and,
   * for a catalog drag, the pointer position) against the drag's *stored* origin only - never from
   * the previous candidate - so a move event that arrives before React has committed the last one
   * still computes the same, correct answer.
   *
   * The real tile is not touched here: nothing but `activeDrag` (the ghost) changes until a drop is
   * accepted, which is what makes "shown as invalid" and "not applied" the same code path (AC5).
   */
  function handleDragMove(event: DragMoveEvent): void {
    if (!activeDrag) return
    const evaluated = evaluateDrag(activeDrag, event.delta, event.activatorEvent)
    if (!evaluated || samePlacement(evaluated.candidate, activeDrag.candidate)) return
    setActiveDrag({ ...activeDrag, candidate: evaluated.candidate, valid: evaluated.result.ok })
    setStatus(dragStatus(activeDrag, evaluated.result))
  }

  /**
   * The only place a pointer drag writes anything. The candidate is recomputed from this event's
   * own delta rather than read out of `activeDrag`, and the layout it persists is the one the
   * reducer returned for that candidate - so a refused candidate has no path to `setHomeLayout` at
   * all, and the tile that was never moved needs no snapping back.
   */
  async function handleDragEnd(event: DragEndEvent): Promise<void> {
    const drag = activeDrag
    setActiveDrag(null)
    if (!drag || !layout) return
    const title = titleOf(drag.moduleId)

    const evaluated = evaluateDrag(drag, event.delta, event.activatorEvent)
    if (!evaluated) {
      setStatus(t('home.dashboard.status.unchanged', { title }))
      return
    }
    // A drag shorter than half a cell rounds back onto the tile's stored placement. The reducer
    // would happily accept it, but writing it would report a move that did not happen.
    if (drag.kind !== 'place' && samePlacement(evaluated.candidate, drag.origin)) {
      setStatus(t('home.dashboard.status.unchanged', { title }))
      return
    }
    if (!evaluated.result.ok) {
      setStatus(dragStatus(drag, evaluated.result))
      return
    }

    const outcome = await setHomeLayout(evaluated.result.layout)
    if (!outcome.ok) {
      setStatus(t('home.dashboard.status.saveFailed', { title }))
      return
    }
    applyLayout(outcome.value)
    const { candidate } = evaluated
    if (drag.kind === 'move') {
      setStatus(
        t('home.dashboard.status.moved', { title, column: candidate.x + 1, row: candidate.y + 1 }),
      )
    } else if (drag.kind === 'resize') {
      setStatus(t('home.dashboard.status.resized', { title, w: candidate.w, h: candidate.h }))
    } else {
      setStatus(t('home.dashboard.status.placed', { title }))
    }
  }

  function handleDragCancel(): void {
    const drag = activeDrag
    setActiveDrag(null)
    if (drag) setStatus(t('home.dashboard.status.cancelled', { title: titleOf(drag.moduleId) }))
  }

  /**
   * dnd-kit's own live region. Its defaults are hardcoded English list-position sentences ("Picked
   * up draggable item 1 of 3"), which are both untranslated and wrong for a 2D grid, so the two
   * events that have a meaningful, translatable text get one and the high-frequency ones return
   * nothing. The outcome of a drop is carried by the visible status line above; D6 owns the
   * `aria-live` region that mirrors it (AC9).
   */
  const announcements: Announcements = {
    onDragStart: ({ active }) => {
      const parsed = readDragData(active)
      return parsed
        ? t('home.dashboard.status.lifted', { title: titleOf(parsed.moduleId) })
        : undefined
    },
    onDragOver: () => undefined,
    onDragEnd: () => undefined,
    onDragCancel: ({ active }) => {
      const parsed = readDragData(active)
      return parsed
        ? t('home.dashboard.status.cancelled', { title: titleOf(parsed.moduleId) })
        : undefined
    },
  }

  const dashboard = layout && (
    // `pt-14` is the arrange bar's slot, reserved in BOTH modes (the bar is ~53px tall and docks
    // into it absolutely, see dashboard.css). Story 086 D5 had to add it: docked at the top of the
    // grid itself, the bar covered the whole first row - the title, the grip and the "return to
    // catalog" button of every tile at `y: 0`, which is both tiles of the default layout, sat
    // underneath it and could not be pointed at at all (the catalog container and the reset button
    // took the clicks). Reserving the space rather than adding it on entry is what keeps AC4's
    // "entering arrange mode moves no tile" true: the gap is already there before the bar arrives.
    <div className="relative pt-14">
      {/* The arrange toggle lives in this same reserved slot (see `ArrangeToggle.tsx`): outside
          arrange mode it sits alone in the empty band, inside it the bar's left inset makes room
          for it - so it never moves and costs no height of its own. */}
      <ArrangeToggle arrangeMode={arrangeMode} onToggle={handleToggleArrange} disabled={isNarrow} />
      {isArranging && (
        <ArrangeBar
          layout={layout}
          status={status}
          onPlace={(moduleId) => void handlePlaceFromCatalog(moduleId)}
          onReset={() => void handleResetConfirmed()}
        />
      )}
      <DashboardGrid
        layout={layout}
        width={width}
        arrangeMode={isArranging}
        onRemoveTile={(moduleId) => void handleRemoveTile(moduleId)}
        onKeyboardChange={handleKeyboardChange}
        onKeyboardCancel={handleKeyboardCancel}
        onAnnounce={announce}
        gridRef={gridRef}
      />
    </div>
  )

  return (
    <div ref={ref} data-testid="home-dashboard" className="group/dashboard relative w-full">
      {layout && (
        <>
          {isArranging ? (
            <DndContext
              sensors={sensors}
              accessibility={{
                announcements,
                screenReaderInstructions: { draggable: t('home.dashboard.dnd.instructions') },
              }}
              onDragStart={handleDragStart}
              onDragMove={handleDragMove}
              onDragEnd={(event) => void handleDragEnd(event)}
              onDragCancel={handleDragCancel}
            >
              {dashboard}
              <DragOverlay dropAnimation={null} style={ghostStyle(activeDrag, columnPitch)}>
                {activeDrag && (
                  <div
                    data-testid="dashboard-drag-ghost"
                    data-invalid={activeDrag.valid ? 'false' : 'true'}
                    className="dashboard-drag-ghost"
                  >
                    <span className="min-w-0 truncate">{titleOf(activeDrag.moduleId)}</span>
                    {!activeDrag.valid && <Ban className="size-4 shrink-0" aria-hidden="true" />}
                  </div>
                )}
              </DragOverlay>
            </DndContext>
          ) : (
            dashboard
          )}
        </>
      )}
    </div>
  )
}

/** The size a module gets when it is placed rather than moved - its footprint in the shipped
 * default layout, or the floor for a module the default does not mention. */
function defaultSizeFor(moduleId: DashboardModuleId): { w: number; h: number } {
  const tile = DEFAULT_HOME_LAYOUT.tiles.find((entry) => entry.moduleId === moduleId)
  return tile ? { w: tile.w, h: tile.h } : MODULE_MIN_SIZE
}

/**
 * The one mapping from "a candidate rect for this gesture" to the pure engine (D2). Every validity
 * check and every accepted write goes through it, so the refusal semantics the ghost shows and the
 * ones that gate the `state.json` write cannot drift apart - there is no second "is this legal?"
 * implementation anywhere in the pointer path.
 */
function applyToLayout(
  layout: HomeLayout,
  kind: DragKind,
  moduleId: DashboardModuleId,
  candidate: TilePlacement,
): LayoutOperationResult {
  switch (kind) {
    case 'move':
      return move(layout, moduleId, { x: candidate.x, y: candidate.y })
    case 'resize':
      return resize(layout, moduleId, { w: candidate.w, h: candidate.h })
    case 'place':
      return place(layout, moduleId, candidate)
  }
}

/**
 * Pixels to cells, the one conversion in the pointer path.
 *
 * - `move`/`resize` read `delta` (dnd-kit's cumulative travel since the pointer went down) and
 *   round it to the *nearest* whole cell, so a gesture is judged by where it ended up rather than
 *   by which cell boundary it happened to cross last.
 * - `place` has no origin cell to count from, so it maps the pointer itself (activator coordinates
 *   plus the same delta) onto the cell it is inside - `floor`, not `round`: the cell under the
 *   pointer becomes the new tile's top-left.
 *
 * The horizontal pitch is `containerWidth / GRID_COLUMNS`, which is the convention
 * `scripts/flows/home-dashboard-arrange.mjs` already measures drags with. It is 1px short of the
 * true pitch (`(width - 11 * gap) / 12 + gap`), far inside the half-cell rounding margin, and being
 * the *same* formula on both sides matters more than being analytically exact on one.
 *
 * Returns `null` rather than a guess when the geometry cannot be trusted (an unmeasured container,
 * a missing grid rect, a non-pointer activator). That guard is load-bearing: a `NaN` cell would
 * pass every comparison in `layout.ts`'s refusal checks unnoticed and be written to `state.json`.
 */
function candidateFrom(
  drag: ActiveDrag,
  delta: { x: number; y: number },
  activatorEvent: Event | null,
  gridRect: DOMRect | undefined,
  columnPitch: number,
): TilePlacement | null {
  if (!Number.isFinite(columnPitch) || columnPitch <= 0) return null

  if (drag.kind === 'place') {
    if (!gridRect || !(activatorEvent instanceof MouseEvent)) return null
    const x = Math.floor((activatorEvent.clientX + delta.x - gridRect.left) / columnPitch)
    const y = Math.floor((activatorEvent.clientY + delta.y - gridRect.top) / ROW_PITCH_PX)
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null
    return { ...drag.origin, x, y }
  }

  const columns = Math.round(delta.x / columnPitch)
  const rows = Math.round(delta.y / ROW_PITCH_PX)
  if (!Number.isFinite(columns) || !Number.isFinite(rows)) return null

  return drag.kind === 'move'
    ? { ...drag.origin, x: drag.origin.x + columns, y: drag.origin.y + rows }
    : { ...drag.origin, w: drag.origin.w + columns, h: drag.origin.h + rows }
}

function samePlacement(a: TilePlacement, b: TilePlacement): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h
}

/**
 * The floating ghost's box: the candidate's size in pixels and, for a move or resize, the dragged
 * tile's own on-screen top-left (dnd-kit adds the pointer travel on top as a transform). Overrides
 * `DragOverlay`'s measured defaults, which are the *grip's* 28px box - the grip is the element the
 * pointer actually picked up.
 *
 * `top`/`left` are only ever *added*, never set to `undefined`: dnd-kit merges this object over its
 * own computed `position: fixed` offsets, so an explicit `undefined` would erase them and strand
 * the catalog drag's ghost (which has no tile of its own to anchor to) at the top of the page.
 */
function ghostStyle(drag: ActiveDrag | null, columnPitch: number): CSSProperties | undefined {
  if (!drag) return undefined
  const size: CSSProperties = {
    width: drag.candidate.w * columnPitch - GRID_GAP_PX,
    height: drag.candidate.h * ROW_PITCH_PX - GRID_GAP_PX,
  }
  if (drag.originLeftPx === undefined || drag.originTopPx === undefined) return size
  // A resize anchors the tile's top-left and only changes its size, so the ghost must NOT travel
  // with the pointer - dnd-kit's own translate is cancelled here (`style` is merged last over its
  // computed transform, see `PositionedOverlay`). Left in place, the ghost drifts twice as fast as
  // the grip: the box moves by the raw pointer delta AND grows by that same delta rounded to cells,
  // which is what sent a shrink sailing out of the dashboard. A move keeps the translate - there,
  // travelling with the pointer IS the gesture.
  const anchored: CSSProperties = { ...size, left: drag.originLeftPx, top: drag.originTopPx }
  return drag.kind === 'resize' ? { ...anchored, transform: 'none' } : anchored
}

/** Narrows a dragged element's `data` payload. Anything unrecognised - including a module id this
 * build does not know - is treated as "not a dashboard drag" rather than coerced. */
function readDragData(active: Active): { kind: DragKind; moduleId: DashboardModuleId } | null {
  const data = active.data.current as { kind?: unknown; moduleId?: unknown } | undefined
  if (!data) return null
  const { kind, moduleId } = data
  if (kind !== 'move' && kind !== 'resize' && kind !== 'place') return null
  if (typeof moduleId !== 'string') return null
  if (!(DASHBOARD_MODULE_IDS as readonly string[]).includes(moduleId)) return null
  return { kind, moduleId: moduleId as DashboardModuleId }
}
