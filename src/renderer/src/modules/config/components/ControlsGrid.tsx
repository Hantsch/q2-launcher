import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDown, ArrowUp, Pencil, Trash2 } from 'lucide-react'
import type { ConfigActionSubcategory } from '@shared/modules/config'
import { IconButton } from '../../../components/ui/Button'
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
 */
export interface ControlsGridProps {
  /** Accessible name for the `role="table"` container, e.g. "Controls — Movement". */
  ariaLabel: string
  /** Sub-category-grouped, category-filtered rows in profile order — see `groupControlsRowEntries`. */
  groups: ControlsRowGroup[]
  /**
   * Renders one row's content. `index` is this row's position across the *whole* filtered row
   * list (not per-group) — D4's `ControlsRow` uses it to compute zebra parity explicitly, since
   * CSS `:nth-of-type` resets at every group divider (see `ControlsRow`'s doc comment). Defaults
   * to `renderPlaceholderRow` (name only) for a caller that has not wired D4 yet.
   */
  renderRow?: (entry: ControlsRowEntry, index: number) => ReactNode
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
}

/** Fallback row for a caller that has not wired D4's `ControlsRow` yet: the entry's name only, in
 * the Action column. Deliberately hook-free (no `useTranslation`) since it may run inside another
 * component's render — a catalogue row's name here is its raw command text, not its i18n label
 * (resolving that needs `t()`, which is the caller's job once it wires the real row). */
function renderPlaceholderRow(entry: ControlsRowEntry): ReactNode {
  const key = entry.kind === 'catalog' ? entry.row.catalogId : entry.action.id
  const name = entry.kind === 'catalog' ? (entry.row.commands[0] ?? entry.row.catalogId) : entry.action.name
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
}: ControlsGridProps) {
  const { t } = useTranslation()

  // Running index across the *whole* filtered row list, not per-group — see `ControlsRow`'s doc
  // comment for why zebra parity is computed here rather than left to CSS `:nth-of-type`.
  let rowIndex = 0
  // Story 053 D6: move up/down is disabled at the first/last *sub-category* group - the ungrouped
  // run (`subcategory: null`) is never itself a target, so it does not count. Counted up front
  // (not read off `categories.subcategories.length` directly) so this stays correct even for a
  // filtered view where a whole sub-category group can still be empty but always renders (D5).
  const subcategoryCount = groups.filter((group) => group.subcategory !== null).length
  let subcategoryOrdinal = -1

  return (
    // Review fix (finding 1): `.ctrl-foot` is a caption/summary area below the table, not part of
    // it - a `table`'s only valid children are rows (via `rowgroup`), so the footer now lives here,
    // outside the `role="table"` div's DOM boundary entirely, both still capped by this wrapper.
    <div className="ctrl-stage">
      <div role="table" aria-label={ariaLabel}>
        <div className="ctrl-colhead" role="row">
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
          if (subcategory) subcategoryOrdinal += 1
          const subcategoryIndex = subcategoryOrdinal
          return (
            <div key={subcategory?.id ?? `ungrouped-${groupIndex}`} role="rowgroup">
              {subcategory && (
                <div className="ctrl-group" role="row">
                  {/* Review fix (finding 1): an ARIA `row` may only contain `cell`/`columnheader`/
                      `rowheader` children - the divider's three spans used to be bare `row` children
                      (an invalid "row with no cells"). One `role="cell"` spanning the full row now
                      carries the eyebrow/rule/count as a single announcement.

                      Story 053 D5: the header is the sub-category's own `name` - the profile's data,
                      not an i18n key lookup (a sub-category is user-typed/user-authored structure,
                      same reasoning `categoryDisplayName` already applies to a renamed category). */}
                  <span className="ctrl-group-cell" role="cell">
                    <span className="ctrl-group-eyebrow">{subcategory.name}</span>
                    <span className="ctrl-group-rule" aria-hidden="true" />
                    <span className="ctrl-group-eyebrow">
                      {t('config.controls.grid.groupCount', { count: group.entries.length })}
                    </span>
                    {/* Story 053 D6: create/reorder lives one level up (the category's own toolbar,
                        `ControlsTab.tsx`) - only rename/move/delete are scoped to a single header. */}
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
              {group.entries.map((entry) => renderRow(entry, rowIndex++))}
            </div>
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
