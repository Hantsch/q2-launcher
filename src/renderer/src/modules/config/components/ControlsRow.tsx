import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { PencilLine, RotateCcw } from 'lucide-react'
import { BindPromptHostContext } from './BindSlot'

/**
 * One row of the Controls grid: the 40px `.ctrl-row` shell, zebra striping, hover highlight, the
 * name-plus-command label and the hover/focus-only reset button. It is unaware of
 * catalogue-vs-custom-action rows: that adapter logic lives in `ControlsTab.tsx`
 * (`lib/controls-row-entries.ts`), and slot content arrives as opaque `ReactNode`s.
 *
 * Zebra: `nth-of-type` would reset at every group divider and `rowgroup` wrapper, so `ControlsGrid`
 * computes `odd` across the whole filtered list (CSS: `.ctrl-row.is-odd`).
 *
 * `ControlsGrid` wraps this component's whole return value in one `role="rowgroup"` div
 * (`data-row-id={rowId}`), a direct child of the `role="table"` div: a sortable item needs one DOM
 * element with one ref per row, while this component renders a multi-element fragment (row, prompt
 * host, extra keys, message row). The sub-category divider is not wrapped; it is its own
 * `role="row"` child of the table. `.ctrl-row`'s grid template has a leading 28px grip column
 * (`.ctrl-grip`) filled by the `grip` prop, the width an `IconButton`-sized handle needs.
 *
 * `.ctrl-subrow-host` sits under the row; slots portal their blocked-capture Cancel/Replace prompt
 * into it through `BindPromptHostContext`, so the `BindSlot` whose capture was blocked still owns the
 * prompt and this component never holds capture state. The host is always rendered (a portal needs an
 * existing target) and collapses while empty (`.ctrl-subrow-host:empty`). It has no `role` and no
 * zebra class: it is one row's expansion, so it must not shift the parity `odd` encodes.
 */
export interface ControlsRowProps {
  /** The row's own name - an action's `name`, or a catalogue row's resolved i18n label. */
  name: string
  /** Mono secondary label next to `name`. */
  command?: string
  /** Accessible name for the reset button - names *this* row, not "Reset". */
  resetLabel: string
  /** Resets this row's binds (a catalogue row's key slots, or a plain action's `action.keys`). */
  onReset: () => void
  /** The Key column: `ControlsTab` wires the slot-0 `BindSlot` plus the fold chevron or add-key button. */
  keyCell: ReactNode
  /** Further keys, as full-width sub-row(s) below the prompt host; each sub-row stamps its own
   * `data-row-id` (this component stamps only the wrapper). Absent renders nothing. */
  extraKeyRows?: ReactNode
  /** Opaque Options-column content - `ControlsOptionsCell`, or a plain action row's icon buttons. */
  optionsCell: ReactNode
  /** Explicit zebra parity - see the doc comment above. */
  odd?: boolean
  /** Whether the row's action is in the profile's pending change set (`useProfileChanges()`), the
   * predicate `CvarRow`'s `edited` reads. The caller computes it; this only renders the marker. */
  edited?: boolean
  /** Optional full-width sub-row below the prompt host (a drops row's message row). */
  subRow?: ReactNode
  /** Registers the row's outer element for the cross-tab deep link to scroll/focus (like `AliasRow`). */
  rowRef?: (el: HTMLDivElement | null) => void
  /** Stable identity, stamped as `data-row-id` on every element of the row - one unit per row to drag. */
  rowId: string
  /** The drag grip, rendered into the leading `.ctrl-grip` cell (built by `ControlsGrid`, which owns
   * the sortable item). Absent: the cell stays empty and the column does not reflow. */
  grip?: ReactNode
  /** The row's action cannot work on the assigned engine(s): marks the row `aria-disabled` and
   * disables its reset button; the visible reason arrives through `optionsCell`, the caller
   * disables the slots. */
  unavailable?: boolean
}

export function ControlsRow({
  name,
  command,
  resetLabel,
  onReset,
  keyCell,
  extraKeyRows,
  optionsCell,
  odd,
  edited,
  subRow,
  rowRef,
  rowId,
  grip,
  unavailable,
}: ControlsRowProps) {
  const { t } = useTranslation()
  // A callback ref in state, not a `useRef`: the slots need to re-render once the host element
  // exists, and only a state update does that.
  const [promptHost, setPromptHost] = useState<HTMLDivElement | null>(null)

  const rowClassName = ['ctrl-row', odd && 'is-odd', edited && 'is-edited']
    .filter((part): part is string => Boolean(part))
    .join(' ')

  return (
    <BindPromptHostContext.Provider value={promptHost}>
      <div
        className={rowClassName}
        role="row"
        ref={rowRef}
        data-row-id={rowId}
        aria-disabled={unavailable || undefined}
        // not part of the Tab order - only ever focused programmatically by the
        // deep-link effect in `ControlsTab.tsx`, which still gets the app-wide `:focus-visible`
        // amber ring for free (`styles/index.css`).
        tabIndex={-1}
      >
        {/* Grip cell: `grip` is built by `ControlsGrid`, where the sortable item lives. Rendered
            even without a grip so the column never reflows. */}
        <span className="ctrl-grip" role="cell">
          {grip}
        </span>
        <span className="ctrl-label flex min-w-0 items-center gap-1.5" role="cell">
          <span className="min-w-0 truncate">{name}</span>
          {command && <span className="ctrl-label-cmd truncate">{command}</span>}
          {edited && (
            // the left border alone is colour-only, so an edited row also
            // carries a shape-based glyph with its own translated `aria-label` - mirrors
            // `CvarRow.tsx`'s identical treatment.
            <span
              role="img"
              aria-label={t('common.label.unsavedChange')}
              title={t('common.label.unsavedChange')}
              className="ctrl-unsaved-glyph"
            >
              <PencilLine aria-hidden className="size-3" />
            </span>
          )}
        </span>
        <span role="cell">
          <button
            type="button"
            className="ctrl-reset"
            aria-label={resetLabel}
            onClick={onReset}
            disabled={unavailable}
          >
            <RotateCcw className="size-3.5" />
          </button>
        </span>
        <span className="ctrl-keycell" role="cell">
          {keyCell}
        </span>
        <span className="ctrl-opts" role="cell">
          {optionsCell}
        </span>
      </div>

      {/* `role="row"` outer div around the portal target (`ctrl-subrow-host`, collapsed by `:empty`):
          a bare, role-less div would be invalid table content. */}
      <div className="ctrl-subrow-host-row" role="row" data-row-id={rowId}>
        <div className="ctrl-subrow-host" role="cell" ref={setPromptHost} />
      </div>

      {/* Order: main row -> prompt host -> extra keys -> message row, so a blocked-capture banner
          stays directly under the main row. */}
      {extraKeyRows && (
        <div className="ctrl-keysub-container" data-row-id={rowId}>
          {extraKeyRows}
        </div>
      )}

      {/* No always-present wrapper (unlike the prompt host, which needs a permanent portal target).
          Placed after the prompt host so a collision prompt stays glued to its row. No zebra class:
          this is an expansion of one row, not a row in the `odd` parity. */}
      {subRow && (
        <div className="ctrl-msgrow-row" role="row" data-row-id={rowId}>
          <div className="ctrl-msgrow" role="cell">
            {subRow}
          </div>
        </div>
      )}
    </BindPromptHostContext.Provider>
  )
}
