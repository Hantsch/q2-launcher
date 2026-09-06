import { useTranslation } from 'react-i18next'
import { useInstallationById, useLauncher } from '../../store/useLauncher'
import { CleanupPanel } from '../../modules/config/CleanupPanel'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'

/**
 * Story 058 D6: the redundant-config-copies cleanup as an action on the installation.
 *
 * Modal chrome only - the scan/apply/undo flow and its backup-once contract stay entirely in
 * `CleanupPanel` (config module) and its main-process half. Library contributes the trigger and
 * the scope, nothing else; the `module:invoke` seam is untouched, which is why this cross-module
 * renderer import is the deliberately accepted one (story 058 decision 8).
 *
 * The scope is resolved here, once, from the installation the row belongs to: an id that no
 * longer names a registered installation renders nothing at all rather than handing a stale id to
 * a flow that deletes files, and the installation's own name is on the dialog so the user can see
 * which game folder is about to be scanned.
 */
export function CleanupConfigCopiesDialog({ installationId }: { installationId: string }) {
  const { t } = useTranslation()
  const installation = useInstallationById(installationId)
  const closeDialog = useLauncher((state) => state.closeDialog)

  if (!installation) return null

  return (
    <Modal
      open
      size="md"
      title={t('dialog.cleanup.title')}
      description={t('dialog.cleanup.description', { name: installation.name })}
      onClose={closeDialog}
      closeLabel={t('common.close')}
      footer={
        <Button variant="ghost" onClick={closeDialog}>
          {t('common.close')}
        </Button>
      }
    >
      <CleanupPanel installationId={installation.id} />
    </Modal>
  )
}
