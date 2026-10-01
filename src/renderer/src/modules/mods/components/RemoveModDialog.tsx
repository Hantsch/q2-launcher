import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ModRemovalPreview, ModRemoveChangedFiles } from '@shared/modules/mods'
import type { LocalizedMessage } from '@shared/types'
import { Button } from '../../../components/ui/Button'
import { Modal } from '../../../components/ui/Modal'
import { previewRemoval, removeMod } from '../client'

type Loaded =
  | { kind: 'loading' }
  | { kind: 'ready'; preview: ModRemovalPreview }
  | { kind: 'refused'; error: LocalizedMessage }

/**
 * Story 191 D3: confirms removing a mod the launcher installed. Opens by asking main what removal
 * would touch (nothing is deleted yet); recorded files the user changed are listed and default to
 * being kept. A refusal - from the preview or from the remove itself - is shown in place.
 */
export function RemoveModDialog({
  installationId,
  modId,
  displayName,
  onClose,
  onStarted,
}: {
  installationId: string
  modId: string
  /** The catalog's name for the mod when the panel has one; the record's id otherwise. */
  displayName?: string
  onClose: () => void
  onStarted: (jobId: string) => void
}) {
  const { t } = useTranslation()
  const [loaded, setLoaded] = useState<Loaded>({ kind: 'loading' })
  const [choice, setChoice] = useState<ModRemoveChangedFiles>('keep')
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState<LocalizedMessage | null>(null)

  useEffect(() => {
    let stale = false
    void previewRemoval(installationId, modId).then((outcome) => {
      if (stale) return
      setLoaded(
        outcome.ok ? { kind: 'ready', preview: outcome.value } : { kind: 'refused', error: outcome.error },
      )
    })
    return () => {
      stale = true
    }
  }, [installationId, modId])

  const preview = loaded.kind === 'ready' ? loaded.preview : null
  const error = loaded.kind === 'refused' ? loaded.error : refusal
  const changed = preview?.changedFiles ?? []

  const confirm = async (): Promise<void> => {
    setBusy(true)
    setRefusal(null)
    const outcome = await removeMod(installationId, modId, changed.length > 0 ? choice : 'keep')
    setBusy(false)
    if (outcome.ok) {
      onStarted(outcome.value.jobId)
      onClose()
    } else {
      setRefusal(outcome.error)
    }
  }

  return (
    <Modal
      open
      size="md"
      title={
        preview
          ? t('mods.remove.title', {
              mod: displayName ?? preview.modName,
              installation: preview.installationName,
            })
          : t('mods.remove.titleLoading')
      }
      onClose={onClose}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="ghost" disabled={busy} onClick={onClose} data-testid="mods-remove-cancel">
            {t('mods.remove.cancel')}
          </Button>
          <Button
            variant="danger"
            disabled={busy || !preview}
            onClick={() => void confirm()}
            data-testid="mods-remove-confirm"
          >
            {t('mods.remove.confirm')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {preview && (
          <>
            <p className="text-sm leading-relaxed text-ink-dim" data-testid="mods-remove-body">
              {t('mods.remove.body')}
            </p>
            {changed.length > 0 && (
              <fieldset className="space-y-2">
                <legend className="text-sm text-ink">
                  {t('mods.remove.changed', { count: changed.length })}
                </legend>
                <ul
                  className="space-y-0.5 rounded-sm border border-line bg-raised p-2 text-xs text-ink select-text"
                  data-testid="mods-remove-changed-list"
                >
                  {changed.map((path) => (
                    <li key={path} className="break-all" data-testid="mods-remove-changed-file">
                      {path}
                    </li>
                  ))}
                </ul>
                <label className="flex items-center gap-2 text-sm text-ink-dim">
                  <input
                    type="radio"
                    name="mods-remove-changed"
                    checked={choice === 'keep'}
                    onChange={() => setChoice('keep')}
                    data-testid="mods-remove-changed-keep"
                    className="size-4 accent-flame-500 focus-visible:ring-2 focus-visible:ring-flame-500 focus-visible:outline-none"
                  />
                  {t('mods.remove.keepChanged')}
                </label>
                <label className="flex items-center gap-2 text-sm text-ink-dim">
                  <input
                    type="radio"
                    name="mods-remove-changed"
                    checked={choice === 'delete'}
                    onChange={() => setChoice('delete')}
                    data-testid="mods-remove-changed-delete"
                    className="size-4 accent-flame-500 focus-visible:ring-2 focus-visible:ring-flame-500 focus-visible:outline-none"
                  />
                  {t('mods.remove.deleteChanged')}
                </label>
              </fieldset>
            )}
          </>
        )}
        {error && (
          <p role="alert" className="text-sm text-danger" data-testid="mods-remove-error">
            {t(error.key, error.params ?? {})}
          </p>
        )}
      </div>
    </Modal>
  )
}
