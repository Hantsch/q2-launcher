import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { validateFolderName } from '@shared/replays/demo-folders'
import type { LocalizedMessage, Outcome } from '@shared/types'
import { NameDialog } from '../../components/ui/NameDialog'

/**
 * Asks for a folder name for create or rename. Live validation reuses the pure `validateFolderName`;
 * main's own refusal (a `replays.folder.error.*` key) is shown in the very same error slot.
 */
export function FolderNameDialog({
  titleKey,
  submitLabelKey,
  initialName,
  onSubmit,
  onClose,
}: {
  titleKey: string
  submitLabelKey: string
  initialName: string
  onSubmit: (name: string) => Promise<Outcome<unknown>>
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState(initialName)
  const [serverError, setServerError] = useState<LocalizedMessage | null>(null)

  const validation = draft.trim() === '' ? null : validateFolderName(draft)
  const localError =
    validation !== null && !validation.ok ? t(validation.reasonKey, validation.params) : undefined
  const error = localError ?? (serverError ? t(serverError.key, serverError.params) : undefined)

  return (
    <NameDialog
      titleKey={titleKey}
      labelKey="common.label.name"
      submitLabelKey={submitLabelKey}
      initialName={initialName}
      error={error}
      submittable={(trimmed) => validateFolderName(trimmed).ok && trimmed !== initialName}
      onNameChange={(value) => {
        setDraft(value)
        setServerError(null)
      }}
      onSubmit={async (trimmed) => {
        const outcome = await onSubmit(trimmed)
        if (!outcome.ok) {
          setServerError(outcome.error)
          return
        }
        onClose()
      }}
      onClose={onClose}
      testIds={{
        dialog: 'folder-name-dialog',
        input: 'folder-name-input',
        submit: 'folder-name-save',
        error: 'folder-name-error',
      }}
    />
  )
}
