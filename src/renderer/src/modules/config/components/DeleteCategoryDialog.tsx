import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../../components/ui/Button'
import { Select } from '../../../components/ui/controls'
import { Modal } from '../../../components/ui/Modal'
import type { DeleteCategoryChoice } from '../lib/delete-category'

/**
 * Deletion confirmation for a category that has entries (story 052 D9, mirroring
 * `DeleteProfileDialog.tsx`'s shape: title, body stating consequences, confirm/cancel). Unlike that
 * dialog's plain yes/no, deleting a category is a real choice - the story's own decision is "offer
 * both delete and move in the confirm dialog, default 'move'" - so this renders a radio pair
 * (defaulting to 'move') plus, only while 'move' is selected, a `Select` naming the profile's other
 * categories.
 *
 * A category with no entries never reaches this dialog: `ControlsTab` keeps its existing simple
 * inline confirm for that case (there is nothing to move, and forcing the choice on an empty
 * category would be pointless per the story's own explicit judgement-call note). This component
 * itself does not persist anything - like every other Controls dialog, it hands the decision back
 * to `ControlsTab`, the single owner of `persistCategoriesAndActions`.
 */
export function DeleteCategoryDialog({
  categoryLabel,
  entryCount,
  otherCategories,
  onClose,
  onConfirm,
}: {
  categoryLabel: string
  entryCount: number
  /** The profile's remaining categories once this one is gone - the possible move targets. Empty
   * when this is the profile's only category, in which case 'move' is not offered as a choice at
   * all (there is nowhere to move entries to). */
  otherCategories: { id: string; label: string }[]
  onClose: () => void
  onConfirm: (choice: DeleteCategoryChoice, targetCategoryId?: string) => Promise<void> | void
}) {
  const { t } = useTranslation()
  const canMove = otherCategories.length > 0
  const [choice, setChoice] = useState<DeleteCategoryChoice>(canMove ? 'move' : 'delete')
  const [targetId, setTargetId] = useState<string | undefined>(otherCategories[0]?.id)
  const [submitting, setSubmitting] = useState(false)

  const canSubmit =
    !submitting && (choice === 'delete' || (choice === 'move' && targetId !== undefined))

  const submit = async (): Promise<void> => {
    if (!canSubmit) return
    setSubmitting(true)
    await onConfirm(choice, choice === 'move' ? targetId : undefined)
    setSubmitting(false)
  }

  const targetLabel =
    choice === 'move' && targetId
      ? (otherCategories.find((category) => category.id === targetId)?.label ?? '')
      : ''

  return (
    <Modal
      open
      size="sm"
      title={t('config.controls.deleteCategoryDialog.title', { name: categoryLabel })}
      onClose={onClose}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" disabled={!canSubmit} onClick={() => void submit()}>
            {t('config.controls.deleteCategoryDialog.confirm')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* AC 9: states what happens to the entries, in words, for whichever choice is selected -
            not just for 'move' (review-worth: a reader who only ever sees the default should still
            get an accurate sentence, and switching to 'delete' must update it, not leave the 'move'
            sentence showing). */}
        <p className="text-sm leading-relaxed text-ink-dim">
          {choice === 'move' && targetLabel
            ? t('config.controls.deleteCategoryDialog.bodyMove', {
                count: entryCount,
                target: targetLabel,
              })
            : t('config.controls.deleteCategoryDialog.bodyDelete', { count: entryCount })}
        </p>

        <div className="space-y-2 text-sm text-ink">
          {canMove && (
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                name="delete-category-choice"
                className="accent-flame-500"
                checked={choice === 'move'}
                onChange={() => setChoice('move')}
              />
              {t('config.controls.deleteCategoryDialog.choiceMove')}
            </label>
          )}
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="radio"
              name="delete-category-choice"
              className="accent-flame-500"
              checked={choice === 'delete'}
              onChange={() => setChoice('delete')}
            />
            {t('config.controls.deleteCategoryDialog.choiceDelete')}
          </label>
        </div>

        {choice === 'move' && canMove && (
          <Select
            aria-label={t('config.controls.deleteCategoryDialog.targetLabel')}
            value={targetId}
            onChange={(event) => setTargetId(event.target.value)}
            options={otherCategories.map((category) => ({ value: category.id, label: category.label }))}
          />
        )}
      </div>
    </Modal>
  )
}
