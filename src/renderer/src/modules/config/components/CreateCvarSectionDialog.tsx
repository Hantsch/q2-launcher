import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../../components/ui/Button'
import { Field, Input } from '../../../components/ui/controls'
import { Modal } from '../../../components/ui/Modal'

/**
 * Create-section form: name only (story 059 D8) - a cvar section has no template suggestions to
 * offer, mirroring `CreateSubcategoryDialog` (`ControlsTab.tsx`, story 053 D6) rather than
 * `CreateCategoryDialog`'s template list. Exported so it can be unit-tested directly, same
 * convention every other Controls/Settings create dialog follows.
 */
export function CreateCvarSectionDialog({
  onClose,
  onSubmit,
}: {
  onClose: () => void
  onSubmit: (name: string) => Promise<boolean>
}) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const canSubmit = name.trim().length > 0 && !submitting

  const submit = async (): Promise<void> => {
    setSubmitting(true)
    const ok = await onSubmit(name.trim())
    setSubmitting(false)
    if (!ok) return
  }

  return (
    <Modal
      open
      size="sm"
      title={t('config.settings.section.createDialog.title')}
      onClose={onClose}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" disabled={!canSubmit} onClick={() => void submit()}>
            {t('config.settings.section.createDialog.submit')}
          </Button>
        </>
      }
    >
      <Field label={t('config.settings.section.createDialog.nameLabel')}>
        <Input
          value={name}
          autoFocus
          maxLength={120}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && canSubmit) void submit()
          }}
        />
      </Field>
    </Modal>
  )
}
