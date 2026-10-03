import { useTranslation } from 'react-i18next'
import { TEMPLATE_ACTION_CATEGORIES } from '@shared/modules/config'
import { Field } from '../../../components/ui/controls'
import { NameDialog } from '../../../components/ui/NameDialog'
import { useSubmitting } from '../../../components/ui/useSubmitting'

/**
 * Create-category form: name, plus a suggestions list offering the template's own three categories
 * next to the blank/free-form field. `existingCategoryIds` filters out a template category the
 * profile already has - its fixed id (`movement`/`weapons`/`drops`) cannot be created twice, so
 * offering it again would either collide or silently do nothing.
 */
export function CreateCategoryDialog({
  existingCategoryIds,
  onClose,
  onSubmit,
}: {
  existingCategoryIds: readonly string[]
  onClose: () => void
  onSubmit: (input: { name: string; templateId?: string }) => Promise<boolean>
}) {
  const { t } = useTranslation()
  // One in-flight gate for both paths: a template pick and the name submit never run together.
  const template = useSubmitting()

  const suggestions = TEMPLATE_ACTION_CATEGORIES.filter(
    (category) => !existingCategoryIds.includes(category.id),
  )

  return (
    <NameDialog
      titleKey="config.controls.createDialog.title"
      labelKey="config.controls.createDialog.nameLabel"
      submitLabelKey="config.controls.createDialog.submit"
      initialName=""
      maxLength={120}
      onClose={onClose}
      onSubmit={(name) => template.run(() => onSubmit({ name }))}
    >
      {suggestions.length > 0 && (
        <Field label={t('config.controls.createDialog.suggestions.label')}>
          <div className="space-y-0.5 rounded-sm border border-line">
            {suggestions.map((category) => (
              <button
                key={category.id}
                type="button"
                disabled={template.submitting}
                onClick={() =>
                  void template.run(() => onSubmit({ name: '', templateId: category.id }))
                }
                className="flex w-full items-center px-2.5 py-1.5 text-left text-xs text-ink transition-colors duration-[--dur-fast] hover:bg-hover disabled:opacity-50"
              >
                {t(category.labelKey)}
              </button>
            ))}
          </div>
        </Field>
      )}
    </NameDialog>
  )
}
