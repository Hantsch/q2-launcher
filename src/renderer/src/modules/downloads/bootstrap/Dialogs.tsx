import { BootstrapWizard } from './BootstrapWizard'
import { RetailUpgradeDialog } from '../retail/RetailUpgradeDialog'

/**
 * The downloads module's own dialog registry (story 074 D6), mounted by the shell's
 * `components/installations/Dialogs.tsx` through `RendererModule.Dialogs` - the shell never
 * imports `BootstrapWizard` directly, only this file, keyed by `view`.
 *
 * Story 090 D3 adds `'retail-upgrade'`, the demo-to-retail upgrade dialog - scoped to one
 * installation, so it needs the `installationId` the shell now ferries alongside `view`
 * (`DialogState`'s `module` kind, `store/useLauncher.ts`). A dialog opened for that view without
 * an id would be a caller bug (D4's trigger buttons are the only intended caller), so this renders
 * nothing rather than guessing - same defensive shape as the `view` mismatch below.
 */
export function Dialogs({ view, installationId }: { view: string; installationId?: string }) {
  if (view === 'bootstrap-wizard') return <BootstrapWizard />
  if (view === 'retail-upgrade') {
    return installationId ? <RetailUpgradeDialog installationId={installationId} /> : null
  }
  return null
}
