import { stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import type { ExtraFoldersResult, ReplaysExtraFolder } from '@shared/modules/replays'
import { canonicalizePath, pathKey } from '../../lib/fs-utils'

export type ResolvedExtraFolder =
  | { ok: true; canonical: string }
  | { ok: false; reason: 'notAbsolute' | 'unresolvable' | 'notAFolder' }

/**
 * Story 142 D2: validates a user-picked extra demo folder. This is the one place a
 * renderer-supplied path is ever trusted (CLAUDE.md's own documented exception, mirrored in
 * `REPLAYS_PATH_PAYLOAD_HANDLERS`'s doc comment) - and even here it is never taken at face value.
 * Four checks, split across this function (1-3, async) and `appendExtraFolder` (4, pure):
 *
 * 1. `isAbsolute(rawPath)` - a relative path (or anything a native dialog could never have
 *    produced) is refused before anything touches the filesystem.
 * 2. `stat(rawPath)` - a path that does not resolve to anything at all (ENOENT, or any other stat
 *    failure) is `'unresolvable'`; a path that resolves but is not a directory (a file) is
 *    `'notAFolder'`. Read-only - never writes, deletes or renames anything.
 * 3. `canonicalizePath` - resolves symlinks/junctions/`..` the same way installation roots are
 *    deduplicated, so the stored path is the real one, not whatever spelling the dialog handed
 *    back.
 * 4. `pathKey` dedupe against every already-listed folder (`appendExtraFolder`) - the same
 *    case-insensitive-on-Windows/macOS, trailing-separator-collapsing comparison installations
 *    use. It runs on the live list after the awaits above, so a concurrent change is seen.
 */
export async function resolveExtraFolder(rawPath: string): Promise<ResolvedExtraFolder> {
  if (!isAbsolute(rawPath)) return { ok: false, reason: 'notAbsolute' }

  let stats
  try {
    stats = await stat(rawPath)
  } catch {
    return { ok: false, reason: 'unresolvable' }
  }
  if (!stats.isDirectory()) return { ok: false, reason: 'notAFolder' }

  return { ok: true, canonical: await canonicalizePath(rawPath) }
}

/**
 * Appends an already-resolved folder (check 4 above). Returns a fresh `folders` array (never
 * mutates `current`), or `'alreadyListed'` when the folder is on the list under any spelling.
 */
export function appendExtraFolder(
  current: ReplaysExtraFolder[],
  canonical: string,
  now: string,
  id: string,
): ExtraFoldersResult {
  const key = pathKey(canonical)
  if (current.some((row) => pathKey(row.path) === key)) {
    return { ok: false, reason: 'alreadyListed' }
  }
  return { ok: true, folders: [...current, { id, path: canonical, addedAt: now }] }
}

/**
 * Removes an extra demo folder by id. A pure list filter - it never touches disk, so removing an
 * entry never deletes, renames or otherwise affects the folder's actual files. An unknown id is a
 * no-op.
 */
export function removeExtraFolder(current: ReplaysExtraFolder[], id: string): ReplaysExtraFolder[] {
  return current.filter((row) => row.id !== id)
}
