import type { ComponentType } from 'react'
import type { ModuleId } from '@shared/types'
import { LibraryView } from '../views/LibraryView'
import { ConfigView } from './config/ConfigView'

/**
 * The renderer half of a module: the view that owns its route.
 *
 * A module listed here renders its own UI; anything declared in
 * `MODULE_MANIFESTS` but missing from this list falls back to
 * `PlannedModuleView`. That fallback is what lets the roadmap live in the
 * product without any dead links.
 */
export interface RendererModule {
  id: ModuleId
  View: ComponentType
}

export const RENDERER_MODULES: readonly RendererModule[] = [
  { id: 'library', View: LibraryView },
  // { id: 'downloads', View: DownloadsView },
  { id: 'config', View: ConfigView },
  // { id: 'mods',    View: ModsView },
  // { id: 'assets',  View: AssetsView },
]

export function rendererModule(id: ModuleId): RendererModule | undefined {
  return RENDERER_MODULES.find((module) => module.id === id)
}
