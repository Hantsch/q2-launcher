import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ConfigProfile, ConfigProfileSeed } from '@shared/modules/config'
import { Button } from '../../components/ui/Button'
import { Field, Input, Select } from '../../components/ui/controls'
import { Modal } from '../../components/ui/Modal'
import { createConfigProfile } from './client'

/**
 * Creates a config profile, empty or seeded from the standard template.
 *
 * Module-local, like the rest of the config module's dialogs: it owns its own
 * form state and talks to the config client directly, rather than going through
 * the shell's dialog/store mechanism (that mechanism is for shell-level, i.e.
 * installation, dialogs).
 */
export function CreateProfileDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void
  /** The full, updated profile list, per the config module's create contract. */
  onCreated: (profiles: ConfigProfile[]) => void
}) {
  const { t } = useTranslation()

  const [name, setName] = useState('')
  const [from, setFrom] = useState<ConfigProfileSeed>('empty')
  const [submitting, setSubmitting] = useState(false)

  const canSubmit = name.trim().length > 0 && !submitting

  const submit = async (): Promise<void> => {
    setSubmitting(true)
    const result = await createConfigProfile({ name: name.trim(), from })
    setSubmitting(false)
    if (result.ok) onCreated(result.value)
  }

  return (
    <Modal
      open
      title={t('config.createDialog.title')}
      onClose={onClose}
      closeLabel={t('common.close')}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" disabled={!canSubmit} onClick={() => void submit()}>
            {t('config.createDialog.submit')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('config.createDialog.nameLabel')}>
          <Input
            value={name}
            placeholder={t('config.createDialog.namePlaceholder')}
            onChange={(event) => setName(event.target.value)}
            maxLength={120}
          />
        </Field>

        <Field label={t('config.createDialog.sourceLabel')}>
          <Select
            value={from}
            onChange={(event) => setFrom(event.target.value as ConfigProfileSeed)}
            options={[
              { value: 'empty', label: t('config.createDialog.sourceEmpty') },
              { value: 'template', label: t('config.createDialog.sourceTemplate') },
            ]}
          />
        </Field>
      </div>
    </Modal>
  )
}
