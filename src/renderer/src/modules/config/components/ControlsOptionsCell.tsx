import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { TriangleAlert } from 'lucide-react'

/**
 * The Options column's content for a Controls grid row.
 *
 * Three mutually exclusive text states, most specific first: a conflict ("also: <owner>", danger
 * tone plus a glyph - never colour alone, like `BindSlot`'s conflict marker) beats the row's
 * modifier layer name, which beats the plain dash. `layer` is the already-resolved display name
 * (`lib/bind-slot-collision.ts`'s `layerNameForModifier`), so this component stays presentation-only.
 * `layer` is a single value because the caller already picked one (primary slot wins a tie).
 *
 * `extra` renders alongside the text, not instead of it - a drops row's ammo toggle and
 * team-message field sit next to whatever the text state is, since a drops row can be
 * modifier-bound or conflicting like any other row.
 */
export interface ControlsOptionsCellProps {
  /** Already-resolved layer name for a modifier-bound slot, or `undefined` for a row with no
   * modifier on either slot. */
  layer?: string
  /** The conflict result. `null`/`undefined` render as "no conflict". */
  conflict?: { owner: string } | null
  /** A drops row's ammo toggle + team-message field, or any other content a row wants next to the
   * Options text. */
  extra?: ReactNode
  /** already-translated reason the row's action cannot work on the assigned engine.
   * Takes the place of the plain dash (there is no room for both) - a conflict or layer still wins,
   * they carry more urgent information. */
  unavailableReason?: string
}

export function ControlsOptionsCell({
  layer,
  conflict,
  extra,
  unavailableReason,
}: ControlsOptionsCellProps) {
  const { t } = useTranslation()

  // the fixed Options column has no room to grow, so the conflict/layer
  // text needs `min-w-0 truncate` (mirrors `ControlsRow.tsx`'s Action-cell name/command spans)
  // plus a `title` carrying the untruncated value, rather than forcing the column wider.
  const text = conflict ? (
    (() => {
      const conflictText = t('config.controls.options.alsoUsedBy', { owner: conflict.owner })
      return (
        <span className="flex min-w-0 items-center gap-1 text-xs text-danger" title={conflictText}>
          <TriangleAlert className="size-3 shrink-0" aria-hidden="true" />
          <span className="min-w-0 truncate">{conflictText}</span>
        </span>
      )
    })()
  ) : layer ? (
    (() => {
      const layerText = t('config.controls.options.layer', { layer })
      return (
        <span className="min-w-0 truncate text-xs text-ink-muted" title={layerText}>
          {layerText}
        </span>
      )
    })()
  ) : unavailableReason ? (
    <span
      className="min-w-0 truncate text-xs text-warning"
      title={unavailableReason}
      data-testid="controls-unavailable-reason"
    >
      {unavailableReason}
    </span>
  ) : (
    <span className="text-xs text-ink-faint">{t('common.label.noValue')}</span>
  )

  return (
    <div className="flex w-full min-w-0 items-center justify-end gap-2">
      {text}
      {extra}
    </div>
  )
}
