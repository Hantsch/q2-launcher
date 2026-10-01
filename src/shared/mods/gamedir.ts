/**
 * The one rule for what a mod game directory may be called. A game directory is a single folder
 * name under an installation root, so anything that could escape that root or collide with the
 * base game is refused: path separators, `.`/`..`, non-ASCII, and `baseq2` itself.
 *
 * Shared (no node/DOM/electron) so the catalog parser and any renderer-side hint use one rule.
 */
const GAMEDIR_SHAPE = /^[A-Za-z0-9_.-]{1,64}$/

export function isSafeGameDirName(name: unknown): name is string {
  if (typeof name !== 'string') return false
  if (!GAMEDIR_SHAPE.test(name)) return false
  if (name === '.' || name === '..') return false
  return name.toLowerCase() !== 'baseq2'
}
