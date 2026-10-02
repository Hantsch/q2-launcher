import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { DemoRow } from '@shared/modules/replays'
import { demoExtension, validateDemoRename } from '@shared/replays/demo-rename'
import type { LocalizedMessage } from '@shared/types'
import { Button } from '../../components/ui/Button'
import { Field, Input } from '../../components/ui/controls'
import { Modal } from '../../components/ui/Modal'
import { renameDemo, sidecarRead } from './client'
import { rowWithSidecar } from './row-patch'

/**
 * Story 157 D4: renames a demo's on-disk file (via its stem - the fixed extension is shown as
 * static text, never editable). Mirrors `RenameProfileDialog.tsx`'s shape: props-based, no shell
 * store, talks to the replays client directly. Live validation reuses D1's pure
 * `validateDemoRename` on every keystroke; the server call only happens on submit, and its own
 * refusal (a `replays.rename.error.*` key) is shown in the very same error slot.
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
  const [stem, setStem] = useState(() =>
    ext !== '' ? demo.fileName.slice(0, demo.fileName.length - ext.length) : demo.fileName,
  )
  const [submitting, setSubmitting] = useState(false)
  const [serverError, setServerError] = useState<LocalizedMessage | null>(null)

  const validation = validateDemoRename(stem, demo.fileName)
  const localError = validation.ok
    ? undefined
    : t(validation.reasonKey, validation.params)
  const error = localError ?? (serverError ? t(serverError.key, serverError.params) : undefined)

  const unchanged = validation.ok && validation.fileName === demo.fileName
  const canSubmit = validation.ok && !unchanged && !submitting

  const handleStemChange = (value: string): void => {
    setStem(value)
    setServerError(null)
  }

  const submit = async (): Promise<void> => {
    if (!canSubmit) return
    setSubmitting(true)
    const oldId = demo.id
    const outcome = await renameDemo(demo.id, stem.trim())
    setSubmitting(false)
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
    <Modal
      open
      size="sm"
      title={t('replays.rename.title')}
      onClose={onClose}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={!canSubmit}
            onClick={() => void submit()}
            data-testid="demo-rename-save"
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div data-testid="demo-rename-dialog">
        <Field label={t('replays.rename.label')}>
          <div className="flex items-center gap-2">
            <Input
              value={stem}
              autoFocus
              data-testid="demo-rename-input"
              onChange={(event) => handleStemChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && canSubmit) void submit()
              }}
            />
            {ext !== '' && <span className="text-ink-muted">{ext}</span>}
          </div>
        </Field>
        {error && (
          <p className="text-xs text-danger" role="alert" data-testid="demo-rename-error">
            {error}
          </p>
        )}
      </div>
    </Modal>
  )
}
