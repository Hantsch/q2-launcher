import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { EngineUpdateStatus } from '@shared/modules/downloads'
import { useLauncher } from '../../../store/useLauncher'
import { Button } from '../../../components/ui/Button'
import { Switch } from '../../../components/ui/controls'
import {
  getEngineUpdateStatus,
  setEngineBleedingEdge,
  startEngineRollback,
  startEngineUpdate,
} from '../client'
import { useStartJob } from '../../../components/jobs/useStartJob'
import { JobActionDialog } from '../components/JobActionDialog'

/**
 * Story 092 D7: the engine-update dialog - current/target version, Update, Rollback, and (Q2PRO
 * only) the bleeding-edge toggle. Opened via
 * `openDialog({ kind: 'module', moduleId: 'downloads', view: 'engine-update', installationId })`,
 * the `EngineUpdateAction` trigger's own job.
 *
 * Mirrors `RetailUpgradeDialog`'s shape (fetch-on-mount into `useState`, a `Modal` with a
 * footer-driven close, and a "start -> switch to `RunningStep`" transition once a job exists,
 * reusing `RunningStep` the same way). Two differences from that dialog: this one fetches a status
 * object rather than a list (so it can refetch after a bleeding-edge toggle, since that flips what
 * `target` means), and it offers two job-starting actions (Update/Rollback) plus a non-job action
 * (the toggle) rather than one single confirm.
 *
 * `data-testid`s are this dialog's own, per the story's explicit naming instruction:
 * `engine-update-dialog` (the status view's container), `engine-update-confirm` (Update),
 * `engine-update-rollback`, `engine-update-error`, `engine-update-bleeding-edge-error`,
 * `engine-update-dismiss` (closes a finished/running job). The bleeding-edge toggle itself is a
 * shared `Switch` (no `data-testid` passthrough, same as every other `Switch` call site in this
 * codebase) - addressable by its `role="switch"` accessible name, `engineUpdate.bleedingEdge.label`.
 */
export function EngineUpdateDialog({ installationId }: { installationId: string }) {
  const { t } = useTranslation()
  const closeDialog = useLauncher((state) => state.closeDialog)

  const [status, setStatus] = useState<EngineUpdateStatus | null>(null)
  const [fetchError, setFetchError] = useState<string | null>(null)

  const { start, starting, refusal, jobId, job } = useStartJob((action: 'update' | 'rollback') =>
    action === 'update'
      ? startEngineUpdate({ installationId })
      : startEngineRollback({ installationId }),
  )
  const startError = refusal ? t(refusal.key, refusal.params ?? {}) : null

  const [bleedingEdgeSaving, setBleedingEdgeSaving] = useState(false)
  const [bleedingEdgeError, setBleedingEdgeError] = useState<string | null>(null)

  async function refreshStatus(): Promise<void> {
    const result = await getEngineUpdateStatus(installationId)
    if (!result.ok) {
      setFetchError(t(result.error.key, result.error.params ?? {}))
      return
    }
    if (!result.value) {
      setFetchError(t('engineUpdate.notFound'))
      return
    }
    setFetchError(null)
    setStatus(result.value)
  }

  useEffect(() => {
    void refreshStatus()
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- status is re-read when the installation changes; refreshStatus is a fresh closure each render.
  }, [installationId])

  async function toggleBleedingEdge(enabled: boolean): Promise<void> {
    setBleedingEdgeSaving(true)
    setBleedingEdgeError(null)
    const result = await setEngineBleedingEdge({ installationId, enabled })
    setBleedingEdgeSaving(false)
    if (result.ok) {
      await refreshStatus()
    } else {
      setBleedingEdgeError(t(result.error.key, result.error.params ?? {}))
    }
  }

  return (
    <JobActionDialog
      title={t('engineUpdate.title')}
      description={t('engineUpdate.description')}
      onClose={closeDialog}
      starting={starting}
      jobId={jobId}
      job={job}
      dismissTestId="engine-update-dismiss"
      footer={
        <Button variant="ghost" onClick={closeDialog}>
          {t('common.close')}
        </Button>
      }
    >
      <div className="space-y-4" data-testid="engine-update-dialog">
        {status === null && !fetchError && (
          <p className="text-xs text-ink-muted">{t('engineUpdate.loading')}</p>
        )}

        {fetchError && (
          <p className="text-xs text-danger" data-testid="engine-update-fetch-error">
            {fetchError}
          </p>
        )}

        {status && (
          <>
            <dl className="space-y-1 text-xs">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-ink-muted">{t('engineUpdate.current')}</dt>
                <dd className="numeric text-ink" data-testid="engine-update-current">
                  {status.current ?? t('engineUpdate.unknownVersion')}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-ink-muted">{t('engineUpdate.target')}</dt>
                <dd className="numeric text-ink" data-testid="engine-update-target">
                  {status.target ?? t('engineUpdate.unknownVersion')}
                </dd>
              </div>
            </dl>

            <div className="flex items-center gap-2">
              <Button
                variant="primary"
                disabled={!status.updateAvailable || starting}
                onClick={() => void start('update')}
                data-testid="engine-update-confirm"
              >
                {t('engineUpdate.update')}
              </Button>
              <Button
                variant="neutral"
                disabled={!status.backup || starting}
                onClick={() => void start('rollback')}
                data-testid="engine-update-rollback"
              >
                {t('engineUpdate.rollback')}
              </Button>
            </div>

            {startError && (
              <p className="text-xs text-danger" data-testid="engine-update-error">
                {startError}
              </p>
            )}

            {/* Decisions (Sprint): bleeding edge is offered on Q2PRO installations only - the
                  toggle is not rendered for any other engine. */}
            {status.engine === 'q2pro' && (
              <div className="border-t border-line pt-3">
                <Switch
                  checked={status.channel === 'bleeding-edge'}
                  onChange={(next) => void toggleBleedingEdge(next)}
                  disabled={bleedingEdgeSaving}
                  label={t('engineUpdate.bleedingEdge.label')}
                  hint={t('engineUpdate.bleedingEdge.hint')}
                />
                {bleedingEdgeError && (
                  <p
                    className="text-xs text-danger"
                    data-testid="engine-update-bleeding-edge-error"
                  >
                    {bleedingEdgeError}
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </JobActionDialog>
  )
}
