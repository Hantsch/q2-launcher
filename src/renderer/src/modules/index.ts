import type { ComponentType } from 'react'
import type { ModuleId } from '@shared/types'
import { LibraryView } from '../views/LibraryView'
import { ConfigView } from './config/ConfigView'
import { Dialogs as DownloadsBootstrapDialogs } from './downloads/bootstrap/Dialogs'
import { DownloadsSettingsSection } from './downloads/DownloadsSettingsSection'
import { DownloadsView } from './downloads/DownloadsView'
import { HomeView } from './home/HomeView'
import { Dialogs as ModsDialogs } from './mods/Dialogs'
import { ModsView } from './mods/ModsView'
import { ReplaysSettingsSection } from './replays/ReplaysSettingsSection'
import { ReplaysView } from './replays/ReplaysView'
import { ServersSettingsSection } from './servers/ServersSettingsSection'
import { ServersView } from './servers/ServersView'

/**
 * The renderer half of a module: the view that owns its route. `RENDERER_MODULES` below is the one
 * registry the shell reads (through `rendererModule(id)`), so the shell never imports a module's
 * components itself, including the home route.
 *
 * A module listed here renders its own UI; anything declared in
 * `MODULE_MANIFESTS` but missing from this list, or listed here without a
 * `View`, falls back to `PlannedModuleView`. That fallback is what lets the
 * roadmap live in the product without any dead links. An unknown route resolves through here too.
 *
 * A module can also contribute a section to the Settings view without owning
 * a route at all - `settingsSection` lets it add its own controls there
 * (e.g. downloads' concurrency/cache settings) while `View` stays undefined
 * until the module earns a real tab. The shell wraps the section in its own
 * `Panel` + `SectionLabel` chrome; the module supplies only the inner content.
 */
export interface RendererModule {
  id: ModuleId
  View?: ComponentType
  settingsSection?: {
    titleKey: string
    /** Optional one-line summary shown under the section title. */
    descriptionKey?: string
    order: number
    Section: ComponentType
  }
  /**
   * Story 074: lets a module own a modal without the shell importing that module's component.
   * The shell mounts this when `store.dialog` is `{ kind: 'module', moduleId, view }` for this
   * module's id, passing `view` straight through - the module interprets its own `view` strings to
   * tell its modals apart (a module with only one modal can ignore the value).
   *
   * Story 090: `installationId` is ferried through the same way, whenever `store.dialog` carries
   * one - `undefined` for a module dialog that opened without one (e.g. `'bootstrap-wizard'`).
   */
  Dialogs?: ComponentType<{ view: string; installationId?: string }>
}

export const RENDERER_MODULES: readonly RendererModule[] = [
  // Story 081: the home route is a module route like any other - the shell no longer
  // knows what is on it, and resolves it (and the unknown-route fallback) through here.
  { id: 'home', View: HomeView },
  { id: 'library', View: LibraryView },
  {
    id: 'downloads',
    // Story 073: the real route, replacing `PlannedModuleView`. `MODULE_MANIFESTS`'
    // `downloads` status flips to `available` alongside this.
    View: DownloadsView,
    settingsSection: {
      titleKey: 'common.label.downloads',
      descriptionKey: 'module.downloads.settings.description',
      order: 10,
      Section: DownloadsSettingsSection,
    },
    // Story 074: the bootstrap wizard, opened from the "New installation…" entry of the Library's and the rail's add menu.
    Dialogs: DownloadsBootstrapDialogs,
  },
  { id: 'config', View: ConfigView },
  {
    id: 'servers',
    View: ServersView,
    settingsSection: {
      titleKey: 'common.label.servers',
      descriptionKey: 'module.servers.settings.description',
      order: 20,
      Section: ServersSettingsSection,
    },
  },
  { id: 'mods', View: ModsView, Dialogs: ModsDialogs },
  // { id: 'assets',  View: AssetsView },
  {
    // Story 141: `ReplaysView` replaces the `PlannedModuleView` fallback (`MODULE_MANIFESTS`'s
    // `replays` entry status is now `'available'`).
    id: 'replays',
    View: ReplaysView,
    settingsSection: {
      titleKey: 'common.label.demos',
      descriptionKey: 'replays.settings.description',
      order: 25,
      Section: ReplaysSettingsSection,
    },
  },
]

export function rendererModule(id: ModuleId): RendererModule | undefined {
  return RENDERER_MODULES.find((module) => module.id === id)
}
