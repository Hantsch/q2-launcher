import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ModInstallChoice } from '@shared/modules/mods'
import { Button } from '../../../components/ui/Button'
import { Modal } from '../../../components/ui/Modal'
import { resolveInstall } from '../client'

export interface InstallDecisionRequest {
  jobId: string
  /** The existing folder's own name. */
  folder: string
  /** Gamedir-relative paths of existing files whose bytes differ. May be empty. */
  conflicts: string[]
}

/**
 * An install met a folder the launcher did not create. Names the folder, lists the files that
 * would be replaced, and sends the user's answer to the waiting job. Closing the dialog is
 * "Cancel": the job must never be left waiting with nothing on screen to answer it.
 */
export function InstallDecisionDialog({
  request,
  onAnswered,
}: {
  request: InstallDecisionRequest
  onAnswered: (jobId: string) => void
}) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)

  const answer = async (choice: ModInstallChoice): Promise<void> => {
    setBusy(true)
    await resolveInstall(request.jobId, choice)
    setBusy(false)
    onAnswered(request.jobId)
  }

  return (
    <Modal
      open
      size="md"
      title={t('mods.decision.title')}
      onClose={() => void answer('cancel')}
      closeLabel={t('common.action.close')}
      footer={
        <>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => void answer('cancel')}
            data-testid="mods-install-decision-cancel"
          >
            {t('common.action.cancel')}
          </Button>
          <Button
            disabled={busy}
            onClick={() => void answer('keep')}
            data-testid="mods-install-decision-keep"
          >
            {t('mods.decision.keep')}
          </Button>
          <Button
            variant="danger"
            disabled={busy}
            onClick={() => void answer('overwrite')}
            data-testid="mods-install-decision-overwrite"
          >
            {t('common.action.overwrite')}
          </Button>
        </>
      }
    >
      <div className="space-y-3" data-testid="mods-install-decision">
        <p className="text-sm leading-relaxed text-ink-dim">
          {t('mods.decision.body')}{' '}
          <span className="font-semibold text-ink" data-testid="mods-install-decision-folder">
            {request.folder}
          </span>
        </p>
        {request.conflicts.length === 0 ? (
          <p className="text-sm text-ink-dim" data-testid="mods-install-decision-no-conflicts">
            {t('mods.decision.noConflicts')}
          </p>
        ) : (
          <div className="space-y-1">
            <p className="text-sm text-ink-dim">
              {t('mods.decision.conflicts', { count: request.conflicts.length })}
            </p>
            <ul className="max-h-48 space-y-0.5 overflow-y-auto rounded-sm border border-line p-2 text-xs text-ink select-text">
              {request.conflicts.map((path) => (
                <li key={path} className="break-all" data-testid="mods-install-decision-conflict">
                  {path}
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="text-xs text-ink-dim">{t('mods.decision.hint')}</p>
      </div>
    </Modal>
  )
}
