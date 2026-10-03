import { NameDialog } from '../../../components/ui/NameDialog'

/** Create-sub-category form: name only - a sub-category has no template suggestions to offer,
 * unlike `CreateCategoryDialog`. */
export function CreateSubcategoryDialog({
  onClose,
  onSubmit,
}: {
  onClose: () => void
  onSubmit: (name: string) => Promise<boolean>
}) {
  return (
    <NameDialog
      titleKey="config.controls.subcategory.createDialog.title"
      labelKey="config.controls.subcategory.createDialog.nameLabel"
      submitLabelKey="config.controls.subcategory.createDialog.submit"
      initialName=""
      maxLength={120}
      onClose={onClose}
      onSubmit={onSubmit}
    />
  )
}
