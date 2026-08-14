import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ShieldCheck } from 'lucide-react'
import { useInstallationById, useLauncher } from '../../store/useLauncher'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'

/**
 * Removal confirmation.
 *
 * The wording is explicit that nothing is deleted from disk, because "remove"
 * in a game launcher usually means uninstall. Deleting files is not implemented
 * at all in step 1 - main rejects the request even if something asks for it.
 */
export function RemoveInstallationDialog({ installationId }: { installationId: string }) {
  const { t } = useTranslation()
  const installation = useInstallationById(installationId)
  const closeDialog = useLauncher((state) => state.closeDialog)
  const removeInstallation = useLauncher((state) => state.removeInstallation)
  const [submitting, setSubmitting] = useState(false)

  if (!installation) return null

  const submit = async (): Promise<void> => {
    setSubmitting(true)
    await removeInstallation(installation.id)
    setSubmitting(false)
    closeDialog()
  }

  return (
    <Modal
      open
      size="sm"
      title={t('dialog.remove.title', { name: installation.name })}
      onClose={closeDialog}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="ghost" onClick={closeDialog}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" disabled={submitting} onClick={() => void submit()}>
            {t('dialog.remove.confirm')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm leading-relaxed text-ink-dim">{t('dialog.remove.body')}</p>
        <p className="flex items-start gap-2 rounded-sm border border-success/30 bg-success/8 p-2.5 text-xs leading-relaxed text-ink-dim">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-success" />
          <span className="numeric" data-selectable>
            {t('dialog.remove.pathNote', { path: installation.rootPath })}
          </span>
        </p>
      </div>
    </Modal>
  )
}
