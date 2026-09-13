import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ConfigProfile } from '@shared/modules/config'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { removeConfigProfile } from './client'

/**
 * Deletion confirmation for a config profile. Module-local, like the rest of
 * this module's dialogs: props-based, no shell store.
 *
 * Unlike an installation, a config profile has no on-disk counterpart - it
 * lives only in the launcher's own state - so there is no "your files are
 * safe" reassurance to give. The wording stays honest that this removes the
 * profile for good: there is no undo in this story.
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
  const [submitting, setSubmitting] = useState(false)

  const submit = async (): Promise<void> => {
    setSubmitting(true)
    const result = await removeConfigProfile({ id: profile.id })
    setSubmitting(false)
    if (result.ok) onDeleted(result.value)
  }

  return (
    <Modal
      open
      size="sm"
      title={t('config.deleteDialog.title', { name: profile.name })}
      onClose={onClose}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" disabled={submitting} onClick={() => void submit()}>
            {t('config.deleteDialog.confirm')}
          </Button>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-ink-dim">{t('config.deleteDialog.body')}</p>
    </Modal>
  )
}
