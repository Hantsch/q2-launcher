import { stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import type { ExtraFoldersResult, ReplaysExtraFolder } from '@shared/modules/replays'
import { canonicalizePath, pathKey } from '../../lib/fs-utils'

/**
 * Story 142 D2: validates and appends a user-picked extra demo folder. This is the one place a
 * renderer-supplied path is ever trusted (CLAUDE.md's own documented exception, mirrored in
 * `REPLAYS_PATH_PAYLOAD_HANDLERS`'s doc comment) - and even here it is never taken at face value:
 *
 * 1. `isAbsolute(rawPath)` - a relative path (or anything a native dialog could never have
 *    produced) is refused before anything touches the filesystem.
 * 2. `stat(rawPath)` - a path that does not resolve to anything at all (ENOENT, or any other stat
 *    failure) is `'unresolvable'`; a path that resolves but is not a directory (a file) is
 *    `'notAFolder'`. Read-only - never writes, deletes or renames anything.
 * 3. `canonicalizePath` - resolves symlinks/junctions/`..` the same way installation roots are
 *    deduplicated, so the stored path is the real one, not whatever spelling the dialog handed
 *    back.
 * 4. `pathKey` dedupe against every already-listed folder - the same case-insensitive-on-
 *    Windows/macOS, trailing-separator-collapsing comparison installations use, so the same
 *    folder added twice under a different spelling is still caught.
 *
 * Returns a fresh `folders` array (never mutates `current`) on success, or `{ ok: false, reason }`
 * on the first check that fails - the caller (`replays/index.ts`) never persists on a refusal.
 */
export async function addExtraFolder(
  current: ReplaysExtraFolder[],
  rawPath: string,
  now: string,
  newId: string,
): Promise<ExtraFoldersResult> {
  if (!isAbsolute(rawPath)) return { ok: false, reason: 'notAbsolute' }

  let stats
  try {
    stats = await stat(rawPath)
  } catch {
    return { ok: false, reason: 'unresolvable' }
  }
  if (!stats.isDirectory()) return { ok: false, reason: 'notAFolder' }

  const canonical = await canonicalizePath(rawPath)
  const key = pathKey(canonical)
  if (current.some((row) => pathKey(row.path) === key)) {
    return { ok: false, reason: 'alreadyListed' }
  }

  const folder: ReplaysExtraFolder = { id: newId, path: canonical, addedAt: now }
  return { ok: true, folders: [...current, folder] }
}

/**
 * Removes an extra demo folder by id. A pure list filter - it never touches disk, so removing an
 * entry never deletes, renames or otherwise affects the folder's actual files. An unknown id is a
 * no-op.
 */
export function removeExtraFolder(current: ReplaysExtraFolder[], id: string): ReplaysExtraFolder[] {
  return current.filter((row) => row.id !== id)
}
