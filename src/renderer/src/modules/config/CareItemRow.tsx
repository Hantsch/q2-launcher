import { useTranslation } from 'react-i18next'
import { CircleX, TriangleAlert } from 'lucide-react'
import { keySlotAt } from '@shared/config/action-slots'
import { bindValueFor } from '@shared/config/action-mirror'
import type { TidyUpBindClaim, TidyUpOp } from '@shared/config/tidy-up'
import type { ConfigProfile } from '@shared/modules/config'
import { cn } from '../../lib/cn'
import { Badge, type BadgeTone } from '../../components/ui/primitives'
import { Button, type ButtonProps } from '../../components/ui/Button'
import type { CareItem, CareItemAction } from './lib/care-items'
import type { TidyUpFindingKind } from './lib/tidy-up-findings'

/**
 * Story 058 D2: the one row shape every Care group renders through — title,
 * one-sentence consequence, level badge (icon + text, never colour alone) and
 * an action cluster built straight from `item.actions`. Config health never
 * hands it an item with actions (nothing a list can fix, `lib/care-items.ts`'s
 * own doc comment); Files (D3) and Tidy-up (D4) both do, and D5's "Show in
 * Controls" reuses the same cluster — one shared row rather than a second one
 * per group.
 *
 * `KIND_ORDER` and `opPreview` below also moved here from the now-deleted
 * `CareTidyUpSection.tsx` (D4) — they are presentational helpers `CareBatchFixDialog` still needs
 * for its own preview list, not part of the row itself.
 *
 * Mirrors `CareTidyUpSection`'s (pre-058) `FindingRow` for the row markup and
 * the level badge/icon pairing, and `ValidationPanel`'s `FindingRow` for the
 * finding-to-text mapping, both before their files were deleted in this
 * deliverable.
 */
export function CareItemRow({
  item,
  onAction,
  pendingKeys,
}: {
  item: CareItem
  /** Called with the clicked action. Omitted for callers that never pass an item with actions
   * (Config health, this deliverable) rather than forcing every caller to supply a no-op. */
  onAction?: (action: CareItemAction) => void
  /** Action keys currently in flight — disables that action's button and swaps its label. */
  pendingKeys?: ReadonlySet<string>
}) {
  const { t } = useTranslation()
  const Icon = item.level === 'error' ? CircleX : TriangleAlert
  const tone: BadgeTone = item.level === 'error' ? 'danger' : 'warning'

  return (
    <li className="flex flex-wrap items-start justify-between gap-2 rounded-sm border border-line px-2.5 py-2">
      <div className="flex min-w-0 flex-1 items-start gap-2.5">
        <Icon
          className={cn('mt-0.5 size-3.5 shrink-0', item.level === 'error' ? 'text-danger' : 'text-warning')}
        />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={tone}>{t(`config.care.level.${item.level}`)}</Badge>
            <p className="text-sm font-medium text-ink">{t(item.titleKey, item.params)}</p>
          </div>
          <p className="text-xs leading-relaxed text-ink-dim" data-selectable>
            {t(item.consequenceKey, item.params)}
          </p>
          {typeof item.params['path'] === 'string' && (
            <p
              className="numeric truncate text-xs text-ink-muted"
              title={item.params['path']}
              data-selectable
            >
              {item.params['path']}
            </p>
          )}
          {typeof item.params['messageKey'] === 'string' && (
            <p className="text-xs text-ink-muted">{t(item.params['messageKey'])}</p>
          )}
          {item.fixKey && (
            <p className="text-xs text-ink-muted">{t(item.fixKey, item.params)}</p>
          )}
          {item.source && <p className="text-[10px] text-ink-faint">{item.source}</p>}
        </div>
      </div>

      {item.actions.length > 0 && (
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {item.actions.map((action) => (
            <Button
              key={action.key}
              variant={actionVariant(action.kind)}
              size="sm"
              disabled={pendingKeys?.has(action.key)}
              onClick={() => onAction?.(action)}
            >
              {pendingKeys?.has(action.key) ? t('config.care.action.pending') : t(action.labelKey)}
            </Button>
          ))}
        </div>
      )}
    </li>
  )
}

/** `drop` and `apply` change or remove something on disk/in the profile, same weight the old
 * per-section rows gave them (`danger`); everything else is a lookup, a navigation or a
 * non-destructive re-check. */
function actionVariant(kind: CareItemAction['kind']): ButtonProps['variant'] {
  return kind === 'apply' || kind === 'drop' ? 'danger' : 'neutral'
}

/** Story 025's fixed tidy-up finding order, kept here (moved from the now-deleted
 * `CareTidyUpSection.tsx` in story 058 D4) purely as `CareBatchFixDialog`'s own grouping order for
 * its preview list — the Tidy-up group itself no longer sub-groups by kind (one flat list under one
 * heading, same as Config health and Files). */
export const KIND_ORDER: TidyUpFindingKind[] = [
  'shadowedBind',
  'emptyLayer',
  'unreferencedAlias',
  'undefinedAlias',
  'duplicateAlias',
  'preservedLine',
]

/** The command a shadowed-bind claim would render as, for the preview - same
 * attribution `tidy-up-findings.ts`'s `claimRenderedValue` uses (an action
 * claim renders as its mirror value, a hand-made entry as its own command).
 * Duplicated rather than imported because that function is not exported; safe
 * to duplicate here since this is display-only and never re-decides which
 * claim is removed. */
function shadowedClaimCommand(profile: ConfigProfile, claim: TidyUpBindClaim): string {
  if (claim.source !== 'action') return claim.command
  const action = (profile.actions ?? []).find((candidate) => candidate.id === claim.actionId)
  return action ? bindValueFor(action) : ''
}

/**
 * Story 050: a parenthetical slot label appended to an `action`-sourced claim's preview line, but
 * only for a slot index of 2 and up - slot 0/1 are the Controls tab's own "primary"/"secondary"
 * columns and need no extra label here (this preview never named them before this story either);
 * a slot beyond that can only exist from a hand-edited `.cfg`, so it is called out explicitly, one
 * generic `config.care.tidyUp.slotLabel` string for every such index rather than a dedicated
 * string per index.
 */
function shadowedClaimSlotLabel(
  claim: TidyUpBindClaim,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (claim.source !== 'action' || claim.slot < 2) return ''
  return ` (${t('config.care.tidyUp.slotLabel', { index: claim.slot + 1 })})`
}

/** Before/after text for one op, built purely from the op's own fields (plus a
 * lookup on `profile` for the human-readable name a claim/layer/alias id
 * points at) - never a byte diff, this is a presentational rendering of data
 * the op and finding already carry. Moved here from `CareTidyUpSection.tsx` (story 058 D4) - still
 * used only by `CareBatchFixDialog`, which shows a per-op preview before applying a batch. */
export function opPreview(
  profile: ConfigProfile,
  op: TidyUpOp,
  t: (key: string, options?: Record<string, unknown>) => string,
): { before: string; after: string } {
  const removed = t('config.care.tidyUp.preview.removed')

  switch (op.kind) {
    case 'removeShadowedBind':
      return {
        before: `bind ${op.key} "${shadowedClaimCommand(profile, op.claim)}"${shadowedClaimSlotLabel(op.claim, t)}`,
        after: removed,
      }
    case 'removeEmptyLayer': {
      const layer = (profile.layers ?? []).find((candidate) => candidate.id === op.layerId)
      return { before: layer?.name ?? op.layerId, after: removed }
    }
    case 'removeUnreferencedAlias': {
      const action = (profile.actions ?? []).find((candidate) => candidate.id === op.actionId)
      return { before: `alias ${action?.name ?? op.actionId}`, after: removed }
    }
    case 'dropPreservedLine':
      return { before: op.text, after: removed }
    case 'reclassifyPreservedLine': {
      const target = op.target
      if (target.field === 'cvars') {
        return { before: op.text, after: `set ${target.name} "${target.value}"` }
      }
      if (target.field === 'binds') {
        return { before: op.text, after: `bind ${target.key} "${target.command}"` }
      }
      const key = keySlotAt(target.action, 0)?.key || keySlotAt(target.action, 1)?.key || '?'
      return { before: op.text, after: `bind ${key} "${target.action.name}"` }
    }
  }
}
