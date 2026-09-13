import { useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useDraggable } from '@dnd-kit/core'
import { DASHBOARD_MODULE_IDS, type DashboardModuleId, type HomeLayout } from '@shared/modules/home'
import { Panel } from '../../../components/ui/primitives'
import { Button } from '../../../components/ui/Button'
import { DASHBOARD_MODULES } from './dashboard-modules'
import { ResetLayoutDialog } from './ResetLayoutDialog'

/**
 * Story 086 D4: the catalog + status line, docked absolutely over the dashboard grid (AC4) - see
 * `Dashboard.tsx`'s doc comment for why it mounts here rather than being lifted into
 * `HomeView.tsx`. `.dashboard-arrange-bar` (dashboard.css) does the actual docking; this component
 * only owns content.
 *
 * The catalog (`DASHBOARD_MODULE_IDS` minus whatever `layout.tiles` already places) responds to
 * Enter and to a pointer drag, never to a plain click (AC6) - see `CatalogEntry` below.
 *
 * "Reset to default" opens `ResetLayoutDialog` from local state, never the global dialog store
 * (see that component's own doc comment).
 */
export function ArrangeBar({
  layout,
  status,
  onPlace,
  onReset,
}: {
  layout: HomeLayout
  status: string
  onPlace: (moduleId: DashboardModuleId) => void
  onReset: () => void
}) {
  const { t } = useTranslation()
  const [resetDialogOpen, setResetDialogOpen] = useState(false)

  const unplacedIds = DASHBOARD_MODULE_IDS.filter(
    (id) => !layout.tiles.some((tile) => tile.moduleId === id),
  )

  // `pl-11` overrides `p-3`'s left edge: the arrange toggle (`ArrangeToggle.tsx`) is docked at
  // `left-3` of the same slot in BOTH modes, so the bar's content has to start clear of it -
  // 12px inset + a 28px button + 4px breathing room.
  return (
    <Panel raised className="dashboard-arrange-bar flex flex-wrap items-center gap-3 p-3 pl-11">
      <div data-testid="dashboard-catalog" className="flex flex-1 flex-wrap items-center gap-2">
        {unplacedIds.length === 0 ? (
          <p className="text-xs text-ink-muted">{t('home.dashboard.catalog.empty')}</p>
        ) : (
          unplacedIds.map((id) => <CatalogEntry key={id} moduleId={id} onPlace={onPlace} />)
        )}
      </div>

      {/* Story 086 D6: the visible status line IS the live region (AC9's "announced in a live
          region and mirrored in a visible status line") - one element, so the two texts cannot
          drift apart, and no second hidden node a screen reader would read twice. `aria-atomic`
          because each announcement is a whole new sentence, not an append. */}
      <p
        data-testid="dashboard-status-line"
        aria-live="polite"
        aria-atomic="true"
        className="min-w-0 flex-1 truncate text-xs text-ink-dim"
      >
        {status}
      </p>

      <Button
        variant="danger"
        size="sm"
        data-testid="dashboard-reset-trigger"
        onClick={() => setResetDialogOpen(true)}
      >
        {t('home.dashboard.arrangeBar.reset')}
      </Button>

      {resetDialogOpen && (
        <ResetLayoutDialog
          onClose={() => setResetDialogOpen(false)}
          onConfirm={() => {
            onReset()
            setResetDialogOpen(false)
          }}
        />
      )}
    </Panel>
  )
}

/**
 * One catalog chip. Its own component rather than JSX inside `unplacedIds.map()` because
 * `useDraggable` is a hook and cannot be called in a map callback (story 086 D5).
 *
 * Two ways in, both deliberate:
 * - **Enter** places the module at the first free spot that fits it (D4, unchanged here).
 * - **A pointer drag** (`place-<moduleId>`, picked up by `Dashboard.tsx`'s `DndContext`) places it
 *   at the cell under the pointer.
 *
 * Still no `onClick`: a click and a drag start on the same element, and dnd-kit's `PointerSensor`
 * only suppresses the click once its activation distance is exceeded - a plain click would
 * therefore place the module a second time at a spot the user never pointed at. The two paths
 * above cannot collide: dnd-kit's `listeners` are pointer-only (no `KeyboardSensor` is configured),
 * so nothing here reacts to Enter except `onKeyDown`.
 */
function CatalogEntry({
  moduleId,
  onPlace,
}: {
  moduleId: DashboardModuleId
  onPlace: (moduleId: DashboardModuleId) => void
}) {
  const { t } = useTranslation()
  const { attributes, listeners, setNodeRef } = useDraggable({
    id: `place-${moduleId}`,
    data: { kind: 'place', moduleId },
  })

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== 'Enter') return
    event.preventDefault()
    onPlace(moduleId)
  }

  return (
    <button
      ref={setNodeRef}
      type="button"
      data-testid={`dashboard-catalog-entry-${moduleId}`}
      className="rounded-sm border border-line-strong bg-hover px-2.5 py-1.5 text-xs text-ink transition-colors duration-[--dur-fast] ease-[--ease-out-quart] hover:bg-active"
      {...attributes}
      {...listeners}
      onKeyDown={handleKeyDown}
    >
      {t(DASHBOARD_MODULES[moduleId].titleKey)}
    </button>
  )
}
