import { useInstallationById, useLauncher } from '../../store/useLauncher'
import { NameDialog } from '../ui/NameDialog'

export function RenameInstallationDialog({ installationId }: { installationId: string }) {
  const installation = useInstallationById(installationId)
  const closeDialog = useLauncher((state) => state.closeDialog)
  const updateInstallation = useLauncher((state) => state.updateInstallation)

  if (!installation) return null

  return (
    <NameDialog
      titleKey="dialog.rename.title"
      labelKey="common.label.name"
      initialName={installation.name}
      maxLength={120}
      onClose={closeDialog}
      onSubmit={async (name) => {
        const result = await updateInstallation({ id: installation.id, name })
        if (result.ok) closeDialog()
      }}
    />
  )
}
