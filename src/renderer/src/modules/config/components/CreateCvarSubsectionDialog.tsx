import { NameDialog } from '../../../components/ui/NameDialog'

/** Create-sub-section form: name only, one level below `CreateCvarSectionDialog`. */
export function CreateCvarSubsectionDialog({
  onClose,
  onSubmit,
}: {
  onClose: () => void
  onSubmit: (name: string) => Promise<boolean>
}) {
  return (
    <NameDialog
      titleKey="config.settings.section.subsection.createDialog.title"
      labelKey="common.label.name"
      submitLabelKey="config.settings.section.subsection.createDialog.submit"
      initialName=""
      maxLength={120}
      onSubmit={onSubmit}
      onClose={onClose}
    />
  )
}
