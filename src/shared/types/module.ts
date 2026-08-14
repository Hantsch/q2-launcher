/**
 * The module seam.
 *
 * Everything beyond the shell is a module: configuration management, downloading
 * and updating Quake II, game mods, asset packs. A module is described once here
 * (shared manifest), then registered twice - a service half in the main process
 * and a view half in the renderer - both keyed by `id`.
 *
 * Adding a module therefore never means editing the shell:
 *   1. add the id to `ModuleId`
 *   2. add a manifest to `MODULE_MANIFESTS`
 *   3. register a main-process service in `src/main/modules/index.ts`
 *   4. register a renderer view in `src/renderer/src/modules/index.ts`
 *   5. add its i18n keys
 */
export type ModuleId = 'library' | 'config' | 'install' | 'mods' | 'assets'

/**
 * What a module needs from the host. Declared up front so the shell can tell
 * the user what a module will do, and so the host can refuse to register a
 * module whose capabilities it cannot serve yet.
 */
export type ModuleCapability =
  /** Reads/writes files inside an installation. */
  | 'mutates-installation'
  /** Produces `Job`s (progress, cancel, queue). */
  | 'long-running-jobs'
  /** Downloads from the network. */
  | 'network'
  /** Contributes a cvar/settings schema to the config UI. */
  | 'cvar-schema'
  /** Needs to know when the game process starts/stops. */
  | 'game-lifecycle'

export type ModuleStatus =
  /** Implemented and usable. */
  | 'available'
  /** Visible in the shell, but the feature is not built yet. */
  | 'planned'

export interface ModuleManifest {
  id: ModuleId
  /** i18n keys - modules never carry prose. */
  titleKey: string
  descriptionKey: string
  /** `lucide-react` icon name; the renderer maps it to a component. */
  icon: string
  /** Route the module owns, e.g. `/config`. */
  route: string
  /** Where the module appears in the shell nav; `null` hides it. */
  nav: { section: 'primary' | 'secondary'; order: number } | null
  status: ModuleStatus
  capabilities: ModuleCapability[]
  /**
   * IPC channel prefix the module owns, e.g. `module:config`. The host asserts
   * that modules only register channels below their own namespace.
   */
  ipcNamespace: string
  /** Requires an active installation to be useful. */
  requiresInstallation: boolean
}

export const MODULE_MANIFESTS: readonly ModuleManifest[] = [
  {
    id: 'library',
    titleKey: 'module.library.title',
    descriptionKey: 'module.library.description',
    icon: 'LayoutGrid',
    route: '/library',
    nav: { section: 'primary', order: 10 },
    status: 'available',
    capabilities: [],
    ipcNamespace: 'module:library',
    requiresInstallation: false,
  },
  {
    id: 'install',
    titleKey: 'module.install.title',
    descriptionKey: 'module.install.description',
    icon: 'Download',
    route: '/install',
    nav: { section: 'primary', order: 20 },
    status: 'planned',
    capabilities: ['mutates-installation', 'long-running-jobs', 'network'],
    ipcNamespace: 'module:install',
    requiresInstallation: false,
  },
  {
    id: 'config',
    titleKey: 'module.config.title',
    descriptionKey: 'module.config.description',
    icon: 'SlidersHorizontal',
    route: '/config',
    nav: { section: 'primary', order: 30 },
    status: 'available',
    capabilities: ['mutates-installation', 'cvar-schema'],
    ipcNamespace: 'module:config',
    requiresInstallation: false,
  },
  {
    id: 'mods',
    titleKey: 'module.mods.title',
    descriptionKey: 'module.mods.description',
    icon: 'Boxes',
    route: '/mods',
    nav: { section: 'primary', order: 40 },
    status: 'planned',
    capabilities: ['mutates-installation', 'long-running-jobs', 'network', 'game-lifecycle'],
    ipcNamespace: 'module:mods',
    requiresInstallation: true,
  },
  {
    id: 'assets',
    titleKey: 'module.assets.title',
    descriptionKey: 'module.assets.description',
    icon: 'Images',
    route: '/assets',
    nav: { section: 'primary', order: 50 },
    status: 'planned',
    capabilities: ['mutates-installation', 'long-running-jobs', 'network'],
    ipcNamespace: 'module:assets',
    requiresInstallation: true,
  },
]

export function getModuleManifest(id: ModuleId): ModuleManifest | undefined {
  return MODULE_MANIFESTS.find((m) => m.id === id)
}

/** Fire-and-forget notification from a module's main-process half to the UI. */
export interface ModuleEvent<T = unknown> {
  moduleId: ModuleId
  type: string
  payload: T
}

/**
 * Request/response traffic for modules travels through one shell-owned channel
 * (`module:invoke`) rather than one channel per module, so the preload allowlist
 * stays fixed and a module can never widen the renderer's IPC surface.
 *
 * Each module ships its own typed client on top of this envelope.
 */
export interface ModuleInvokeRequest<T = unknown> {
  moduleId: ModuleId
  /** Handler name inside the module, e.g. `getCvars`. */
  type: string
  payload?: T
}
