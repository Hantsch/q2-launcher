import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { useDraggable } from '@dnd-kit/core'
import { GripVertical, Move, MoveDiagonal, X } from 'lucide-react'
import type { DashboardModuleId, TilePlacement } from '@shared/modules/home'
import { Panel } from '../../../components/ui/primitives'
import { Button, IconButton } from '../../../components/ui/Button'
import { ErrorBoundary } from '../../../components/ui/ErrorBoundary'
import { DASHBOARD_MODULES } from './dashboard-modules'
import { useTileLift, type UseTileLiftOptions } from './useTileLift'

/**
 * Story 086: the three callbacks a tile's keyboard lift needs, owned by `Dashboard.tsx` (the only
 * place that holds the layout, the reducer and the `setHomeLayout` call) and threaded down through
 * `DashboardGrid.tsx` unchanged. Named as one group because all three travel together.
 */
export interface TileKeyboardHandlers {
  onKeyboardChange: UseTileLiftOptions['onKeyboardChange']
  onKeyboardCancel: UseTileLiftOptions['onCancel']
  onAnnounce: UseTileLiftOptions['onAnnounce']
}

/**
 * Story 086: one dashboard tile - a framed `Panel` showing its module's title. Story 087
 * adds the body: `definition.Body` renders below the header row, in a `flex min-h-0 flex-1
 * flex-col overflow-hidden` wrapper so a tile's own content can scroll/clip inside its grid-cell
 * height without ever pushing the `Panel` taller than the cells `DashboardGrid` allotted it.
 * Review fix (second cycle): that wrapper must itself be a flex container (`flex flex-col`), not
 * a plain block box that merely carries `min-h-0 flex-1` - `min-h-0 flex-1` only bounds this div
 * because ITS parent (`Panel`) is `flex flex-col`; the frame further down
 * (`DashboardTileFrame.tsx`'s `flex min-h-0 flex-1 flex-col`) needs THIS div to establish its own
 * flex formatting context too, or its own `flex-1` has nothing to size against and the whole
 * chain collapses to content height - the exact bug that let a long Config Profiles list render
 * unclipped with no scrollbar.
 *
 * Review fix (post-087): `definition.Body` is wrapped in its own `ErrorBoundary`
 * here, not just inside whatever `<DashboardTileFrame state="filled">` it renders internally.
 * `DashboardTileFrame`'s own `ErrorBoundary` only covers the `children` a tile hands it -
 * that's a sibling/descendant relationship that starts only once the tile's function body has
 * already run. A tile computes derived data (`Object.entries(data.byEngine)`,
 * `toConfigProfileRows(...)`, ...) before it ever constructs that element, so a throw during that
 * computation happens one level above the frame's boundary and would otherwise propagate past this
 * whole module straight to `App.tsx`'s top-level boundary, blanking the entire app instead of just
 * this tile. This boundary is deliberately independent of the frame's, which stays unaware of anything
 * above it. Review fix (second cycle): the boundary is also handed this tile's own `title` (the
 * same string `DashboardTileFrame`'s heading would have shown) and renders it above the fallback
 * message, because the throw happens before `definition.Body` ever reaches `DashboardTileFrame` -
 * without it, the fallback gave no indication of which tile had failed, and outside arrange mode
 * the `Panel` had no accessible name at all.
 *
 * Story 086: outside arrange mode a tile is still ordinary content - no grip, no resize handle,
 * no button. `arrangeMode` (threaded down from `Dashboard.tsx` via `DashboardGrid.tsx`) gates
 * two affordances:
 *
 * - the grip (`dashboard-tile-grip-<moduleId>`) carries `@dnd-kit`'s pointer listeners; the
 *   keyboard lift state machine on top. Its `data-testid` deliberately contains
 *   the literal substring "grip" -
 *   `scripts/flows/home-dashboard-arrange.mjs`'s existing "no drag outside arrange mode" step
 *   already asserts zero such elements outside arrange mode, and since this only renders when
 *   `arrangeMode` is true, that assertion (which runs before arrange mode is ever entered) keeps
 *   passing unchanged.
 * - "return to catalog" (`dashboard-tile-remove-<moduleId>`) IS fully functional here - its
 *   `onClick` calls `onRemove(tile.moduleId)`, which `Dashboard.tsx` wires to a whole-layout
 *   `setHomeLayout` call.
 *
 * `style` carries the tile's grid placement (`DashboardGrid`'s job to compute); this component
 * never touches geometry itself, only renders whatever it is given.
 *
 * Story 086: two `useDraggable`s - one per gesture (`move-<moduleId>` on the title-row grip,
 * `resize-<moduleId>` on the new bottom-right corner grip). Both are called unconditionally (rules
 * of hooks) and both pass `disabled: !arrangeMode`, so a tile is inert outside arrange mode by its
 * own contract and not merely because `Dashboard.tsx` leaves the `DndContext` unmounted.
 * Each grip's `setNodeRef` goes on a wrapping `<span>` rather than the `IconButton` itself, which
 * takes no `ref`; dnd-kit only needs *a* measured node per draggable, and the span has the
 * button's exact box.
 *
 * This component still knows nothing about cells or pixels: the drag `data` it publishes is just
 * `{ kind, moduleId }`, and `Dashboard.tsx` - which owns the layout and the reducer - turns pointer
 * deltas into candidate placements.
 *
 * Story 086: the same move grip additionally carries the keyboard lift (`useTileLift`) via
 * `onKeyDown`/`onBlur` - Space lifts, arrows move, Shift+arrows resize, Enter drops, Escape/blur/Tab
 * cancel. The two paths cannot collide: `moveDrag.listeners` is pointer-only (no
 * `KeyboardSensor` is configured anywhere, see `Dashboard.tsx`), so nothing in dnd-kit's spread
 * reacts to a key at all. The lift's own announcements are built here, where `useTranslation` lives,
 * exactly like the grip's label - `useTileLift` itself stays translation-agnostic.
 *
 * There is deliberately no local "candidate placement" while lifted: every accepted keystroke is
 * committed by `Dashboard.tsx` right away, so the `style` prop this tile is *already* handed on the
 * next render is the live geometry (see `useTileLift.ts`'s doc comment for why the alternative is
 * wrong, not merely more work). A lifted grip only looks different - a `Move` icon in the `primary`
 * variant plus `data-lifted` - which is feedback for a sighted keyboard user, not the a11y contract;
 * that is the live region in `ArrangeBar.tsx`.
 */
export function DashboardTile({
  tile,
  style,
  arrangeMode = false,
  onRemove,
  onKeyboardChange,
  onKeyboardCancel,
  onAnnounce,
}: {
  tile: TilePlacement
  style?: CSSProperties
  arrangeMode?: boolean
  onRemove?: (moduleId: DashboardModuleId) => void
} & TileKeyboardHandlers) {
  const { t } = useTranslation()
  const definition = DASHBOARD_MODULES[tile.moduleId]
  const title = t(definition.titleKey)

  const moveDrag = useDraggable({
    id: `move-${tile.moduleId}`,
    data: { kind: 'move', moduleId: tile.moduleId },
    disabled: !arrangeMode,
  })
  const resizeDrag = useDraggable({
    id: `resize-${tile.moduleId}`,
    data: { kind: 'resize', moduleId: tile.moduleId },
    disabled: !arrangeMode,
  })

  const lift = useTileLift({
    tile,
    disabled: !arrangeMode,
    onKeyboardChange,
    onCancel: onKeyboardCancel,
    onAnnounce,
    liftedText: t('home.dashboard.status.lifted', { title }),
    droppedText: t('home.dashboard.status.dropped', { title }),
  })

  return (
    <Panel
      data-testid={`dashboard-tile-${tile.moduleId}`}
      className="relative flex min-h-0 flex-col gap-2 overflow-hidden p-4"
      style={style}
    >
      <div className="flex items-center justify-between gap-2">
        {arrangeMode && (
          <div className="flex shrink-0 items-center gap-1">
            <span ref={moveDrag.setNodeRef} className="inline-flex">
              <IconButton
                label={t('home.dashboard.tile.grip', { title })}
                size="sm"
                variant={lift.lifted ? 'primary' : 'ghost'}
                data-testid={`dashboard-tile-grip-${tile.moduleId}`}
                data-lifted={lift.lifted ? 'true' : 'false'}
                {...moveDrag.attributes}
                {...moveDrag.listeners}
                onKeyDown={lift.handleKeyDown}
                onBlur={lift.handleBlur}
              >
                {lift.lifted ? (
                  <Move className="size-3.5" />
                ) : (
                  <GripVertical className="size-3.5" />
                )}
              </IconButton>
            </span>
            <IconButton
              label={t('home.dashboard.tile.remove', { title })}
              size="sm"
              data-testid={`dashboard-tile-remove-${tile.moduleId}`}
              onClick={() => onRemove?.(tile.moduleId)}
            >
              <X className="size-3.5" />
            </IconButton>
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <ErrorBoundary
          scope="dashboard tile"
          fallback={(_error, reset) => (
            <div
              data-testid="dashboard-tile-render-error"
              className="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-6 text-center"
            >
              <h2 className="min-w-0 shrink-0 truncate font-display text-xs tracking-[0.08em] text-ink-dim uppercase">
                {title}
              </h2>
              <p className="text-sm text-ink-dim">{t('home.dashboard.tileFrame.renderError')}</p>
              <Button size="sm" onClick={reset} data-testid="dashboard-tile-render-error-retry">
                {t('common.action.retry')}
              </Button>
            </div>
          )}
        >
          <definition.Body />
        </ErrorBoundary>
      </div>

      {arrangeMode && (
        <span ref={resizeDrag.setNodeRef} className="absolute right-1 bottom-1 inline-flex">
          <IconButton
            label={t('home.dashboard.tile.resize', { title })}
            size="sm"
            data-testid={`dashboard-tile-resize-${tile.moduleId}`}
            {...resizeDrag.attributes}
            {...resizeDrag.listeners}
          >
            <MoveDiagonal className="size-3.5" />
          </IconButton>
        </span>
      )}
    </Panel>
  )
}
