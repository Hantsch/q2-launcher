import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../../components/ui/Button'
import { Field, Input } from '../../../components/ui/controls'
import { Modal } from '../../../components/ui/Modal'

/** Create-sub-section form: name only. Mirrors `CreateSubcategoryDialog` (`ControlsTab.tsx`, story
 * 053 D6) one level down - a cvar sub-section, not an action one. */
export function CreateCvarSubsectionDialog({
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
      title={t('config.settings.section.subsection.createDialog.title')}
      onClose={onClose}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" disabled={!canSubmit} onClick={() => void submit()}>
            {t('config.settings.section.subsection.createDialog.submit')}
          </Button>
        </>
      }
    >
      <Field label={t('config.settings.section.subsection.createDialog.nameLabel')}>
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
