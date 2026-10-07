import type { ConfigCvarSection } from '@shared/modules/config'
import { NameDialog } from '../../../components/ui/NameDialog'

/** Renames one cvar section. */
export function RenameCvarSectionDialog({
  section,
  onClose,
  onSubmit,
}: {
  section: ConfigCvarSection
  onClose: () => void
  onSubmit: (name: string) => Promise<boolean>
}) {
  return (
    <NameDialog
      titleKey="config.settings.section.renameDialog.title"
      labelKey="common.label.name"
      initialName={section.name}
      maxLength={120}
      onSubmit={onSubmit}
      onClose={onClose}
    />
  )
}
