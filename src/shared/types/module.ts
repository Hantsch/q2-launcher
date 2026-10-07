import { DEV_MODULES, DEV_MODULE_IDS } from '../dev-modules'

/**
 * The module seam.
 *
 * Everything beyond the shell is a module: configuration management, downloading
 * and updating Quake II, game mods, asset packs. A module is described once here
 * (shared manifest), then registered twice - a service half in the main process
 * and a view half in the renderer - both keyed by `id`.
 *
 * Adding a module never means editing the shell; the steps are in
 * docs/ARCHITECTURE.md#adding-a-module.
 */
export type ModuleId =
  'home' | 'library' | 'config' | 'downloads' | 'mods' | 'assets' | 'servers' | 'replays'

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
  /** i18n key for the plain-language intro paragraph on the planned-module screen. */
  plannedIntroKey?: string
  /** i18n keys for the plain-language "what you'll be able to do" bullets on the planned-module screen. */
  plannedHighlightKeys?: readonly string[]
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

const ALL_MODULE_MANIFESTS: readonly ModuleManifest[] = [
  {
    id: 'home',
    titleKey: 'common.label.home',
    descriptionKey: 'module.home.description',
    icon: 'Home',
    route: '/home',
    nav: null,
    status: 'available',
    // Story 082: the community news feed fetches over the network at startup and on demand.
    capabilities: ['network'],
    ipcNamespace: 'module:home',
    requiresInstallation: false,
  },
  {
    id: 'library',
    titleKey: 'common.label.library',
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
    id: 'downloads',
    titleKey: 'common.label.downloads',
    descriptionKey: 'module.downloads.description',
    plannedIntroKey: 'module.planned.downloads.intro',
    plannedHighlightKeys: [
      'module.planned.downloads.highlight.1',
      'module.planned.downloads.highlight.2',
      'module.planned.downloads.highlight.3',
    ],
    icon: 'Download',
    route: '/downloads',
    nav: { section: 'secondary', order: 10 },
    status: 'available',
    capabilities: ['mutates-installation', 'long-running-jobs', 'network'],
    ipcNamespace: 'module:downloads',
    requiresInstallation: false,
  },
  {
    id: 'config',
    titleKey: 'common.label.config',
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
    plannedIntroKey: 'module.planned.mods.intro',
    plannedHighlightKeys: [
      'module.planned.mods.highlight.1',
      'module.planned.mods.highlight.2',
      'module.planned.mods.highlight.3',
    ],
    icon: 'Boxes',
    route: '/mods',
    nav: { section: 'primary', order: 40 },
    status: 'available',
    capabilities: ['mutates-installation', 'long-running-jobs', 'network', 'game-lifecycle'],
    ipcNamespace: 'module:mods',
    requiresInstallation: true,
  },
  {
    id: 'assets',
    titleKey: 'module.assets.title',
    descriptionKey: 'module.assets.description',
    plannedIntroKey: 'module.planned.assets.intro',
    plannedHighlightKeys: [
      'module.planned.assets.highlight.1',
      'module.planned.assets.highlight.2',
      'module.planned.assets.highlight.3',
    ],
    icon: 'Images',
    route: '/assets',
    nav: { section: 'primary', order: 50 },
    status: 'planned',
    capabilities: ['mutates-installation', 'long-running-jobs', 'network'],
    ipcNamespace: 'module:assets',
    requiresInstallation: true,
  },
  {
    id: 'servers',
    titleKey: 'common.label.servers',
    descriptionKey: 'module.servers.description',
    plannedIntroKey: 'module.planned.servers.intro',
    plannedHighlightKeys: [
      'module.planned.servers.highlight.1',
      'module.planned.servers.highlight.2',
      'module.planned.servers.highlight.3',
    ],
    icon: 'Globe',
    route: '/servers',
    nav: { section: 'primary', order: 20 },
    status: 'available',
    capabilities: ['network', 'game-lifecycle'],
    ipcNamespace: 'module:servers',
    requiresInstallation: false,
  },
  {
    id: 'replays',
    titleKey: 'common.label.demos',
    descriptionKey: 'replays.module.description',
    plannedIntroKey: 'replays.planned.intro',
    plannedHighlightKeys: [
      'replays.planned.highlight.1',
      'replays.planned.highlight.2',
      'replays.planned.highlight.3',
    ],
    icon: 'Film',
    route: '/replays',
    nav: { section: 'primary', order: 25 },
    status: 'available',
    capabilities: ['mutates-installation', 'game-lifecycle'],
    ipcNamespace: 'module:replays',
    requiresInstallation: false,
  },
]

/** Every manifest this build ships: a release build drops the `DEV_MODULE_IDS` modules entirely. */
export const MODULE_MANIFESTS: readonly ModuleManifest[] = DEV_MODULES
  ? ALL_MODULE_MANIFESTS
  : ALL_MODULE_MANIFESTS.filter((manifest) => !DEV_MODULE_IDS.includes(manifest.id))

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
