import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { useDraggable } from '@dnd-kit/core'
import { GripVertical, Move, MoveDiagonal, X } from 'lucide-react'
import type { DashboardModuleId, TilePlacement } from '@shared/modules/home'
import { Panel } from '../../../components/ui/primitives'
import { IconButton } from '../../../components/ui/Button'
import { DASHBOARD_MODULES } from './dashboard-modules'
import { useTileLift, type UseTileLiftOptions } from './useTileLift'

/**
 * Story 086 D6: the three callbacks a tile's keyboard lift needs, owned by `Dashboard.tsx` (the only
 * place that holds the layout, the reducer and the `setHomeLayout` call) and threaded down through
 * `DashboardGrid.tsx` unchanged. Named as one group because all three travel together.
 */
export interface TileKeyboardHandlers {
  onKeyboardChange: UseTileLiftOptions['onKeyboardChange']
  onKeyboardCancel: UseTileLiftOptions['onCancel']
  onAnnounce: UseTileLiftOptions['onAnnounce']
}

/**
 * Story 086 D3: one dashboard tile - a framed `Panel` showing only its module's title (story 087
 * fills the body; a titled frame is all this D needs).
 *
 * Story 086 D4: outside arrange mode a tile is still ordinary content - no grip, no resize handle,
 * no button (AC3). `arrangeMode` (threaded down from `Dashboard.tsx` via `DashboardGrid.tsx`) gates
 * two affordances:
 *
 * - the grip (`dashboard-tile-grip-<moduleId>`) carries `@dnd-kit`'s pointer listeners since D5;
 *   D6 attaches the keyboard lift state machine on top. Its `data-testid` deliberately contains
 *   the literal substring "grip" -
 *   `scripts/flows/home-dashboard-arrange.mjs`'s existing "no drag outside arrange mode" step
 *   already asserts zero such elements outside arrange mode, and since this only renders when
 *   `arrangeMode` is true, that assertion (which runs before arrange mode is ever entered) keeps
 *   passing unchanged.
 * - "return to catalog" (`dashboard-tile-remove-<moduleId>`) IS fully functional here - its
 *   `onClick` calls `onRemove(tile.moduleId)`, which `Dashboard.tsx` wires to a whole-layout
 *   `setHomeLayout` call (AC7).
 *
 * `style` carries the tile's grid placement (`DashboardGrid`'s job to compute); this component
 * never touches geometry itself, only renders whatever it is given.
 *
 * Story 086 D5: two `useDraggable`s - one per gesture (`move-<moduleId>` on the title-row grip,
 * `resize-<moduleId>` on the new bottom-right corner grip). Both are called unconditionally (rules
 * of hooks) and both pass `disabled: !arrangeMode`, so a tile is inert outside arrange mode by its
 * own contract and not merely because `Dashboard.tsx` leaves the `DndContext` unmounted (AC3).
 * Each grip's `setNodeRef` goes on a wrapping `<span>` rather than the `IconButton` itself, which
 * takes no `ref`; dnd-kit only needs *a* measured node per draggable, and the span has the
 * button's exact box.
 *
 * This component still knows nothing about cells or pixels: the drag `data` it publishes is just
 * `{ kind, moduleId }`, and `Dashboard.tsx` - which owns the layout and the reducer - turns pointer
 * deltas into candidate placements.
 *
 * Story 086 D6: the same move grip additionally carries the keyboard lift (`useTileLift`) via
 * `onKeyDown`/`onBlur` - Space lifts, arrows move, Shift+arrows resize, Enter drops, Escape/blur/Tab
 * cancel (AC8). The two paths cannot collide: `moveDrag.listeners` is pointer-only (no
 * `KeyboardSensor` is configured anywhere, see `Dashboard.tsx`), so nothing in dnd-kit's spread
 * reacts to a key at all. The lift's own announcements are built here, where `useTranslation` lives,
 * exactly like the grip's label - `useTileLift` itself stays translation-agnostic.
 *
 * There is deliberately no local "candidate placement" while lifted: every accepted keystroke is
 * committed by `Dashboard.tsx` right away, so the `style` prop this tile is *already* handed on the
 * next render is the live geometry (see `useTileLift.ts`'s doc comment for why the alternative is
 * wrong, not merely more work). A lifted grip only looks different - a `Move` icon in the `primary`
 * variant plus `data-lifted` - which is feedback for a sighted keyboard user, not the a11y contract;
 * that is the live region in `ArrangeBar.tsx` (AC9).
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
        <h2 className="min-w-0 truncate font-display text-sm tracking-[0.06em] text-ink uppercase">
          {title}
        </h2>
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
