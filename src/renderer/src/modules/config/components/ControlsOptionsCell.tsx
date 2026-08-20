import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { TriangleAlert } from 'lucide-react'

/**
 * Story 020 D6: the Options column's content for a Controls grid row, replacing the ad-hoc
 * `<span>—</span>` / ammo-checkbox-plus-message-input blocks `ControlsTab.tsx`'s
 * `renderCatalogOptionsCell` used to build inline.
 *
 * Three mutually exclusive text states, most specific first: a conflict (AC 8, "also: <owner>",
 * danger tone plus a glyph - same accessibility rule `BindSlot`'s conflict marker follows, never
 * colour alone) beats naming the row's modifier layer, which beats the plain dash - a
 * conflicting, modifier-bound row is still, first and foremost, a conflict. `layer` is the
 * already-resolved display name (real `AltLayer` name or the generic fallback -
 * `lib/bind-slot-collision.ts`'s `layerNameForModifier`), so this component stays presentation
 * -only and does not need `draft.layers` itself.
 *
 * A row can carry a modifier on either slot, on both, or on neither - `layer` is a single value
 * because the caller already picked one (the prototype's common case is one modifier per row;
 * see the caller for the "prefer primary" tie-break when both slots happen to carry one).
 *
 * `conflict` stays `undefined`/`null` everywhere `ControlsTab.tsx` calls this today: D7's real
 * conflict scan (`lib/bind-conflicts.ts`) lands after this deliverable, so the shape is ready but
 * nothing computes it yet - the same "no consumer yet" approach D5 used for `BindSlot`'s
 * `isConflicted`.
 *
 * `extra` renders alongside the text, not instead of it - a drops row's ammo toggle and
 * team-message field (moved here from `renderCatalogOptionsCell`, decision: "drops rows keep
 * their ammo toggle inline in Options") sits next to whatever the text state is, since a drops
 * row can be modifier-bound or conflicting exactly like any other row.
 */
export interface ControlsOptionsCellProps {
  /** Already-resolved layer name for a modifier-bound slot, or `undefined` for a row with no
   * modifier on either slot. */
  layer?: string
  /** D7's future conflict result. `null`/`undefined` render as "no conflict". */
  conflict?: { owner: string } | null
  /** A drops row's ammo toggle + team-message field, or any other content a row wants next to the
   * Options text. */
  extra?: ReactNode
}

export function ControlsOptionsCell({ layer, conflict, extra }: ControlsOptionsCellProps) {
  const { t } = useTranslation()

  // Review fix (finding 2): the 150px Options column has no room to grow, so the conflict/layer
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
  ) : (
    <span className="text-xs text-ink-faint">{t('config.controls.options.none')}</span>
  )

  return (
    <div className="flex w-full min-w-0 items-center justify-end gap-2">
      {text}
      {extra}
    </div>
  )
}
