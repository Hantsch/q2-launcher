import { Fragment, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDown, ArrowUp, Pencil, Trash2 } from 'lucide-react'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import type { ConfigActionSubcategory } from '@shared/modules/config'
import { IconButton } from '../../../components/ui/Button'
import {
  DragHandle,
  SortableItem,
  useSortableZoneState,
  type SortableZoneState,
} from '../../../components/dnd'
import { subcategoryDragId } from './ControlsDragZone'
import type { ControlsRowEntry } from '../lib/controls-row-entries'
import type { ControlsRowGroup } from '../lib/controls-row-groups'

/**
 * The grid shell for the Controls tab (story 020 D3): the 1120px-capped stage, the sticky column
 * header, sub-category group dividers (story 053 D5) and the footer legend/counts.
 * `DualBindPanel`/`DropBindPanel`'s
 * three separate row idioms collapse into this one grid for every category (movement, weapons,
 * drops and every custom category alike) — see the story's Decisions section.
 *
 * Deliberately presentational: `ControlsTab` (D4/D5/D6) hands it an already-grouped, already-
 * filtered-to-one-category entry list and owns every save/capture/collision concern itself. Row
 * rendering is a placeholder here on purpose — `renderRow` is the seam D4's real `ControlsRow`
 * plugs into without touching this file's internals; `renderPlaceholderRow` below is the default
 * until then.
 *
 * The layout is CSS grid over `role="table"/"row"/"columnheader"/"cell"` divs, not a real
 * `<table>` (story 020 decision): the column alignment needs a grid, but the header cells still
 * have to be announced as column headers.
 *
 * Story 054 D3: each rendered row is wrapped in its own `role="rowgroup"` div, a direct child of
 * the `role="table"` div, carrying `data-row-id` — a later deliverable's sortable item needs one
 * DOM element with one ref per row, and `ControlsRow` itself renders a multi-element fragment (the
 * row, the prompt host, extra-key sub-rows, the message row), so the fragment is wrapped here
 * rather than restructured there. `table > rowgroup > row` is valid ARIA, same as HTML
 * `<table><tbody><tr>`. The sub-category divider is *not* wrapped this way — it is its own
 * `role="row"` direct child of the table, sitting between one group's rows and the next, since it
 * is not itself a sortable row.
 *
 * Story 054 D4: those per-row `role="rowgroup"` elements are the sortable items of one
 * `SortableZone` (`components/dnd`, D1's single dnd-kit configuration) spanning the whole rendered
 * category. Nothing else is: a sub-category divider, a row's portalled capture-prompt host, its
 * extra-key sub-rows (story 056) and its message row (story 029) all live *inside* the rowgroup or
 * next to it without a sortable ref, so they can be neither dragged nor dropped on - one row moves
 * as one unit, with its sub-rows glued to it.
 *
 * Story 054 D5: that zone is no longer configured *here*. Category chips became drop targets too,
 * and one drag operation may only ever live in one `DndContext`, so `ControlsDragZone` now wraps
 * both the rail and this grid from `ControlsTab`. This file therefore only renders the sortable
 * items and reads the live drag state through `useSortableZoneState()` - which reports "no drag"
 * when there is no zone above it, so the grid still renders (inert) on its own in a test.
 *
 * Story 054 D6: the sub-category divider becomes a second, distinct sortable axis - headers
 * reorder among themselves, not interleaved with the rows in the same list. It shares
 * `ControlsDragZone`'s one `DndContext` (a header's `SortableItem` id, `subcategoryDragId`, is
 * never one of that zone's own `items`, so a header drop resolves through its `onDropOutside`,
 * the same seam D5's category-chip drop already uses), but needs its *own* `SortableContext` -
 * dnd-kit's `items` list, read by `useSortable` to place the dragged copy and animate its
 * siblings, would otherwise be the enclosing zone's row ids, and a header is never one of those.
 * Each header is wrapped in its own instance of that context (all sharing the same header-id
 * list) rather than one context spanning the whole grid, because the rows sitting between two
 * headers in the DOM must stay under the *row* `SortableContext` `ControlsDragZone` already
 * provides - nesting a header-scoped context around the rows too would steal their own sorting
 * context out from under them.
 */
export interface ControlsGridProps {
  /** Accessible name for the `role="table"` container, e.g. "Controls — Movement". */
  ariaLabel: string
  /** Sub-category-grouped, category-filtered rows in profile order — see `groupControlsRowEntries`. */
  groups: ControlsRowGroup[]
  /**
   * Renders one row's content. `index` is this row's position across the *whole* filtered row
   * list (not per-group) — D4's `ControlsRow` uses it to compute zebra parity explicitly, since
   * CSS `:nth-of-type` resets at every group divider (see `ControlsRow`'s doc comment). `grip` is
   * this row's `DragHandle`, already wired to the sortable item and to the disabled state — the
   * caller only has to hand it to `ControlsRow`'s `grip` prop, which puts it in the reserved
   * `.ctrl-grip` cell (story 054 D3/D4). Defaults to `renderPlaceholderRow` (name only) for a
   * caller that has not wired D4 yet.
   */
  renderRow?: (entry: ControlsRowEntry, index: number, grip: ReactNode) => ReactNode
  /** Footer's "n rows" — the count of rows on screen, which follows the filter once D8 lands. */
  rowCount: number
  /** Footer's "m bound" — how many of `rowCount` carry at least one key. */
  boundCount: number
  /**
   * Story 053 D6: the group header's own rename/reorder/delete affordances - mirroring the
   * category rail's chip CRUD (`ControlsTab.tsx`'s category rail), just one level down. Optional so
   * a caller with nothing to wire (there are none today, but `renderRow`'s own default shows the
   * precedent) still gets a plain header with no buttons rather than a crash.
   */
  onRenameSubcategory?: (subcategory: ConfigActionSubcategory) => void
  onMoveSubcategory?: (subcategoryId: string, direction: 'up' | 'down') => void
  onDeleteSubcategory?: (subcategoryId: string) => void
  /**
   * Story 054's decision: dragging is off while the Controls filter narrows the list, because a
   * drop between two *visible* rows has no defined array position among the hidden ones and order
   * is array position (story 019). The grip stays present and focusable, disabled with an
   * explaining tooltip.
   */
  dragDisabled?: boolean
}

/** Fallback row for a caller that has not wired D4's `ControlsRow` yet: the entry's name only, in
 * the Action column. Deliberately hook-free (no `useTranslation`) since it may run inside another
 * component's render — a catalogue row's name here is its raw command text, not its i18n label
 * (resolving that needs `t()`, which is the caller's job once it wires the real row). */
function renderPlaceholderRow(entry: ControlsRowEntry): ReactNode {
  const key = entry.kind === 'catalog' ? entry.row.catalogId : entry.action.id
  const name =
    entry.kind === 'catalog' ? (entry.row.commands[0] ?? entry.row.catalogId) : entry.action.name
  return (
    <div key={key} className="ctrl-row" role="row">
      <span className="ctrl-label" role="cell">
        {name}
      </span>
    </div>
  )
}

export function ControlsGrid({
  ariaLabel,
  groups,
  renderRow = renderPlaceholderRow,
  rowCount,
  boundCount,
  onRenameSubcategory,
  onMoveSubcategory,
  onDeleteSubcategory,
  dragDisabled = false,
}: ControlsGridProps) {
  const { t } = useTranslation()
  const drag = useSortableZoneState()

  // Story 053 D6: move up/down is disabled at the first/last *sub-category* group - the ungrouped
  // run (`subcategory: null`) is never itself a target, so it does not count. Counted up front
  // (not read off `categories.subcategories.length` directly) so this stays correct even for a
  // filtered view where a whole sub-category group can still be empty but always renders (D5).
  const subcategoryCount = groups.filter((group) => group.subcategory !== null).length

  // Story 054 D4: the zebra index each row is rendered with comes from the rendered row list (a
  // lookup, not a counter mutated inside a render callback), so a row's parity cannot drift out of
  // step with its position when only part of the tree re-renders mid-drag.
  const rowIndexById = new Map(
    groups.flatMap((group) => group.entries).map((entry, index) => [entry.action.id, index]),
  )
  /** Each real sub-category's position among the sub-categories (the ungrouped run has none) -
   * what the header's move up/down buttons are enabled from. */
  const subcategoryOrdinals = new Map<number, number>()
  groups.forEach((group, groupIndex) => {
    if (group.subcategory) subcategoryOrdinals.set(groupIndex, subcategoryOrdinals.size)
  })

  /** The drop-indicator classes (`controls-grid.css`, story 054 D1) for one row: a line on the
   * edge the dragged row would land on, drawn on the hovered row only. */
  function dropIndicatorClass(rowId: string, drag: SortableZoneState): string {
    if (drag.activeId === null || drag.overId !== rowId || drag.activeId === rowId) return ''
    return `ctrl-drop-indicator ${drag.movingDown ? 'ctrl-drop-indicator-bottom' : 'ctrl-drop-indicator-top'}`
  }

  // Story 054 D6: every real sub-category's header drag id, in rendered order - the id-space
  // `SortableContext` for the headers (see the module doc comment) and what a header's own
  // drop-indicator direction is computed against, since `SortableZoneState.movingDown` above is
  // scoped to the row zone's ids and would be wrong for a header (never found there).
  const headerDragIds = groups
    .map((group) => group.subcategory?.id)
    .filter((id): id is string => id !== undefined)
    .map((id) => subcategoryDragId(id))

  /** Same drop-indicator idea as `dropIndicatorClass`, but resolved against `headerDragIds`'
   * own order rather than the row zone's `SortableZoneState.movingDown` (rows-only). */
  function subcategoryDropIndicatorClass(subcategoryId: string, drag: SortableZoneState): string {
    const dragId = subcategoryDragId(subcategoryId)
    if (drag.activeId === null || drag.overId !== dragId || drag.activeId === dragId) return ''
    const activeIndex = headerDragIds.indexOf(drag.activeId)
    const overIndex = headerDragIds.indexOf(dragId)
    const movingDown = activeIndex >= 0 && overIndex > activeIndex
    return `ctrl-drop-indicator ${movingDown ? 'ctrl-drop-indicator-bottom' : 'ctrl-drop-indicator-top'}`
  }

  return (
    // Review fix (finding 1): `.ctrl-foot` is a caption/summary area below the table, not part of
    // it - a `table`'s only valid children are rows (via `rowgroup`), so the footer now lives here,
    // outside the `role="table"` div's DOM boundary entirely, both still capped by this wrapper.
    <div className="ctrl-stage">
      <div role="table" aria-label={ariaLabel}>
        <div className="ctrl-colhead" role="row">
          <span className="ctrl-colhead-slot" role="columnheader">
            {/* Story 054 D3/D4: the leading grip column's header - `sr-only`, since each grip
                below carries its own accessible name and the column itself shows no label. */}
            <span className="sr-only">{t('config.controls.grid.colGrip')}</span>
          </span>
          <span role="columnheader">{t('config.controls.grid.colAction')}</span>
          <span className="ctrl-colhead-slot" role="columnheader">
            <span className="sr-only">{t('config.controls.grid.colReset')}</span>
          </span>
          <span className="ctrl-colhead-slot" role="columnheader">
            {t('config.controls.grid.colKey')}
          </span>
          <span role="columnheader">{t('config.controls.grid.colOptions')}</span>
        </div>

        {groups.map((group, groupIndex) => {
          const subcategory = group.subcategory
          const subcategoryIndex = subcategoryOrdinals.get(groupIndex) ?? -1
          return (
            <Fragment key={subcategory?.id ?? `ungrouped-${groupIndex}`}>
              {subcategory && (
                // Story 054 D6: its own `SortableContext` (see the module doc comment) - the
                // header-id list is the same on every instance, so all the headers still animate
                // as one sorted group even though a run of rows sits between any two of them in the
                // DOM.
                <SortableContext items={headerDragIds} strategy={verticalListSortingStrategy}>
                  <SortableItem
                    id={subcategoryDragId(subcategory.id)}
                    disabled={dragDisabled}
                    data={{ label: subcategory.name }}
                  >
                    {({ setNodeRef, style, attributes, listeners, isDragging }) => (
                      <div
                        ref={setNodeRef}
                        style={style}
                        className={[
                          'ctrl-group',
                          isDragging && 'is-dragging',
                          subcategoryDropIndicatorClass(subcategory.id, drag),
                        ]
                          .filter((part): part is string => Boolean(part))
                          .join(' ')}
                        role="row"
                        data-subcategory-id={subcategory.id}
                      >
                        {/* Review fix (finding 1): an ARIA `row` may only contain `cell`/
                            `columnheader`/`rowheader` children - the divider's three spans used to
                            be bare `row` children (an invalid "row with no cells"). One
                            `role="cell"` spanning the full row now carries the eyebrow/rule/count
                            as a single announcement.

                            Story 053 D5: the header is the sub-category's own `name` - the
                            profile's data, not an i18n key lookup (a sub-category is
                            user-typed/user-authored structure, same reasoning
                            `categoryDisplayName` already applies to a renamed category). */}
                        <span className="ctrl-group-cell" role="cell">
                          {/* Story 054 D6: reuses D1's `DragHandle`/the row grip's disabled-while-
                              filtering tooltip - dragging a header is off for exactly the same
                              reason a row's is (story 054's decision: order is array position, and
                              a drop among the sub-categories the filter is hiding has no defined
                              position). */}
                          <DragHandle
                            className="ctrl-grip-handle"
                            attributes={attributes}
                            listeners={listeners}
                            disabled={dragDisabled}
                            disabledReason={t('config.controls.grid.gripFilterActive')}
                          />
                          <span className="ctrl-group-eyebrow">{subcategory.name}</span>
                          <span className="ctrl-group-rule" aria-hidden="true" />
                          <span className="ctrl-group-eyebrow">
                            {t('config.controls.grid.groupCount', { count: group.entries.length })}
                          </span>
                          {/* Story 053 D6: create lives one level up (the category's own toolbar,
                              `ControlsTab.tsx`); reorder now has both the drag grip above and these
                              buttons - move up/down/rename/delete are scoped to a single header. */}
                          <span className="ctrl-group-crud">
                            <IconButton
                              label={t('config.controls.subcategory.moveUp')}
                              size="sm"
                              disabled={subcategoryIndex === 0}
                              onClick={() => onMoveSubcategory?.(subcategory.id, 'up')}
                            >
                              <ArrowUp className="size-3.5" />
                            </IconButton>
                            <IconButton
                              label={t('config.controls.subcategory.moveDown')}
                              size="sm"
                              disabled={subcategoryIndex === subcategoryCount - 1}
                              onClick={() => onMoveSubcategory?.(subcategory.id, 'down')}
                            >
                              <ArrowDown className="size-3.5" />
                            </IconButton>
                            <IconButton
                              label={t('config.controls.subcategory.rename')}
                              size="sm"
                              onClick={() => onRenameSubcategory?.(subcategory)}
                            >
                              <Pencil className="size-3.5" />
                            </IconButton>
                            <IconButton
                              label={t('config.controls.subcategory.delete')}
                              size="sm"
                              variant="danger"
                              onClick={() => onDeleteSubcategory?.(subcategory.id)}
                            >
                              <Trash2 className="size-3.5" />
                            </IconButton>
                          </span>
                        </span>
                      </div>
                    )}
                  </SortableItem>
                </SortableContext>
              )}
              {group.entries.map((entry) => (
                <SortableItem
                  key={entry.action.id}
                  id={entry.action.id}
                  data={{
                    label:
                      entry.kind === 'catalog'
                        ? (entry.row.commands[0] ?? entry.row.catalogId)
                        : entry.action.name,
                  }}
                >
                  {({ setNodeRef, style, attributes, listeners, isDragging }) => (
                    <div
                      ref={setNodeRef}
                      style={style}
                      className={[
                        'ctrl-rowgroup',
                        isDragging && 'is-dragging',
                        dropIndicatorClass(entry.action.id, drag),
                      ]
                        .filter((part): part is string => Boolean(part))
                        .join(' ')}
                      role="rowgroup"
                      data-row-id={entry.action.id}
                    >
                      {renderRow(
                        entry,
                        rowIndexById.get(entry.action.id) ?? 0,
                        <DragHandle
                          className="ctrl-grip-handle"
                          attributes={attributes}
                          listeners={listeners}
                          disabled={dragDisabled}
                          disabledReason={t('config.controls.grid.gripFilterActive')}
                        />,
                      )}
                    </div>
                  )}
                </SortableItem>
              ))}
            </Fragment>
          )
        })}
      </div>

      <div className="ctrl-foot">
        <span>
          <span className="ctrl-kbd">ESC</span> {t('config.controls.grid.legendCancel')}
          {' · '}
          <span className="ctrl-kbd">DEL</span> {t('config.controls.grid.legendClear')}
          {' · '}
          <span className="ctrl-kbd">ALT</span>+{t('config.controls.grid.legendKey')} →{' '}
          {t('config.controls.grid.legendLayer')}
        </span>
        <span className="ctrl-foot-spacer" />
        <span>
          {t('config.controls.grid.footerRows', { count: rowCount })}
          {' · '}
          {t('config.controls.grid.footerBound', { count: boundCount })}
        </span>
      </div>
    </div>
  )
}
