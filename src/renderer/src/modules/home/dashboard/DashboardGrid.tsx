import type { CSSProperties, RefObject } from 'react'
import {
  GRID_COLUMNS,
  GRID_ROW_HEIGHT,
  NARROW_THRESHOLD_PX,
  type DashboardModuleId,
  type HomeLayout,
} from '@shared/modules/home'
import { stack } from './layout'
import { DashboardTile, type TileKeyboardHandlers } from './DashboardTile'

/**
 * Story 086 D3: renders a `HomeLayout` one of two ways, decided purely by the dashboard container's
 * own measured `width` (never `window.innerWidth` - Decisions (Sprint), so the threshold is
 * reachable at the window's own 940px minimum):
 *
 * - `width >= NARROW_THRESHOLD_PX`: a real CSS Grid, `GRID_COLUMNS` wide with `GRID_ROW_HEIGHT`px
 *   rows. Each tile's stored `x`/`y`/`w`/`h` (cells) becomes a `gridColumn`/`gridRow` shorthand via
 *   React's `style` prop - a CSSOM write, never a parsed style attribute string (the production CSP
 *   rule, ARCHITECTURE.md). This is a direct rendering of `layout.tiles`, nothing more: a gap
 *   between tiles renders as empty grid cells, never compacted.
 * - `width < NARROW_THRESHOLD_PX`: `stack()` (the D2 pure engine)'s row-major reading order,
 *   rendered as a plain single column, full width, ignoring each tile's stored `w`/`h` - visual
 *   order only. The stored geometry is untouched underneath; nothing here ever calls
 *   `setHomeLayout`, so widening back out restores the grid exactly.
 *
 * `width === 0` (not yet measured, e.g. the first paint before `ResizeObserver` reports) falls
 * through to grid mode rather than narrow mode, so a not-yet-measured container never
 * flash-renders as a single column.
 *
 * Story 086 D4: `arrangeMode`/`onRemoveTile` are threaded straight down to every `DashboardTile` -
 * this component decides nothing about arrange mode itself beyond passing it on. `Dashboard.tsx`
 * already folds its own `isNarrow` guard into `arrangeMode` before it reaches here, so the stack
 * branch below never actually receives `true` in practice, but it still passes the prop through
 * uniformly rather than special-casing narrow mode a second time.
 *
 * Story 086 D5: `gridRef` is attached to whichever root actually renders. `Dashboard.tsx` reads its
 * `getBoundingClientRect()` to turn a pointer position into a grid cell for a drag out of the
 * catalog - its own outer container also spans `HomeHeader`, so measuring that instead would offset
 * every dropped tile by the header's height.
 *
 * Story 086 D6: `TileKeyboardHandlers` (`onKeyboardChange`/`onKeyboardCancel`/`onAnnounce`) is
 * threaded straight down to every tile exactly like `onRemoveTile` - the keyboard lift state machine
 * lives on the tile's grip (`useTileLift`), its reducer and its `setHomeLayout` call live in
 * `Dashboard.tsx`, and this component adds no logic to either end. Spread as one group rather than
 * re-declared prop by prop, so a future fourth callback needs no change here at all.
 */
export function DashboardGrid({
  layout,
  width,
  arrangeMode,
  onRemoveTile,
  gridRef,
  ...keyboard
}: {
  layout: HomeLayout
  width: number
  arrangeMode: boolean
  onRemoveTile: (moduleId: DashboardModuleId) => void
  gridRef?: RefObject<HTMLDivElement | null>
} & TileKeyboardHandlers) {
  const isNarrow = width > 0 && width < NARROW_THRESHOLD_PX

  if (isNarrow) {
    return (
      <div ref={gridRef} className="dashboard-stack">
        {stack(layout).map((tile) => (
          <DashboardTile
            key={tile.moduleId}
            tile={tile}
            arrangeMode={arrangeMode}
            onRemove={onRemoveTile}
            {...keyboard}
          />
        ))}
      </div>
    )
  }

  const gridStyle: CSSProperties = {
    gridTemplateColumns: `repeat(${GRID_COLUMNS}, 1fr)`,
    gridAutoRows: `${GRID_ROW_HEIGHT}px`,
  }

  return (
    <div ref={gridRef} className="dashboard-grid" style={gridStyle}>
      {layout.tiles.map((tile) => {
        const tileStyle: CSSProperties = {
          gridColumn: `${tile.x + 1} / span ${tile.w}`,
          gridRow: `${tile.y + 1} / span ${tile.h}`,
        }
        return (
          <DashboardTile
            key={tile.moduleId}
            tile={tile}
            style={tileStyle}
            arrangeMode={arrangeMode}
            onRemove={onRemoveTile}
            {...keyboard}
          />
        )
      })}
    </div>
  )
}
