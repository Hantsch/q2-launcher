import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, CircleX, TriangleAlert } from 'lucide-react'
import { bindValueFor } from '@shared/config/action-mirror'
import type { TidyUpBindClaim, TidyUpOp } from '@shared/config/tidy-up'
import type { ConfigProfile } from '@shared/modules/config'
import { Button, type ButtonProps } from '../../components/ui/Button'
import { Badge, EmptyState, SectionLabel, type BadgeTone } from '../../components/ui/primitives'
import { cn } from '../../lib/cn'
import { useLauncher } from '../../store/useLauncher'
import { CareBatchFixDialog } from './CareBatchFixDialog'
import { applyTidyUp } from './client'
import {
  analyzeTidyUp,
  type TidyUpFinding,
  type TidyUpFindingKind,
  type TidyUpFindingMode,
} from './lib/tidy-up-findings'

/**
 * Care tab, Tidy-up section (story 025 D5): `analyzeTidyUp`'s flat maintenance
 * list (D4), grouped by `TidyUpFindingKind` with a count per group. Same idiom
 * as every other Care section (`CareSyncSection`) - owns its own derived state
 * entirely, `onProfileUpdated` is the only way it ever reaches back out.
 *
 * Unlike `CareSyncSection`, there is no IPC read here: `analyzeTidyUp` is pure
 * and runs directly on the `profile` prop on every render (memoized on
 * `profile` identity), so a successful apply's `onProfileUpdated` call feeds a
 * new `profile` straight back in and the list re-derives itself - "re-runs the
 * analyzer on the response" from the deliverable's spec happens for free,
 * rather than as a second explicit step.
 *
 * A row with no fix at all (`mode: 'report'`, or a `'review'` row whose own
 * ambiguity left it with zero ops - see `tidy-up-findings.ts`'s
 * `aliasUnreferenced` handling) renders flat, with no toggle and no Apply: its
 * message text is the whole explanation ("says why"). A row with at least one
 * op is a disclosure: collapsed it shows only its badges and message, and only
 * expanding it reveals the before/after preview - Apply never appears without
 * the preview above it (AC 6).
 *
 * A `preservedLine` finding's `ops` array is `[dropPreservedLine]` or
 * `[dropPreservedLine, reclassifyPreservedLine]` (D4's own invariant): this is
 * the one kind that renders *two* independent actions, "Drop" and
 * "Re-classify", each with its own preview and its own Apply click - never a
 * single button that sends both. Every other fixable kind sends its whole
 * `ops` array as one batch on one "Apply" click (a `shadowedBind` finding can
 * carry more than one losing claim when a key is claimed three times or more;
 * they are all losers of the *same* decision, so one click resolves all of
 * them).
 */
export function CareTidyUpSection({
  profile,
  onProfileUpdated,
}: {
  profile: ConfigProfile
  onProfileUpdated: (profile: ConfigProfile) => void
}) {
  const { t } = useTranslation()
  const pushToast = useLauncher((state) => state.pushToast)

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [pendingKeys, setPendingKeys] = useState<Set<string>>(new Set())
  const [rejectedKeys, setRejectedKeys] = useState<Set<string>>(new Set())
  const [batchDialogOpen, setBatchDialogOpen] = useState(false)

  const findings = useMemo(() => analyzeTidyUp(profile), [profile])
  const autoFindings = useMemo(() => findings.filter((finding) => finding.mode === 'auto'), [findings])

  const groups = useMemo(
    () =>
      KIND_ORDER.map((kind) => ({
        kind,
        items: findings.filter((finding) => finding.kind === kind),
      })).filter((group) => group.items.length > 0),
    [findings],
  )

  const toggle = (id: string): void => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleApply = async (action: TidyUpAction): Promise<void> => {
    setPendingKeys((prev) => new Set(prev).add(action.key))
    setRejectedKeys((prev) => {
      if (!prev.has(action.key)) return prev
      const next = new Set(prev)
      next.delete(action.key)
      return next
    })

    const outcome = await applyTidyUp({ profileId: profile.id, ops: action.ops })

    setPendingKeys((prev) => {
      const next = new Set(prev)
      next.delete(action.key)
      return next
    })

    if (!outcome.ok) {
      pushToast({
        level: 'error',
        messageKey: outcome.error.key,
        timeoutMs: 0,
        ...(outcome.error.params ? { params: outcome.error.params } : {}),
      })
      return
    }

    if (outcome.value.rejected.length > 0) {
      setRejectedKeys((prev) => new Set(prev).add(action.key))
    }
    onProfileUpdated(outcome.value.profile)
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <SectionLabel>{t('config.care.tidyUp.label')}</SectionLabel>
        <div className="flex flex-col items-end gap-0.5">
          <Button
            variant="danger"
            size="sm"
            disabled={autoFindings.length === 0}
            title={
              autoFindings.length === 0 ? t('config.care.tidyUp.batch.nothingSafe') : undefined
            }
            onClick={() => setBatchDialogOpen(true)}
          >
            {t('config.care.tidyUp.batch.button', { count: autoFindings.length })}
          </Button>
          {autoFindings.length === 0 && (
            <span className="text-xs text-ink-muted">
              {t('config.care.tidyUp.batch.nothingSafe')}
            </span>
          )}
        </div>
      </div>

      {findings.length === 0 ? (
        <EmptyState
          title={t('config.care.tidyUp.empty.title')}
          body={t('config.care.tidyUp.empty.body')}
        />
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <div key={group.kind} className="space-y-2">
              <div className="flex items-center gap-2">
                <SectionLabel>{t(`config.care.tidyUp.kindLabel.${group.kind}`)}</SectionLabel>
                <Badge tone="neutral">{group.items.length}</Badge>
              </div>
              <ul className="space-y-1.5">
                {group.items.map((finding) => (
                  <FindingRow
                    key={finding.id}
                    finding={finding}
                    profile={profile}
                    expanded={expandedIds.has(finding.id)}
                    onToggle={toggle}
                    pendingKeys={pendingKeys}
                    rejectedKeys={rejectedKeys}
                    onApply={(action) => void handleApply(action)}
                  />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {batchDialogOpen && (
        <CareBatchFixDialog
          profile={profile}
          findings={autoFindings}
          onClose={() => setBatchDialogOpen(false)}
          onProfileUpdated={onProfileUpdated}
        />
      )}
    </div>
  )
}

export const KIND_ORDER: TidyUpFindingKind[] = [
  'shadowedBind',
  'emptyLayer',
  'unreferencedAlias',
  'undefinedAlias',
  'duplicateAlias',
  'preservedLine',
]

const LEVEL_TONE: Record<'error' | 'warning', BadgeTone> = { error: 'danger', warning: 'warning' }
const LEVEL_ICON = { error: CircleX, warning: TriangleAlert } as const
const MODE_TONE: Record<TidyUpFindingMode, BadgeTone> = {
  auto: 'success',
  review: 'flame',
  report: 'neutral',
}

/** One clickable fix offered on a row: a subset of the finding's own `ops`
 * (all of them, for every kind but `preservedLine`; exactly one, for
 * `preservedLine`'s "Drop" and "Re-classify"), plus a stable key this
 * component tracks pending/rejected state by. */
interface TidyUpAction {
  key: string
  labelKey: string
  variant: ButtonProps['variant']
  ops: TidyUpOp[]
}

function actionsFor(finding: TidyUpFinding): TidyUpAction[] {
  if (finding.kind === 'preservedLine') {
    const actions: TidyUpAction[] = []
    const drop = finding.ops[0]
    if (drop) {
      actions.push({
        key: `${finding.id}:drop`,
        labelKey: 'config.care.tidyUp.action.drop',
        variant: 'danger',
        ops: [drop],
      })
    }
    const reclassify = finding.ops[1]
    if (reclassify) {
      actions.push({
        key: `${finding.id}:reclassify`,
        labelKey: 'config.care.tidyUp.action.reclassify',
        variant: 'primary',
        ops: [reclassify],
      })
    }
    return actions
  }

  if (finding.ops.length === 0) return []
  return [
    {
      key: `${finding.id}:apply`,
      labelKey: 'config.care.tidyUp.action.apply',
      variant: 'danger',
      ops: finding.ops,
    },
  ]
}

/** A short label for the thing a row is about, next to its level badge - the
 * key/name/file:line the message already names in prose, pulled back out as
 * its own badge so a group's rows can be scanned without reading every
 * sentence. */
function findingSubject(finding: TidyUpFinding): string {
  const params = finding.params
  switch (finding.kind) {
    case 'shadowedBind':
      return String(params['key'] ?? '')
    case 'emptyLayer':
      return String(params['name'] ?? '')
    case 'unreferencedAlias':
    case 'duplicateAlias':
      return String(params['name'] ?? '')
    case 'undefinedAlias':
      return String(params['alias'] ?? '')
    case 'preservedLine':
      return `${params['file'] ?? ''}:${params['line'] ?? ''}`
    default:
      return ''
  }
}

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

/** Before/after text for one op, built purely from the op's own fields (plus a
 * lookup on `profile` for the human-readable name a claim/layer/alias id
 * points at) - never a byte diff, this is a presentational rendering of data
 * the op and finding already carry. */
export function opPreview(
  profile: ConfigProfile,
  op: TidyUpOp,
  t: (key: string, options?: Record<string, unknown>) => string,
): { before: string; after: string } {
  const removed = t('config.care.tidyUp.preview.removed')

  switch (op.kind) {
    case 'removeShadowedBind':
      return {
        before: `bind ${op.key} "${shadowedClaimCommand(profile, op.claim)}"`,
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
      const key = target.action.key ?? target.action.secondaryKey ?? '?'
      return { before: op.text, after: `bind ${key} "${target.action.name}"` }
    }
  }
}

function FindingRow({
  finding,
  profile,
  expanded,
  onToggle,
  pendingKeys,
  rejectedKeys,
  onApply,
}: {
  finding: TidyUpFinding
  profile: ConfigProfile
  expanded: boolean
  onToggle: (id: string) => void
  pendingKeys: Set<string>
  rejectedKeys: Set<string>
  onApply: (action: TidyUpAction) => void
}) {
  const { t } = useTranslation()
  const actions = actionsFor(finding)
  const Icon = LEVEL_ICON[finding.level]
  const message = t(finding.messageKey, finding.params)

  const header = (
    <div className="flex items-start gap-2.5">
      {actions.length > 0 ? (
        expanded ? (
          <ChevronDown className="mt-0.5 size-3.5 shrink-0 text-ink-muted" />
        ) : (
          <ChevronRight className="mt-0.5 size-3.5 shrink-0 text-ink-muted" />
        )
      ) : (
        <Icon
          className={cn(
            'mt-0.5 size-3.5 shrink-0',
            finding.level === 'error' ? 'text-danger' : 'text-warning',
          )}
        />
      )}
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={LEVEL_TONE[finding.level]}>{findingSubject(finding)}</Badge>
          <Badge tone={MODE_TONE[finding.mode]}>{t(`config.care.tidyUp.mode.${finding.mode}`)}</Badge>
        </div>
        <p className="text-xs leading-relaxed text-ink-dim" data-selectable>
          {message}
        </p>
      </div>
    </div>
  )

  return (
    <li className="space-y-1.5 rounded-sm border border-line px-2.5 py-2">
      {actions.length > 0 ? (
        <button type="button" className="w-full text-left" onClick={() => onToggle(finding.id)}>
          {header}
        </button>
      ) : (
        header
      )}

      {expanded && actions.length > 0 && (
        <div className="ml-6 space-y-2.5 border-l border-line pl-3">
          {actions.map((action) => (
            <div key={action.key} className="space-y-1.5">
              {action.ops.map((op, index) => {
                const preview = opPreview(profile, op, t)
                return (
                  <div
                    key={index}
                    className="space-y-1 rounded-sm border border-line bg-panel px-2.5 py-1.5 text-xs"
                  >
                    <p className="flex gap-1.5">
                      <span className="shrink-0 text-ink-muted">
                        {t('config.care.tidyUp.preview.before')}
                      </span>
                      <code className="numeric min-w-0 break-all text-ink-dim" data-selectable>
                        {preview.before}
                      </code>
                    </p>
                    <p className="flex gap-1.5">
                      <span className="shrink-0 text-ink-muted">
                        {t('config.care.tidyUp.preview.after')}
                      </span>
                      <code className="numeric min-w-0 break-all text-ink-dim" data-selectable>
                        {preview.after}
                      </code>
                    </p>
                  </div>
                )
              })}
              {rejectedKeys.has(action.key) && (
                <p className="text-xs text-warning">{t('config.care.tidyUp.result.rejected')}</p>
              )}
              <Button
                variant={action.variant}
                size="sm"
                disabled={pendingKeys.has(action.key)}
                onClick={() => onApply(action)}
              >
                {pendingKeys.has(action.key)
                  ? t('config.care.tidyUp.applying')
                  : t(action.labelKey)}
              </Button>
            </div>
          ))}
        </div>
      )}
    </li>
  )
}
