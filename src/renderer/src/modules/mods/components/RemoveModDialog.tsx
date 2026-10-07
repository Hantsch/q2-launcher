import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ModRemoveChangedFiles } from '@shared/modules/mods'
import { Button } from '../../../components/ui/Button'
import { Modal } from '../../../components/ui/Modal'
import { Radio, RadioGroup } from '../../../components/ui/RadioGroup'
import { useStartJob } from '../../../components/jobs/useStartJob'
import { useModuleQuery } from '../../../lib/useModuleQuery'
import { previewRemoval, removeMod } from '../client'

/**
 * Story 191: confirms removing a mod the launcher installed. Opens by asking main what removal
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
  const [choice, setChoice] = useState<ModRemoveChangedFiles>('keep')
  const {
    start,
    starting: busy,
    refusal,
  } = useStartJob(
    useCallback(
      async (policy: ModRemoveChangedFiles) => {
        const outcome = await removeMod(installationId, modId, policy)
        if (outcome.ok) {
          onStarted(outcome.value.jobId)
          onClose()
        }
        return outcome
      },
      [installationId, modId, onStarted, onClose],
    ),
  )

  const previewQuery = useModuleQuery(() => previewRemoval(installationId, modId), {
    deps: [installationId, modId],
  })

  const preview = previewQuery.state === 'success' ? (previewQuery.data ?? null) : null
  const error = previewQuery.state === 'error' ? previewQuery.error : refusal
  const changed = preview?.changedFiles ?? []

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
      closeLabel={t('common.action.close')}
      footer={
        <>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={onClose}
            data-testid="mods-remove-cancel"
          >
            {t('common.action.cancel')}
          </Button>
          <Button
            variant="danger"
            disabled={busy || !preview}
            onClick={() => void start(changed.length > 0 ? choice : 'keep')}
            data-testid="mods-remove-confirm"
          >
            {t('common.action.remove')}
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
                <RadioGroup
                  name="mods-remove-changed"
                  value={choice}
                  onChange={(value) => setChoice(value as ModRemoveChangedFiles)}
                  label={t('mods.remove.changed', { count: changed.length })}
                >
                  <Radio
                    value="keep"
                    label={t('mods.remove.keepChanged')}
                    testId="mods-remove-changed-keep"
                  />
                  <Radio
                    value="delete"
                    label={t('mods.remove.deleteChanged')}
                    testId="mods-remove-changed-delete"
                  />
                </RadioGroup>
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
