import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { RepairOffer, RepairOfferKind, RepairPlan } from '@shared/modules/downloads'
import { useFixAction } from '../../../components/installations/ChecksList'
import { useInstallationById, useLauncher } from '../../../store/useLauncher'
import { Button } from '../../../components/ui/Button'
import { Modal } from '../../../components/ui/Modal'
import { getRepairPlan, startRepair } from '../client'
import { RunningStep } from '../bootstrap/RunningStep'

/**
 * Story 093 D5: the repair dialog - one row per offer a fresh `RepairPlan` (D2) carries for this
 * installation, each routed to whatever actually resolves it. Opened via
 * `openDialog({ kind: 'module', moduleId: 'downloads', view: 'repair', installationId })` - the
 * shell's own trigger (ActionBar/ChecksList) is a separate deliverable; this component only needs
 * to render correctly once reached.
 *
 * Mirrors `RetailUpgradeDialog`'s shape (fetch-on-mount into `useState`, a `Modal`, and a
 * "start -> switch to `RunningStep`" transition once a job exists, reusing `RunningStep` itself).
 * Unlike that dialog, a single screen can offer more than one action at once, because
 * `RepairPlan.offers` is a list - each offer kind routes independently:
 *
 * - `'reinstall-engine'` / `'install-point-release'` start the D4 `repair.start` job for that one
 *   offer kind and hand over to `RunningStep`, same as `RetailUpgradeDialog`'s single confirm.
 * - `'retail-copy'` does not start a job here at all - it switches the module dialog's `view` to
 *   the existing `'retail-upgrade'` view (090's flow), because copying retail paks from a detected
 *   source is already fully built there; reimplementing it here would be a second copy of the same
 *   picker.
 * - `'set-write-dir'` does not go through a job either - it calls `useFixAction`'s existing
 *   `'set-write-dir'` handling directly, the same remedy the installation card's own checks list
 *   already offers (ActionBar's cross-directory usage of the same hook).
 *
 * AC6 (empty plan): `offers` can legitimately be empty while `findings` is not - "nothing here is
 * repairable by this dialog" still shows what is wrong. That state renders every finding plus a
 * plain "nothing can be repaired automatically" message, and no action button at all - it is a live
 * read of the plan already (the fetch happens on open), never a snapshot decided by the shell.
 *
 * `data-testid`s (D6's later e2e flow, `scripts/flows/repair.mjs`), mirroring
 * `RetailUpgradeDialog`'s own naming convention: `repair-dialog` (the container), `repair-offer-*`
 * keyed by offer kind (e.g. `repair-offer-reinstall-engine`), `repair-empty` (AC6's message),
 * `repair-error`, `repair-dismiss` (closes a finished/running job) - `RunningStep` itself already
 * carries `bootstrap-running-step` as the progress handover's own testid, reused unchanged.
 */
export function RepairDialog({ installationId }: { installationId: string }) {
  const { t } = useTranslation()
  const closeDialog = useLauncher((state) => state.closeDialog)
  const openDialog = useLauncher((state) => state.openDialog)
  const installation = useInstallationById(installationId)
  const runFix = useFixAction()

  const [plan, setPlan] = useState<RepairPlan | null>(null)
  const [fetchError, setFetchError] = useState<string | null>(null)

  const [starting, setStarting] = useState<RepairOfferKind | null>(null)
  const [startError, setStartError] = useState<string | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const job = useLauncher((state) => state.jobs.find((candidate) => candidate.id === jobId))

  useEffect(() => {
    let cancelled = false
    void getRepairPlan(installationId).then((result) => {
      if (cancelled) return
      if (!result.ok) {
        setFetchError(t(result.error.key, result.error.params ?? {}))
        return
      }
      if (!result.value) {
        setFetchError(t('repair.notFound'))
        return
      }
      setFetchError(null)
      setPlan(result.value)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [installationId])

  async function startOffer(kind: RepairOfferKind): Promise<void> {
    setStarting(kind)
    setStartError(null)
    const result = await startRepair({ installationId, offers: [kind] })
    setStarting(null)
    if (result.ok) {
      setJobId(result.value.jobId)
    } else {
      setStartError(t(result.error.key, result.error.params ?? {}))
    }
  }

  function runOffer(offer: RepairOffer): void {
    switch (offer.kind) {
      case 'reinstall-engine':
      case 'install-point-release':
        void startOffer(offer.kind)
        return
      case 'retail-copy':
        openDialog({ kind: 'module', moduleId: 'downloads', view: 'retail-upgrade', installationId })
        return
      case 'set-write-dir':
        if (installation) void runFix(installation, 'set-write-dir')
        return
    }
  }

  const running = !!jobId

  return (
    <Modal
      open
      title={t('repair.title')}
      description={t('repair.description')}
      onClose={closeDialog}
      closeLabel={t('common.close')}
      preventClose={!!starting}
      footer={
        running ? (
          <Button variant="primary" onClick={closeDialog} data-testid="repair-dismiss">
            {t('bootstrapWizard.running.dismiss')}
          </Button>
        ) : (
          <Button variant="ghost" onClick={closeDialog}>
            {t('common.close')}
          </Button>
        )
      }
    >
      {running ? (
        <RunningStep job={job} />
      ) : (
        <div className="space-y-3" data-testid="repair-dialog">
          {plan === null && !fetchError && (
            <p className="text-xs text-ink-muted">{t('repair.loading')}</p>
          )}

          {fetchError && (
            <p className="text-xs text-danger" data-testid="repair-fetch-error">
              {fetchError}
            </p>
          )}

          {plan && (
            <>
              <ul className="space-y-1">
                {plan.findings.map((finding) => (
                  <li key={finding.id} className="text-xs text-ink-muted">
                    {t(finding.messageKey, finding.params ?? {})}
                  </li>
                ))}
              </ul>

              {plan.offers.length === 0 ? (
                <p className="text-xs text-ink-muted" data-testid="repair-empty">
                  {t('repair.nothingToRepair')}
                </p>
              ) : (
                <ul className="space-y-2">
                  {plan.offers.map((offer, index) => (
                    <li
                      key={`${offer.kind}-${index}`}
                      className="flex items-center justify-between gap-3 rounded-sm border border-line-strong bg-void/10 p-3"
                    >
                      <p className="text-xs text-ink-dim">{t(offer.messageKey, offer.params ?? {})}</p>
                      <Button
                        variant="primary"
                        size="sm"
                        disabled={!!starting}
                        onClick={() => runOffer(offer)}
                        data-testid={`repair-offer-${offer.kind}`}
                      >
                        {t(`repair.offer.${offer.kind}`)}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {startError && (
            <p className="text-xs text-danger" data-testid="repair-error">
              {startError}
            </p>
          )}
        </div>
      )}
    </Modal>
  )
}
