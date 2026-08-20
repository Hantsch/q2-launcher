import { useState, type ReactNode } from 'react'
import { RotateCcw } from 'lucide-react'
import { BindPromptHostContext } from './BindSlot'

/**
 * One row of the Controls grid (story 020 D4): the 40px `.ctrl-row` shell, zebra striping, hover
 * highlight, the name-plus-command label and the hover/focus-only reset button. Deliberately not
 * aware of catalogue-vs-custom-action rows - that adapter logic lives in `ControlsTab.tsx`
 * (`lib/controls-row-entries.ts`) and in whichever slot content the caller passes in. D5 rewrote
 * `BindSlot`'s surface (the "always-visible filled cell"); D6 gives `optionsCell` its real
 * content (`components/ControlsOptionsCell.tsx`: modifier layer name, "also: <owner>" conflict,
 * or the plain dash, plus a drops row's ammo/message controls) - this component still only takes
 * it as opaque `ReactNode`, so nothing here changed to support that.
 *
 * Zebra striping: `controls-grid.css`'s `.ctrl-row:nth-of-type(odd)` (D2/D3) resets its count at
 * every catalogue group divider, because each `ControlsGrid` group renders into its own
 * `role="rowgroup"` div and the divider itself is a `.ctrl-group` sibling `div` ahead of the first
 * row - `nth-of-type` counts by tag, not by class, so the running parity is not the same thing as
 * "every other row in the whole list". Rather than restructure the grouped DOM to keep one
 * flat run of `.ctrl-row` siblings (`role="rowgroup"` is worth keeping for the AT tree), `odd` is
 * computed by `ControlsGrid` across the *whole* filtered row list and passed in explicitly; the
 * CSS rule is `.ctrl-row.is-odd` instead of an `:nth-of-type` selector.
 *
 * Story 020 D5: a row is two sibling elements, not one - `.ctrl-row` plus the
 * `.ctrl-subrow-host` under it, which is where a slot's blocked-capture Cancel/Replace prompt
 * renders (story 020 decision: full-width sub-row, not inside a 190px column). The host is
 * published to the row's slots through `BindPromptHostContext` and the slots portal into it, so
 * the prompt is still owned and rendered by the `BindSlot` whose capture was blocked - this
 * component never holds capture state. The host is always rendered (a portal needs a target that
 * already exists) and collapses to nothing while empty (`.ctrl-subrow-host:empty`). It carries no
 * `role`, and deliberately does not get `.ctrl-row`'s zebra class: it is one row's expansion, not
 * a row of its own, so it must not shift the striping parity `odd` encodes.
 */
export interface ControlsRowProps {
  /** The row's own name - an action's `name`, or a catalogue row's resolved i18n label. */
  name: string
  /** Rendered as a mono secondary label next to `name` (AC 5). Absent for a row with no fixed
   * command text (there is none today, but the prop stays optional rather than assuming). */
  command?: string
  /** Accessible name for the reset button - names *this* row, not "Reset". */
  resetLabel: string
  /** Resets this row's binds - a catalogue row's key slots (+ its own ammo/message, caller's
   * call), or a plain action's key/secondaryKey/keyModifier/secondaryKeyModifier. */
  onReset: () => void
  /** Opaque slot content - `ControlsTab` wires the existing `BindSlot` into these today; D5
   * rewrites what fills them without this component changing. */
  primarySlot: ReactNode
  secondarySlot: ReactNode
  /** Opaque Options-column content - `ControlsOptionsCell` for a catalogue row (D6), or the
   * move/edit/rename/remove icon buttons for a plain action row. */
  optionsCell: ReactNode
  /** Explicit zebra parity - see the module doc comment for why this is not CSS-only. */
  odd?: boolean
}

export function ControlsRow({
  name,
  command,
  resetLabel,
  onReset,
  primarySlot,
  secondarySlot,
  optionsCell,
  odd,
}: ControlsRowProps) {
  // A callback ref in state, not a `useRef`: the slots need to re-render once the host element
  // exists, and only a state update does that.
  const [promptHost, setPromptHost] = useState<HTMLDivElement | null>(null)

  return (
    <BindPromptHostContext.Provider value={promptHost}>
      <div className={odd ? 'ctrl-row is-odd' : 'ctrl-row'} role="row">
        <span className="ctrl-label flex min-w-0 items-center" role="cell">
          <span className="min-w-0 truncate">{name}</span>
          {command && <span className="ctrl-label-cmd truncate">{command}</span>}
        </span>
        <span role="cell">
          <button type="button" className="ctrl-reset" aria-label={resetLabel} onClick={onReset}>
            <RotateCcw className="size-3.5" />
          </button>
        </span>
        <span role="cell">{primarySlot}</span>
        <span role="cell">{secondarySlot}</span>
        <span className="ctrl-opts" role="cell">
          {optionsCell}
        </span>
      </div>

      {/* Review fix (finding 1): this host is a `role="rowgroup"` child sibling of `.ctrl-row`, so
          it needs the same row/cell treatment the group divider got - a bare, role-less div here
          would be invalid table content. The outer div carries `role="row"`; the actual portal
          target (`ctrl-subrow-host`, still keyed off `:empty` for the collapse-to-nothing CSS) is
          the row's one `role="cell"` child, so an expanded collision banner reads as a legitimate
          row instead of stray content inside a table. */}
      <div className="ctrl-subrow-host-row" role="row">
        <div className="ctrl-subrow-host" role="cell" ref={setPromptHost} />
      </div>
    </BindPromptHostContext.Provider>
  )
}
