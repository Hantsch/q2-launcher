import { useLauncher } from '../../store/useLauncher'
import { AddExistingDialog } from './AddExistingDialog'
import { CleanupConfigCopiesDialog } from './CleanupConfigCopiesDialog'
import { CreateInstallationDialog } from './CreateInstallationDialog'
import { DetectDialog } from './DetectDialog'
import { RemoveInstallationDialog } from './RemoveInstallationDialog'
import { RenameInstallationDialog } from './RenameInstallationDialog'

/**
 * Single mounting point for every modal, driven by `store.dialog`.
 *
 * One dialog at a time by construction: there is no way to end up with two
 * stacked modals, and any component can open one without prop-drilling.
 */
export function Dialogs() {
  const dialog = useLauncher((state) => state.dialog)

  switch (dialog.kind) {
    case 'add-existing':
      return <AddExistingDialog />
    case 'detect':
      return <DetectDialog {...(dialog.autoStart ? { autoStart: true } : {})} />
    case 'create':
      return <CreateInstallationDialog />
    case 'remove':
      return <RemoveInstallationDialog installationId={dialog.installationId} />
    case 'rename':
      return <RenameInstallationDialog installationId={dialog.installationId} />
    case 'cleanup':
      return <CleanupConfigCopiesDialog installationId={dialog.installationId} />
    case 'none':
      return null
  }
}
