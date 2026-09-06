import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../../components/ui/Button'
import { Field, Select } from '../../../components/ui/controls'
import { Modal } from '../../../components/ui/Modal'
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
  const [submitting, setSubmitting] = useState(false)
  const canSubmit = targets.length > 0 && !submitting

  const submit = async (): Promise<void> => {
    if (!canSubmit) return
    setSubmitting(true)
    const ok = await onSubmit(targets[index]!)
    setSubmitting(false)
    if (!ok) return
  }

  return (
    <Modal
      open
      size="sm"
      title={t('config.settings.section.moveCvarDialog.title', { name: cvarName })}
      onClose={onClose}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" disabled={!canSubmit} onClick={() => void submit()}>
            {t('config.settings.section.moveCvarDialog.submit')}
          </Button>
        </>
      }
    >
      {targets.length === 0 ? (
        <p className="text-sm text-ink-muted">{t('config.settings.section.moveCvarDialog.empty')}</p>
      ) : (
        <Field label={t('config.settings.section.moveCvarDialog.targetLabel')}>
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
