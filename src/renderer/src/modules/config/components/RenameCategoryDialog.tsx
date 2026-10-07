import type { ConfigActionCategory } from '@shared/modules/config'
import { NameDialog } from '../../../components/ui/NameDialog'

/** Renames one custom category. Mirrors `RenameProfileDialog`'s shape. */
export function RenameCategoryDialog({
  category,
  onClose,
  onSubmit,
}: {
  category: ConfigActionCategory
  onClose: () => void
  onSubmit: (name: string) => Promise<boolean>
}) {
  return (
    <NameDialog
      titleKey="config.controls.renameDialog.title"
      labelKey="common.label.name"
      initialName={category.name}
      maxLength={120}
      onClose={onClose}
      onSubmit={onSubmit}
    />
  )
}
