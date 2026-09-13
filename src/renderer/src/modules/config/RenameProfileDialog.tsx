import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ConfigProfile } from '@shared/modules/config'
import { Button } from '../../components/ui/Button'
import { Field, Input } from '../../components/ui/controls'
import { Modal } from '../../components/ui/Modal'
import { renameConfigProfile } from './client'

/**
 * Renames a config profile. Module-local, like the rest of this module's
 * dialogs: props-based, no shell store, talks to the config client directly.
 */
export function RenameProfileDialog({
  profile,
  onClose,
  onRenamed,
}: {
  profile: ConfigProfile
  onClose: () => void
  /** The full, updated profile list, per the config module's rename contract. */
  onRenamed: (profiles: ConfigProfile[]) => void
}) {
  const { t } = useTranslation()

  const [name, setName] = useState(profile.name)
  const [submitting, setSubmitting] = useState(false)

  const canSubmit = name.trim().length > 0 && !submitting

  const submit = async (): Promise<void> => {
    setSubmitting(true)
    const result = await renameConfigProfile({ id: profile.id, name: name.trim() })
    setSubmitting(false)
    if (result.ok) onRenamed(result.value)
  }

  return (
    <Modal
      open
      size="sm"
      title={t('config.renameDialog.title')}
      onClose={onClose}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" disabled={!canSubmit} onClick={() => void submit()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <Field label={t('config.renameDialog.label')}>
        <Input
          value={name}
          autoFocus
          maxLength={120}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && name.trim().length > 0) void submit()
          }}
        />
      </Field>
    </Modal>
  )
}
