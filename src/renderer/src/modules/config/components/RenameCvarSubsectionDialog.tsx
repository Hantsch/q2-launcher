import type { ConfigCvarSubsection } from '@shared/modules/config'
import { NameDialog } from '../../../components/ui/NameDialog'

/** Renames one cvar sub-section. */
export function RenameCvarSubsectionDialog({
  subsection,
  onClose,
  onSubmit,
}: {
  subsection: ConfigCvarSubsection
  onClose: () => void
  onSubmit: (name: string) => Promise<boolean>
}) {
  return (
    <NameDialog
      titleKey="config.settings.section.subsection.renameDialog.title"
      labelKey="common.label.name"
      initialName={subsection.name}
      maxLength={120}
      onSubmit={onSubmit}
      onClose={onClose}
    />
  )
}
