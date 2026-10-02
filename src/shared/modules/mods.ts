import type { EngineKind } from '../types/engine'

/**
 * The mods module's contract.
 *
 * Main implements the handlers, the renderer gets a typed client, and this file
 * is the only thing they share. The renderer never sends a path: it names an
 * installation and a game directory, main resolves the folder.
 */
export const MODS_HANDLERS = {
  list: 'list',
  reveal: 'reveal',
  catalogGet: 'catalog.get',
  /** Story 190: start installing one catalog mod. Resolves to `Outcome<{ jobId }>` once the job exists. */
  install: 'install',
  /** Story 190: answers a pending `installDecision`. Resolves to `Outcome<null>`. */
  resolveInstall: 'install.resolve',
  /** Story 191: what removing a mod would touch. Resolves to `Outcome<ModRemovalPreview>`; deletes nothing. */
  removalPreview: 'removal.preview',
  /** Story 191: start removing a mod the launcher installed. Resolves to `Outcome<{ jobId }>`. */
  remove: 'remove',
  /** Story 192: does the installation have a server's map? Resolves to `Outcome<ModMapPresence>`. */
  mapPresence: 'map.presence',
  /** Story 194: what updating a mod would touch. Resolves to `Outcome<ModUpdatePreview>`; writes nothing. */
  updatePreview: 'update.preview',
  /** Story 194: start updating a catalog mod to its pinned version. Resolves to `Outcome<{ jobId }>`. */
  update: 'update',
} as const

/** What `updatePreview` answers: names and versions for the confirm dialog and the recorded files the user changed. */
export interface ModUpdatePreview {
  installationName: string
  modName: string
  gameDir: string
  installedVersion: string
  targetVersion: string
  /** Gamedir-relative paths of recorded files whose bytes differ from what the launcher installed. */
  changedFiles: string[]
}

/** What happens to a recorded file the user changed since it was installed. */
export type ModUpdateChangedPolicy = 'overwrite' | 'keep'

/** What `mapPresence` answers: whether `maps/<map>.bsp` exists loose, in a pak or in a pkz. */
export interface ModMapPresence {
  available: boolean
}

/** What `removalPreview` answers: names for the confirm dialog and the recorded files the user changed. */
export interface ModRemovalPreview {
  installationName: string
  modName: string
  gameDir: string
  /** Gamedir-relative paths of recorded files whose bytes differ from what the launcher installed. */
  changedFiles: string[]
}

export type ModRemoveChangedFiles = 'delete' | 'keep'

/** Story 190: main -> renderer pushes of this module, delivered through the module event channel. */
export const MODS_EVENTS = {
  /** A `ModInstallDecisionEvent` - an install met a folder it did not create and waits for a choice. */
  installDecision: 'install.decision',
} as const

export type ModInstallChoice = 'overwrite' | 'keep' | 'cancel'

export interface ModInstallDecisionEvent {
  jobId: string
  installationId: string
  catalogId: string
  /** The existing folder's own name. */
  folder: string
  /** Gamedir-relative paths of existing files whose bytes differ. May be empty. */
  conflicts: string[]
}

export interface ModActiveInstall {
  catalogId: string
  jobId: string
  /** Present while the install waits for the user's choice. */
  decision?: { folder: string; conflicts: string[] }
}

/** `catalog` = the launcher installed it (an install record exists); `manual` = anything else. */
export type ModGameDirOrigin = 'manual' | 'catalog'

export interface ModGameDir {
  /** The game directory's folder name, e.g. `rogue`. Never `baseq2`. */
  gameDir: string
  /** Absolute folder under the installation root. */
  folderPath: string
  origin: ModGameDirOrigin
  /** From the install record; present only when the launcher has a parsable record for it. */
  catalogId?: string
  version?: string
  contentOnly?: boolean
  engineKind?: EngineKind
  arch?: 'x86' | 'x64' | 'arm64' | 'unknown'
  pkzUnsupported?: boolean
  /**
   * Story 194: `update-available` when the catalog's pinned version differs from the recorded one (a
   * catalog install only). Replaces plain "installed"; `contentOnly` stays so the renderer can still
   * show the content-only reason.
   */
  status?: 'update-available'
  installedVersion?: string
  pinnedVersion?: string
}

export interface ModsListResult {
  installationId: string
  gameDirs: ModGameDir[]
  /** Installs running right now for this installation. */
  activeInstalls: ModActiveInstall[]
}

/** One selectable version of a catalog mod, as the renderer sees it (no packages, no URLs). */
export interface ModCatalogVersion {
  version: string
  prerelease: boolean
}

/** One catalog mod, projected for the wire: variants and packages stay in main. */
export interface ModCatalogEntry {
  id: string
  gamedir: string
  name: string
  description: string
  license: string
  projectUrl: string
  sourceUrl: string
  /** The `version` selected by default; always one of `versions`. */
  pinned: string
  versions: ModCatalogVersion[]
}

export type ModCatalogState =
  | {
      status: 'ok'
      entries: ModCatalogEntry[]
      fetchedAt: string
      fromCache: boolean
      ageMs: number
    }
  | { status: 'unavailable' }

/** One file a mod install wrote, recorded for later verify/uninstall. */
export interface ModInstallFile {
  /** Relative to the game directory, forward slashes. */
  path: string
  sizeBytes: number
  sha256: string
}

/** The launcher's record of one catalog mod install (`moduleData.mods.records[]`). */
export interface ModInstallRecord {
  catalogId: string
  /** The game directory's folder name, e.g. `rogue`. */
  gameDir: string
  version: string
  variantId: string
  engineKind: EngineKind
  arch: 'x86' | 'x64' | 'arm64' | 'unknown'
  platform: 'win32' | 'linux'
  /** True when the mod is content only (no native game library written). */
  contentOnly: boolean
  /** True when an r1q2-family engine got a `.pkz` file it cannot read. */
  pkzUnsupported?: boolean
  /** Epoch ms. */
  installedAt: number
  files: ModInstallFile[]
}

/** Every `mods.error.*` key the mods module sends across IPC or reports on a job - closed, so each one resolves in the locale. */
export const MODS_ERROR_KEYS = [
  'mods.error.installationNotFound',
  'mods.error.gameDirNotFound',
  'mods.error.revealFailed',
  'mods.error.unknownMod',
  'mods.error.alreadyInstalled',
  'mods.error.noVariant',
  'mods.error.badPackage',
  'mods.error.writeFailed',
  'mods.error.noPendingDecision',
  'mods.error.diskWrite',
] as const

export type ModsErrorKey = (typeof MODS_ERROR_KEYS)[number]
