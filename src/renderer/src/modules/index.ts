import type { ComponentType } from 'react'
import type { ModuleId } from '@shared/types'
import { LibraryView } from '../views/LibraryView'
import { ConfigView } from './config/ConfigView'
import { DownloadsSettingsSection } from './downloads/DownloadsSettingsSection'

/**
 * The renderer half of a module: the view that owns its route.
 *
 * A module listed here renders its own UI; anything declared in
 * `MODULE_MANIFESTS` but missing from this list, or listed here without a
 * `View`, falls back to `PlannedModuleView`. That fallback is what lets the
 * roadmap live in the product without any dead links.
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
    order: number
    Section: ComponentType
  }
}

export const RENDERER_MODULES: readonly RendererModule[] = [
  { id: 'library', View: LibraryView },
  {
    id: 'downloads',
    // No `View` yet - `MODULE_MANIFESTS`' `downloads` status stays `planned` until [[073]]
    // fills the route in; this story only gives the module a Settings section (AC1/AC2).
    settingsSection: {
      titleKey: 'module.downloads.settings.title',
      order: 10,
      Section: DownloadsSettingsSection,
    },
  },
  { id: 'config', View: ConfigView },
  // { id: 'mods',    View: ModsView },
  // { id: 'assets',  View: AssetsView },
]

export function rendererModule(id: ModuleId): RendererModule | undefined {
  return RENDERER_MODULES.find((module) => module.id === id)
}
