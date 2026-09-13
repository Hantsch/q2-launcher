import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ConfigCvarSubsection } from '@shared/modules/config'
import { Button } from '../../../components/ui/Button'
import { Field, Input } from '../../../components/ui/controls'
import { Modal } from '../../../components/ui/Modal'

/** Renames one cvar sub-section. Mirrors `RenameSubcategoryDialog`'s shape (`ControlsTab.tsx`). */
export function RenameCvarSubsectionDialog({
  subsection,
  onClose,
  onSubmit,
}: {
  subsection: ConfigCvarSubsection
  onClose: () => void
  onSubmit: (name: string) => Promise<boolean>
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(subsection.name)
  const [submitting, setSubmitting] = useState(false)

  const canSubmit = name.trim().length > 0 && !submitting

  const submit = async (): Promise<void> => {
    setSubmitting(true)
    await onSubmit(name.trim())
    setSubmitting(false)
  }

  return (
    <Modal
      open
      size="sm"
      title={t('config.settings.section.subsection.renameDialog.title')}
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
      <Field label={t('config.settings.section.subsection.renameDialog.label')}>
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
