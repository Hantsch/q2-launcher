import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ModUpdateChangedPolicy, ModUpdatePreview } from '@shared/modules/mods'
import type { LocalizedMessage } from '@shared/types'
import { Button } from '../../../components/ui/Button'
import { Modal } from '../../../components/ui/Modal'
import { updateMod } from '../client'

/**
 * Story 194 D4: the update met recorded files the user changed. Lists them and sends the answer
 * (overwrite or keep) with the start; Cancel starts nothing. A refusal is shown in place.
 */
export function UpdateModDialog({
  installationId,
  catalogId,
  preview,
  onClose,
  onStarted,
}: {
  installationId: string
  catalogId: string
  preview: ModUpdatePreview
  onClose: () => void
  onStarted: (jobId: string) => void
}) {
  const { t } = useTranslation()
  const [choice, setChoice] = useState<ModUpdateChangedPolicy>('keep')
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState<LocalizedMessage | null>(null)
  const changed = preview.changedFiles

  const confirm = async (): Promise<void> => {
    setBusy(true)
    setRefusal(null)
    const outcome = await updateMod(installationId, catalogId, choice)
    setBusy(false)
    if (outcome.ok) {
      onStarted(outcome.value.jobId)
      onClose()
    } else {
      setRefusal(outcome.error)
    }
  }

  const radio = (value: ModUpdateChangedPolicy, label: string) => (
    <label className="flex items-center gap-2 text-sm text-ink-dim">
      <input
        type="radio"
        name="mods-update-changed"
        checked={choice === value}
        onChange={() => setChoice(value)}
        data-testid={`mods-update-changed-${value}`}
        className="size-4 accent-flame-500 focus-visible:ring-2 focus-visible:ring-flame-500 focus-visible:outline-none"
      />
      {label}
    </label>
  )

  return (
    <Modal
      open
      size="md"
      title={t('mods.update.title', {
        mod: preview.modName,
        installation: preview.installationName,
      })}
      onClose={onClose}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={onClose}
            data-testid="mods-update-cancel"
          >
            {t('mods.update.cancel')}
          </Button>
          <Button disabled={busy} onClick={() => void confirm()} data-testid="mods-update-confirm">
            {t('mods.update.confirm')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm leading-relaxed text-ink-dim" data-testid="mods-update-body">
          {t('mods.update.body', {
            mod: preview.modName,
            from: preview.installedVersion,
            to: preview.targetVersion,
          })}
        </p>
        <fieldset className="space-y-2">
          <legend className="text-sm text-ink">
            {t('mods.update.changed', { count: changed.length })}
          </legend>
          <ul
            className="space-y-0.5 rounded-sm border border-line bg-raised p-2 text-xs text-ink select-text"
            data-testid="mods-update-changed-list"
          >
            {changed.map((path) => (
              <li key={path} className="break-all" data-testid="mods-update-changed-file">
                {path}
              </li>
            ))}
          </ul>
          {radio('keep', t('mods.update.keepChanged'))}
          {radio('overwrite', t('mods.update.overwriteChanged'))}
        </fieldset>
        {refusal && (
          <p role="alert" className="text-sm text-danger" data-testid="mods-update-error">
            {t(refusal.key, refusal.params ?? {})}
          </p>
        )}
      </div>
    </Modal>
  )
}
