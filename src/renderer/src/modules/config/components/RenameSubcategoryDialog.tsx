import type { ConfigActionSubcategory } from '@shared/modules/config'
import { NameDialog } from '../../../components/ui/NameDialog'

/** Renames one sub-category. Mirrors `RenameCategoryDialog`'s shape one level down. */
export function RenameSubcategoryDialog({
  subcategory,
  onClose,
  onSubmit,
}: {
  subcategory: ConfigActionSubcategory
  onClose: () => void
  onSubmit: (name: string) => Promise<boolean>
}) {
  return (
    <NameDialog
      titleKey="config.controls.subcategory.renameDialog.title"
      labelKey="common.label.name"
      initialName={subcategory.name}
      maxLength={120}
      onClose={onClose}
      onSubmit={onSubmit}
    />
  )
}
