import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../../components/ui/Button'
import { Field, Select } from '../../../components/ui/controls'
import { Modal } from '../../../components/ui/Modal'
import type { EntryPlacementOption } from '../lib/entry-order'

/**
 * "Move to…" picker for one Controls row (story 054 D8), reached from the row's kebab menu
 * (`ControlsRowMenu`) - the keyboard path for a cross-category/cross-sub-category move now that
 * drag (story 054 D4/D5) is the mouse one. Mirrors `MoveCvarDialog.tsx`'s shape almost verbatim: a
 * `Select` naming every category and sub-category in profile order (`entryPlacementOptions`).
 */
export function MoveEntryDialog({
  entryName,
  targets,
  onClose,
  onSubmit,
}: {
  entryName: string
  /** Every category's own run, then each of its sub-categories, in profile order - see
   * `entryPlacementOptions`. Includes the entry's current placement, if any: picking it back is a
   * harmless no-op, and filtering it out would only complicate this list for no real benefit. */
  targets: EntryPlacementOption[]
  onClose: () => void
  onSubmit: (target: EntryPlacementOption) => Promise<boolean>
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
      title={t('config.controls.moveEntryDialog.title', { name: entryName })}
      onClose={onClose}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" disabled={!canSubmit} onClick={() => void submit()}>
            {t('config.controls.moveEntryDialog.submit')}
          </Button>
        </>
      }
    >
      {targets.length === 0 ? (
        <p className="text-sm text-ink-muted">{t('config.controls.moveEntryDialog.empty')}</p>
      ) : (
        <Field label={t('config.controls.moveEntryDialog.targetLabel')}>
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
