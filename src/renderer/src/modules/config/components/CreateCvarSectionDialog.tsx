import { NameDialog } from '../../../components/ui/NameDialog'

/** Create-section form: name only - a cvar section has no template suggestions to offer. */
export function CreateCvarSectionDialog({
  onClose,
  onSubmit,
}: {
  onClose: () => void
  onSubmit: (name: string) => Promise<boolean>
}) {
  return (
    <NameDialog
      titleKey="config.settings.section.createDialog.title"
      labelKey="config.settings.section.createDialog.nameLabel"
      submitLabelKey="config.settings.section.createDialog.submit"
      initialName=""
      maxLength={120}
      onSubmit={onSubmit}
      onClose={onClose}
    />
  )
}
