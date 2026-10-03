import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog'
import { Select } from '../../../components/ui/controls'
import { Radio, RadioGroup } from '../../../components/ui/RadioGroup'
import { useSubmitting } from '../../../components/ui/useSubmitting'
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
  const { submitting, run } = useSubmitting()

  const canSubmit = choice === 'delete' || (choice === 'move' && targetId !== undefined)

  const submit = (): void => {
    if (canSubmit) void run(() => onConfirm(choice, choice === 'move' ? targetId : undefined))
  }

  const targetLabel =
    choice === 'move' && targetId
      ? (otherCategories.find((category) => category.id === targetId)?.label ?? '')
      : ''

  return (
    <ConfirmDialog
      title={t('config.controls.deleteCategoryDialog.title', { name: categoryLabel })}
      confirmLabel={t('config.controls.deleteCategoryDialog.confirm')}
      tone="danger"
      busy={submitting}
      onConfirm={submit}
      onClose={onClose}
      body={
        <div className="space-y-4">
          {/* AC 9: states what happens to the entries, in words, for whichever choice is selected -
              not just for 'move': switching to 'delete' must update the sentence, not leave the
              'move' one showing. */}
          <p className="text-sm leading-relaxed text-ink-dim">
            {choice === 'move' && targetLabel
              ? t('config.controls.deleteCategoryDialog.bodyMove', {
                  count: entryCount,
                  target: targetLabel,
                })
              : t('config.controls.deleteCategoryDialog.bodyDelete', { count: entryCount })}
          </p>

          <RadioGroup
            name="delete-category-choice"
            label={t('config.controls.deleteCategoryDialog.choiceLabel')}
            value={choice}
            onChange={(value) => setChoice(value as DeleteCategoryChoice)}
          >
            {canMove && (
              <Radio value="move" label={t('config.controls.deleteCategoryDialog.choiceMove')} />
            )}
            <Radio value="delete" label={t('config.controls.deleteCategoryDialog.choiceDelete')} />
          </RadioGroup>

          {choice === 'move' && canMove && (
            <Select
              aria-label={t('config.controls.deleteCategoryDialog.targetLabel')}
              value={targetId}
              onChange={(event) => setTargetId(event.target.value)}
              options={otherCategories.map((category) => ({
                value: category.id,
                label: category.label,
              }))}
            />
          )}
        </div>
      }
    />
  )
}
