import { constants as FS } from 'node:fs'
import { copyFile } from 'node:fs/promises'
import { pathExists } from '../../lib/fs-utils'

/**
 * Shared backup-once contract for the config module: both `writer.ts` (saving
 * a profile) and `cleanup.ts` (deleting a redundant mod-folder cfg) need the
 * exact same "copy the user's own file aside, exactly once, ever" behavior,
 * so it lives here once rather than being duplicated or one importing from
 * the other.
 */

/** Suffix of the one-time copy of a user's own file. */
export const BACKUP_SUFFIX = '.q2l-backup'

/**
 * Copies `filePath` aside, unless a backup is already there. The existing
 * backup always wins: it holds what the user originally wrote, while the
 * current file at this point is our own output from a previous save.
 */
export async function backupOnce(filePath: string): Promise<void> {
  const backupPath = `${filePath}${BACKUP_SUFFIX}`
  if (await pathExists(backupPath)) return
  try {
    // COPYFILE_EXCL rather than a plain copy: even if something created the
    // backup between the check above and here, the original is not clobbered.
    await copyFile(filePath, backupPath, FS.COPYFILE_EXCL)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
}
