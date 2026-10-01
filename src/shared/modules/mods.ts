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
