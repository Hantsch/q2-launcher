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
} as const

/** `catalog` = the launcher installed it (an install record exists); `manual` = anything else. */
export type ModGameDirOrigin = 'manual' | 'catalog'

export interface ModGameDir {
  /** The game directory's folder name, e.g. `rogue`. Never `baseq2`. */
  gameDir: string
  /** Absolute folder under the installation root. */
  folderPath: string
  origin: ModGameDirOrigin
}

export interface ModsListResult {
  installationId: string
  gameDirs: ModGameDir[]
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
