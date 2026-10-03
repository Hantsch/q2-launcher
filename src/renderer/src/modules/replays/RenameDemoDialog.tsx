import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { DemoRow } from '@shared/modules/replays'
import { demoExtension, validateDemoRename } from '@shared/replays/demo-rename'
import type { LocalizedMessage } from '@shared/types'
import { NameDialog } from '../../components/ui/NameDialog'
import { renameDemo, sidecarRead } from './client'
import { rowWithSidecar } from './row-patch'

/**
 * Renames a demo's on-disk file via its stem - the fixed extension is shown as static text, never
 * editable. Live validation reuses the pure `validateDemoRename` on every keystroke; the server call
 * only happens on submit, and its own refusal (a `replays.rename.error.*` key) is shown in the very
 * same error slot.
 */
export function RenameDemoDialog({
  demo,
  onClose,
  onRenamed,
}: {
  demo: DemoRow
  onClose: () => void
  onRenamed: (oldId: string, newRow: DemoRow) => void
}) {
  const { t } = useTranslation()
  const ext = demoExtension(demo.fileName)
  const initialStem =
    ext !== '' ? demo.fileName.slice(0, demo.fileName.length - ext.length) : demo.fileName
  const [stem, setStem] = useState(initialStem)
  const [serverError, setServerError] = useState<LocalizedMessage | null>(null)

  const validation = validateDemoRename(stem, demo.fileName)
  const localError = validation.ok ? undefined : t(validation.reasonKey, validation.params)
  const error = localError ?? (serverError ? t(serverError.key, serverError.params) : undefined)

  const submit = async (trimmed: string): Promise<void> => {
    const oldId = demo.id
    const outcome = await renameDemo(demo.id, trimmed)
    if (!outcome.ok) {
      setServerError(outcome.error)
      return
    }
    const sidecar = await sidecarRead(outcome.value.demo.id)
    const composed = rowWithSidecar(
      outcome.value.demo,
      sidecar.ok ? sidecar.value : { state: { state: 'none' }, values: {} },
    )
    onRenamed(oldId, composed)
    onClose()
  }

  return (
    <NameDialog
      titleKey="replays.rename.title"
      labelKey="common.label.name"
      initialName={initialStem}
      suffix={ext !== '' ? ext : undefined}
      error={error}
      submittable={() => validation.ok && validation.fileName !== demo.fileName}
      onNameChange={(value) => {
        setStem(value)
        setServerError(null)
      }}
      onSubmit={submit}
      onClose={onClose}
      testIds={{
        dialog: 'demo-rename-dialog',
        input: 'demo-rename-input',
        submit: 'demo-rename-save',
        error: 'demo-rename-error',
      }}
    />
  )
}
