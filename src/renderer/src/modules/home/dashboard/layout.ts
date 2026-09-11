import {
  GRID_COLUMNS,
  MODULE_MIN_SIZE,
  type DashboardModuleId,
  type HomeLayout,
  type TilePlacement,
} from '@shared/modules/home'

/**
 * Story 086 D2: the dashboard's pure layout engine. No React, no Electron, no `@dnd-kit`, no IPC -
 * `place`/`move`/`resize`/`collides`/`stack`/`firstFreeSpot` only ever read/derive from a
 * `HomeLayout` value and never mutate it (AC13). D3+ (the renderer surface) and D5/D6 (pointer and
 * keyboard interaction) call into this file; it does not call into them.
 */

/** A plain cell rectangle - what every geometry check below actually operates on. */
type Rect = { x: number; y: number; w: number; h: number }

/**
 * Shared result shape for `place`/`move`/`resize` (AC5). On success, `layout` is a brand-new
 * `HomeLayout` (the input is never mutated). On refusal, `reason` is a non-empty, human-readable
 * explanation, and `layout` is the *same* value that was passed in - not a copy - so a caller (and
 * `layout.test.ts`) can assert "a refused operation returns the input layout untouched" with
 * `result.layout === input`, not just a deep-equal.
 */
export type LayoutOperationResult =
  | { ok: true; layout: HomeLayout }
  | { ok: false; reason: string; layout: HomeLayout }

/** True if two cell rectangles' areas actually overlap - touching edges do not count. */
function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

/** True if the two tiles' cell rectangles overlap (AC13). Touching edges (e.g. one tile's right
 * edge flush with another's left edge) do not count as a collision. */
export function collides(a: TilePlacement, b: TilePlacement): boolean {
  return rectsOverlap(a, b)
}

/**
 * Checks a candidate rect against the min-size floor, the grid's column bounds and every tile in
 * `others`, returning the first refusal reason found, or `null` if the rect is acceptable.
 *
 * Vertical bound (Decisions (Sprint), AC1/AC5): the grid is hard-bounded at `GRID_COLUMNS` (12)
 * columns, but AC5 only lists three refusal grounds - overlap, "leave the grid", and sub-minimum
 * size. "Leave the grid" has an unambiguous horizontal reading (`x`/`x+w` vs `0`/`GRID_COLUMNS`);
 * there is no symmetric hard ceiling on `y` - the story's "extends to the lowest occupied row plus
 * 2 spare rows" is how *many rows arrange mode displays* (a rendering concern for D3+), not a
 * refusal boundary here. So the only vertical check is `y >= 0` (a tile cannot move above row 0);
 * how far down a tile can go is limited only by collision with other tiles, never by an invented
 * `maxRow` refusal.
 */
function findRefusal(rect: Rect, others: readonly TilePlacement[]): string | null {
  if (rect.w < MODULE_MIN_SIZE.w || rect.h < MODULE_MIN_SIZE.h) {
    return `below the ${MODULE_MIN_SIZE.w}x${MODULE_MIN_SIZE.h} minimum size`
  }
  if (rect.x < 0 || rect.x + rect.w > GRID_COLUMNS) {
    return `leaves the grid's ${GRID_COLUMNS}-column width`
  }
  if (rect.y < 0) {
    return 'leaves the grid above its top row'
  }
  const overlapped = others.find((other) => rectsOverlap(rect, other))
  if (overlapped) {
    return `overlaps ${overlapped.moduleId}`
  }
  return null
}

/**
 * Adds a new tile for `moduleId` (not currently in `layout.tiles`) at `at`, refusing if the module
 * is already placed, the rect collides with an existing tile, leaves the grid, or is below
 * `MODULE_MIN_SIZE`. Never mutates `layout`; on success returns a new `HomeLayout` with the tile
 * appended.
 */
export function place(
  layout: HomeLayout,
  moduleId: DashboardModuleId,
  at: Rect,
): LayoutOperationResult {
  if (layout.tiles.some((tile) => tile.moduleId === moduleId)) {
    return { ok: false, reason: `${moduleId} is already placed`, layout }
  }
  const reason = findRefusal(at, layout.tiles)
  if (reason) {
    return { ok: false, reason, layout }
  }
  const tile: TilePlacement = { moduleId, x: at.x, y: at.y, w: at.w, h: at.h }
  return { ok: true, layout: { tiles: [...layout.tiles, tile] } }
}

/**
 * Relocates the existing tile for `moduleId` to `to` (same `w`/`h`), refusing on collision with
 * any OTHER tile or leaving the grid. A refusal changes nothing - every other tile keeps its exact
 * `x`/`y`/`w`/`h` (nothing is ever compacted, AC1/AC13).
 */
export function move(
  layout: HomeLayout,
  moduleId: DashboardModuleId,
  to: { x: number; y: number },
): LayoutOperationResult {
  const tile = layout.tiles.find((t) => t.moduleId === moduleId)
  if (!tile) {
    return { ok: false, reason: `${moduleId} is not placed`, layout }
  }
  const rect: Rect = { x: to.x, y: to.y, w: tile.w, h: tile.h }
  const others = layout.tiles.filter((t) => t.moduleId !== moduleId)
  const reason = findRefusal(rect, others)
  if (reason) {
    return { ok: false, reason, layout }
  }
  const tiles = layout.tiles.map((t) => (t.moduleId === moduleId ? { ...t, x: to.x, y: to.y } : t))
  return { ok: true, layout: { tiles } }
}

/**
 * Changes the existing tile for `moduleId`'s `w`/`h` (same `x`/`y`), refusing on collision,
 * leaving the grid, or dropping below `MODULE_MIN_SIZE`. A refusal changes nothing.
 */
export function resize(
  layout: HomeLayout,
  moduleId: DashboardModuleId,
  to: { w: number; h: number },
): LayoutOperationResult {
  const tile = layout.tiles.find((t) => t.moduleId === moduleId)
  if (!tile) {
    return { ok: false, reason: `${moduleId} is not placed`, layout }
  }
  const rect: Rect = { x: tile.x, y: tile.y, w: to.w, h: to.h }
  const others = layout.tiles.filter((t) => t.moduleId !== moduleId)
  const reason = findRefusal(rect, others)
  if (reason) {
    return { ok: false, reason, layout }
  }
  const tiles = layout.tiles.map((t) => (t.moduleId === moduleId ? { ...t, w: to.w, h: to.h } : t))
  return { ok: true, layout: { tiles } }
}

/**
 * Returns the tiles in row-major reading order (top-to-bottom, then left-to-right: sorted by `y`
 * then `x`) - what the narrow single-column rendering (D3) walks for AC2's "renders as a single
 * column in layout order". A pure sort into a new array; it never changes any tile's own
 * `x`/`y`/`w`/`h` - D3 is what actually stacks them visually.
 */
export function stack(layout: HomeLayout): TilePlacement[] {
  return [...layout.tiles].sort((a, b) => a.y - b.y || a.x - b.x)
}

/**
 * Scans row-major (`y` ascending, then `x` ascending, AC6/AC13) for the first `x`/`y` where a
 * `w`x`h` rect fits within the grid's column bound and doesn't collide with any existing tile.
 * Used by the catalog's "Enter places at the first free spot that fits it" (D4).
 *
 * The row scan is capped rather than unbounded: it searches from row 0 up to the lowest occupied
 * row plus a generous margin (100 rows), which is always enough room to find a spot for any
 * `w`x`h` that can fit on the grid at all, and guarantees termination.
 */
export function firstFreeSpot(layout: HomeLayout, w: number, h: number): { x: number; y: number } | null {
  const lowestOccupiedRow = layout.tiles.reduce((max, tile) => Math.max(max, tile.y + tile.h), 0)
  const rowSearchBound = lowestOccupiedRow + 100
  for (let y = 0; y <= rowSearchBound; y++) {
    for (let x = 0; x + w <= GRID_COLUMNS; x++) {
      const rect: Rect = { x, y, w, h }
      if (!layout.tiles.some((tile) => rectsOverlap(rect, tile))) {
        return { x, y }
      }
    }
  }
  return null
}
