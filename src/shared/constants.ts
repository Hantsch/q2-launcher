/**
 * Values shared by main, preload and renderer.
 *
 * Nothing in `src/shared` may import from `node:*`, `electron` or the DOM:
 * this folder is compiled into both the Node-flavoured and the browser-flavoured
 * TypeScript projects.
 */

/** File names of the launcher's own persisted state, inside `app.getPath('userData')`. */
export const STATE_FILE = 'state.json'
export const WINDOW_STATE_FILE = 'window-state.json'

/** Bumped whenever the shape of `state.json` changes; see `src/main/services/migrations.ts`. */
export const STATE_SCHEMA_VERSION = 2

/** Window sizing. The shell layout below ~940x620 starts to break down. */
export const WINDOW_DEFAULT_WIDTH = 1280
export const WINDOW_DEFAULT_HEIGHT = 800
export const WINDOW_MIN_WIDTH = 940
export const WINDOW_MIN_HEIGHT = 620

/** The canonical Quake II base game directory. */
export const BASE_GAME_DIR = 'baseq2'

/** Mission packs and the mods that ship with retail Quake II. */
export const KNOWN_GAME_DIRS = ['baseq2', 'xatrix', 'rogue', 'ctf'] as const

/** Directories that live next to the game dirs but are never mods themselves. */
export const NON_GAME_DIRS = new Set([
  'players',
  'save',
  'screenshots',
  'demos',
  'docs',
  'download',
  'downloads',
  'video',
  'music',
  'locs',
  'q2launcher',
  // The Steam build of Quake II ships the classic game in the install root and
  // the 2023 remaster in `rerelease/`. It is a whole second game, not a mod.
  'rerelease',
])

/**
 * Sizes of the retail pak files, for telling a full install apart from the
 * shareware demo without hashing 180 MB.
 *
 * A size match is strong evidence, not proof - the install/verify module will
 * add hashes later. Sourced from retail Quake II 3.20; Steam and GOG both ship
 * this same set.
 */
export const RETAIL_PAK_SIZES: Record<string, number> = {
  'pak0.pak': 183_997_730,
  'pak1.pak': 12_992_754,
  'pak2.pak': 45_055,
}

export const APP_REPO_URL = 'https://github.com/Hantsch/q2-launcher'
