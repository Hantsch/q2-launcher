import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useInstallationById, useLauncher } from '../../store/useLauncher'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/controls'
import { Modal } from '../ui/Modal'

export function RenameInstallationDialog({ installationId }: { installationId: string }) {
  const { t } = useTranslation()
  const installation = useInstallationById(installationId)
  const closeDialog = useLauncher((state) => state.closeDialog)
  const updateInstallation = useLauncher((state) => state.updateInstallation)
  const [name, setName] = useState(installation?.name ?? '')
  const [submitting, setSubmitting] = useState(false)

  if (!installation) return null

  const submit = async (): Promise<void> => {
    setSubmitting(true)
    const result = await updateInstallation({ id: installation.id, name: name.trim() })
    setSubmitting(false)
    if (result.ok) closeDialog()
  }

  return (
    <Modal
      open
      size="sm"
      title={t('dialog.rename.title')}
      onClose={closeDialog}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="ghost" onClick={closeDialog}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={name.trim().length === 0 || submitting}
            onClick={() => void submit()}
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <Field label={t('dialog.rename.label')}>
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
