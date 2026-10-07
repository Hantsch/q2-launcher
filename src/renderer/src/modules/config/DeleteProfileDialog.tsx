import { useTranslation } from 'react-i18next'
import type { ConfigProfile } from '@shared/modules/config'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { useSubmitting } from '../../components/ui/useSubmitting'
import { removeConfigProfile } from './client'

/**
 * Deletion confirmation for a config profile. Module-local, like the rest of
 * this module's dialogs: props-based, no shell store.
 *
 * Unlike an installation, a config profile has no on-disk counterpart - it
 * lives only in the launcher's own state - so there is no "your files are
 * safe" reassurance to give. The wording stays honest that this removes the
 * profile for good: there is no undo.
 */
export function DeleteProfileDialog({
  profile,
  onClose,
  onDeleted,
}: {
  profile: ConfigProfile
  onClose: () => void
  /** The full, updated profile list, per the config module's remove contract. */
  onDeleted: (profiles: ConfigProfile[]) => void
}) {
  const { t } = useTranslation()
  const { submitting, run } = useSubmitting()

  return (
    <ConfirmDialog
      title={t('config.deleteDialog.title', { name: profile.name })}
      body={t('config.deleteDialog.body')}
      confirmLabel={t('config.deleteDialog.confirm')}
      tone="danger"
      busy={submitting}
      onClose={onClose}
      onConfirm={() =>
        void run(async () => {
          const result = await removeConfigProfile({ id: profile.id })
          if (result.ok) onDeleted(result.value)
        })
      }
    />
  )
}
