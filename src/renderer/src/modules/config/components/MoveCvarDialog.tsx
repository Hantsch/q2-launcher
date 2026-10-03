import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../../components/ui/Button'
import { Field, Select } from '../../../components/ui/controls'
import { Modal } from '../../../components/ui/Modal'
import { useSubmitting } from '../../../components/ui/useSubmitting'
import type { CvarPlacementOption } from '../lib/cvar-sections'

/**
 * "Move to..." picker for one cvar (story 059 D8): drag and drop itself is story 054's job, out of
 * scope here - this is the non-drag mechanism the deliverable asks for instead, a `Select` naming
 * every section and sub-section in profile order, mirroring `DeleteCategoryDialog`'s own target
 * `Select` one level up.
 */
export function MoveCvarDialog({
  cvarName,
  targets,
  onClose,
  onSubmit,
}: {
  cvarName: string
  /** Every section's own run, then each of its sub-sections, in profile order - see
   * `cvarPlacementOptions`. Includes the cvar's current placement, if any: picking it back is a
   * harmless no-op, and filtering it out would only complicate this list for no real benefit. */
  targets: CvarPlacementOption[]
  onClose: () => void
  onSubmit: (target: CvarPlacementOption) => Promise<boolean>
}) {
  const { t } = useTranslation()
  const [index, setIndex] = useState(0)
  const { submitting, run } = useSubmitting()
  const canSubmit = targets.length > 0 && !submitting

  const submit = async (): Promise<void> => {
    if (!canSubmit) return
    await run(() => onSubmit(targets[index]!))
  }

  return (
    <Modal
      open
      size="sm"
      title={t('config.controls.moveEntryDialog.title', { name: cvarName })}
      onClose={onClose}
      closeLabel={t('common.action.close')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.action.cancel')}
          </Button>
          <Button variant="primary" disabled={!canSubmit} onClick={() => void submit()}>
            {t('common.action.move')}
          </Button>
        </>
      }
    >
      {targets.length === 0 ? (
        <p className="text-sm text-ink-muted">
          {t('config.settings.section.moveCvarDialog.empty')}
        </p>
      ) : (
        <Field label={t('common.label.moveTo')}>
          <Select
            value={String(index)}
            onChange={(event) => setIndex(Number(event.target.value))}
            options={targets.map((target, targetIndex) => ({
              value: String(targetIndex),
              label: target.label,
            }))}
          />
        </Field>
      )}
    </Modal>
  )
}
