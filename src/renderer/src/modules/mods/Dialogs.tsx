import { PlayWithDialog } from './components/PlayWithDialog'

/** The mods module's dialog registry, mounted through `RendererModule.Dialogs`. */
export function Dialogs({ view, installationId }: { view: string; installationId?: string }) {
  if (view === 'play-with') {
    return installationId ? <PlayWithDialog installationId={installationId} /> : null
  }
  return null
}
