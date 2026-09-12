import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { EngineUpdateStatus } from '@shared/modules/downloads'
import { useLauncher } from '../../../store/useLauncher'
import { Button } from '../../../components/ui/Button'
import { Modal } from '../../../components/ui/Modal'
import { Switch } from '../../../components/ui/controls'
import {
  getEngineUpdateStatus,
  setEngineBleedingEdge,
  startEngineRollback,
  startEngineUpdate,
} from '../client'
import { RunningStep } from '../bootstrap/RunningStep'

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

  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const job = useLauncher((state) => state.jobs.find((candidate) => candidate.id === jobId))

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [installationId])

  async function start(action: 'update' | 'rollback'): Promise<void> {
    setStarting(true)
    setStartError(null)
    const result =
      action === 'update'
        ? await startEngineUpdate({ installationId })
        : await startEngineRollback({ installationId })
    setStarting(false)
    if (result.ok) {
      setJobId(result.value.jobId)
    } else {
      setStartError(t(result.error.key, result.error.params ?? {}))
    }
  }

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

  const running = !!jobId

  return (
    <Modal
      open
      title={t('engineUpdate.title')}
      description={t('engineUpdate.description')}
      onClose={closeDialog}
      closeLabel={t('common.close')}
      preventClose={starting}
      footer={
        running ? (
          <Button variant="primary" onClick={closeDialog} data-testid="engine-update-dismiss">
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
      )}
    </Modal>
  )
}
