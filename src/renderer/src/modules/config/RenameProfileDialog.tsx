import type { ConfigProfile } from '@shared/modules/config'
import { NameDialog } from '../../components/ui/NameDialog'
import { renameConfigProfile } from './client'

/**
 * Renames a config profile. Module-local, like the rest of this module's
 * dialogs: props-based, no shell store, talks to the config client directly.
 */
export function RenameProfileDialog({
  profile,
  onClose,
  onRenamed,
}: {
  profile: ConfigProfile
  onClose: () => void
  /** The full, updated profile list, per the config module's rename contract. */
  onRenamed: (profiles: ConfigProfile[]) => void
}) {
  return (
    <NameDialog
      titleKey="config.renameDialog.title"
      labelKey="common.label.name"
      initialName={profile.name}
      maxLength={120}
      onClose={onClose}
      onSubmit={async (name) => {
        const result = await renameConfigProfile({ id: profile.id, name })
        if (result.ok) onRenamed(result.value)
      }}
    />
  )
}
