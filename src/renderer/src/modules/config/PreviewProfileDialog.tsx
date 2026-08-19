import { useTranslation } from 'react-i18next'
import type { ConfigProfile } from '@shared/modules/config'
import { Modal } from '../../components/ui/Modal'
import { useLauncher } from '../../store/useLauncher'
import { RawConfigPanel } from './RawConfigPanel'

/**
 * Read-only preview of the exact files a `write` would put on one
 * installation's disk for a profile, without writing them. Module-local,
 * like the rest of this module's dialogs: props-based, no shell store.
 *
 * All fetching/rendering lives in `RawConfigPanel`, shared with the (later)
 * raw-view tab; this dialog only resolves the installation name for the
 * title and owns the modal chrome.
 */
export function PreviewProfileDialog({
  profile,
  installationId,
  onClose,
}: {
  profile: ConfigProfile
  installationId: string
  onClose: () => void
}) {
  const { t } = useTranslation()
  const installations = useLauncher((state) => state.installations)
  const installation = installations.find((entry) => entry.id === installationId)

  return (
    <Modal
      open
      size="lg"
      title={t('config.previewDialog.title', {
        installation: installation?.name ?? installationId,
      })}
      onClose={onClose}
      closeLabel={t('common.close')}
    >
      <RawConfigPanel profile={profile} installationId={installationId} />
    </Modal>
  )
}
