import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TidyUpOp } from '@shared/config/tidy-up'
import type { ConfigProfile, TidyUpApplyResult } from '@shared/modules/config'
import type { Outcome } from '@shared/types'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { Badge, SectionLabel } from '../../components/ui/primitives'
import { KIND_ORDER, opPreview } from './CareItemRow'
import { applyTidyUp } from './client'
import type { TidyUpFinding } from './lib/tidy-up-findings'

/**
 * D6's "fix all safe findings" batch dialog: the one preview a per-row Apply
 * cannot serve, because the whole point of the batch button is sending every
 * `auto` finding's ops in a single `tidyUp.apply` call (decision 13) rather
 * than one call per finding.
 *
 * `findings` is always the caller's `auto`-mode list (never `review`/
 * `report` - those have no business here, since "safe" *is* `mode ===
 * 'auto'`). Grouped by `TidyUpFindingKind` the same way the section body
 * groups its rows, and each op gets the same before/after preview
 * (`opPreview`, exported from `CareItemRow` rather than duplicated) so
 * this dialog never shows a coarser preview than the individual rows already
 * do - AC 6 requires nothing be applied without a preview, and "N operations"
 * would not be one.
 *
 * Owns the IPC call itself (mirrors `DeleteProfileDialog`, not
 * `CleanupPanel`'s inline confirm state, since this is a standalone file):
 * Cancel/backdrop/Escape never call `applyTidyUp` at all, so nothing changes
 * on disk or in state unless Apply is clicked. On success it reports the new
 * profile back via `onProfileUpdated` immediately (so the section behind the
 * dialog re-derives its findings right away) but keeps itself open, showing
 * the applied/rejected counts until the user closes it - that summary is the
 * whole reason `outcome` stays local state instead of closing on success like
 * `CleanupPanel`'s confirm dialog does.
 */
export function CareBatchFixDialog({
  profile,
  findings,
  onClose,
  onProfileUpdated,
}: {
  profile: ConfigProfile
  findings: TidyUpFinding[]
  onClose: () => void
  onProfileUpdated: (profile: ConfigProfile) => void
}) {
  const { t } = useTranslation()
  const [submitting, setSubmitting] = useState(false)
  const [outcome, setOutcome] = useState<Outcome<TidyUpApplyResult> | null>(null)

  const ops: TidyUpOp[] = useMemo(() => findings.flatMap((finding) => finding.ops), [findings])

  const groups = useMemo(
    () =>
      KIND_ORDER.map((kind) => ({
        kind,
        items: findings.filter((finding) => finding.kind === kind),
      })).filter((group) => group.items.length > 0),
    [findings],
  )

  const handleApply = async (): Promise<void> => {
    setSubmitting(true)
    const result = await applyTidyUp({ profileId: profile.id, ops })
    setSubmitting(false)
    setOutcome(result)
    if (result.ok) onProfileUpdated(result.value.profile)
  }

  const applied = outcome?.ok ? outcome.value : null

  return (
    <Modal
      open
      size="md"
      title={t('config.care.tidyUp.batch.title')}
      onClose={onClose}
      closeLabel={t('common.close')}
      footer={
        applied ? (
          <Button variant="neutral" onClick={onClose}>
            {t('common.close')}
          </Button>
        ) : (
          <>
            <Button variant="ghost" disabled={submitting} onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" disabled={submitting} onClick={() => void handleApply()}>
              {submitting ? t('config.care.tidyUp.applying') : t('config.care.tidyUp.batch.confirm')}
            </Button>
          </>
        )
      }
    >
      <div className="space-y-3">
        {!applied && (
          <p className="text-xs leading-relaxed text-warning" data-selectable>
            {t('config.care.tidyUp.batch.warning', { count: ops.length })}
          </p>
        )}

        {!applied && (
          <div className="space-y-3">
            <p className="text-xs font-medium text-ink-dim">
              {t('config.care.tidyUp.batch.operationsLabel')}
            </p>
            {groups.map((group) => (
              <div key={group.kind} className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <SectionLabel>{t(`config.care.tidyUp.kindLabel.${group.kind}`)}</SectionLabel>
                  <Badge tone="neutral">{group.items.length}</Badge>
                </div>
                <ul className="space-y-1.5">
                  {group.items.map((finding) => (
                    <li
                      key={finding.id}
                      className="space-y-1 rounded-sm border border-line px-2.5 py-1.5 text-xs"
                    >
                      <p className="text-ink-dim" data-selectable>
                        {t(finding.messageKey, finding.params)}
                      </p>
                      {finding.ops.map((op, index) => {
                        const preview = opPreview(profile, op, t)
                        return (
                          <p key={index} className="flex flex-wrap items-baseline gap-1.5">
                            <code className="numeric min-w-0 break-all text-ink-muted" data-selectable>
                              {preview.before}
                            </code>
                            <span className="text-ink-muted">&rarr;</span>
                            <code className="numeric min-w-0 break-all text-ink-muted" data-selectable>
                              {preview.after}
                            </code>
                          </p>
                        )
                      })}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}

        {outcome && !outcome.ok && (
          <p className="text-xs text-danger">{t(outcome.error.key, outcome.error.params)}</p>
        )}

        {applied && (
          <div className="space-y-1.5 rounded-sm border border-line px-2.5 py-2">
            <p className="text-xs text-ink-dim">
              {t('config.care.tidyUp.batch.result.applied', { count: applied.applied.length })}
            </p>
            {applied.rejected.length > 0 && (
              <p className="text-xs text-ink-muted">
                {t('config.care.tidyUp.batch.result.rejected', {
                  count: applied.rejected.length,
                })}
              </p>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
