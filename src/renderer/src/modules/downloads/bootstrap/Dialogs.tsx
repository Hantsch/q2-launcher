import { BootstrapWizard } from './BootstrapWizard'

/**
 * The downloads module's own dialog registry (story 074 D6), mounted by the shell's
 * `components/installations/Dialogs.tsx` through `RendererModule.Dialogs` - the shell never
 * imports `BootstrapWizard` directly, only this file, keyed by `view`.
 */
export function Dialogs({ view }: { view: string }) {
  if (view !== 'bootstrap-wizard') return null
  return <BootstrapWizard />
}
