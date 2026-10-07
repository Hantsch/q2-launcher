import { constants } from 'node:fs'
import { copyFile, link, stat, unlink, utimes } from 'node:fs/promises'

/**
 * The fallible file steps the demo rename, move and delete services share, each behind an injected
 * fs seam so a test can make exactly one call fail.
 */

export function errnoCode(err: unknown): string | undefined {
  const code = (err as NodeJS.ErrnoException | null)?.code
  return typeof code === 'string' ? code : undefined
}

// Not fs-utils' pathExists: goes through the injected seam so tests can fake the filesystem.
export async function exists(
  fs: { stat: (path: string) => Promise<unknown> },
  path: string,
): Promise<boolean> {
  try {
    await fs.stat(path)
    return true
  } catch {
    return false
  }
}

export interface NoOverwriteFs {
  stat: (path: string) => Promise<{ atimeMs: number; mtimeMs: number }>
  link: (existing: string, newPath: string) => Promise<void>
  unlink: (path: string) => Promise<void>
  /** Called with `COPYFILE_EXCL`: rejects with EEXIST instead of replacing `to`. */
  copyFile: (from: string, to: string, mode: number) => Promise<void>
  /** Seconds, the way `fs.utimes` takes a number. */
  utimes: (path: string, atime: number, mtime: number) => Promise<void>
}

export const nodeNoOverwriteFs: NoOverwriteFs = {
  stat: (path) => stat(path),
  link: (existing, newPath) => link(existing, newPath),
  unlink: (path) => unlink(path),
  copyFile: (from, to, mode) => copyFile(from, to, mode),
  utimes: (path, atime, mtime) => utimes(path, atime, mtime),
}

/** Where a hard link cannot be made: another volume, or a filesystem without links (FAT, some
 * network shares) - the copy fallback still refuses to replace an existing file. */
const NO_LINK_CODES = new Set(['EXDEV', 'EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS'])

/**
 * Moves one file without ever replacing an existing `to`: `rename` replaces on Windows and a
 * pre-check would leave a race, while `link` and `COPYFILE_EXCL` both fail with EEXIST. A copy
 * gets the source's mtime back, which is what the demo index dates a file by. On any rejection the
 * source is untouched and no second copy is left behind (story 244)
 */
export async function moveNoOverwrite(fs: NoOverwriteFs, from: string, to: string): Promise<void> {
  try {
    await fs.link(from, to)
  } catch (error) {
    if (!NO_LINK_CODES.has(errnoCode(error) ?? '')) throw error
    await copyNoOverwrite(fs, from, to)
  }
  try {
    await fs.unlink(from)
  } catch (error) {
    // `to` is a second link to, or a full copy of, the still-present source.
    await fs.unlink(to).catch(() => {})
    throw error
  }
}

async function copyNoOverwrite(fs: NoOverwriteFs, from: string, to: string): Promise<void> {
  const { atimeMs, mtimeMs } = await fs.stat(from)
  try {
    await fs.copyFile(from, to, constants.COPYFILE_EXCL)
  } catch (error) {
    // EEXIST means `to` is someone else's file; any other failure can only have left our partial copy.
    if (errnoCode(error) !== 'EEXIST') await fs.unlink(to).catch(() => {})
    throw error
  }
  try {
    await fs.utimes(to, atimeMs / 1000, mtimeMs / 1000)
  } catch (error) {
    await fs.unlink(to).catch(() => {})
    throw error
  }
}
