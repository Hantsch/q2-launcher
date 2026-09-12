import { rm } from 'node:fs/promises'
import { parse, sep } from 'node:path'
import { fail, ok, type Outcome } from '@shared/types'
import { canonicalizePath, isDirectory, pathKey } from '../lib/fs-utils'
import { scopedLogger } from '../lib/logger'

const log = scopedLogger('installation-removal')

export interface DeleteInstallationFolderParams {
  /** The installation root to delete. Canonicalized here; never trusted as given. */
  rootPath: string
  /**
   * The launcher's own data directory (`app.getPath('userData')`), injected rather than read
   * from `../lib/paths`, so this module never imports `electron` and stays testable against a
   * plain temp directory - the same rule `InstallationsService` follows.
   */
  userDataDir: string
  /** The user's home directory (`os.homedir()`), injected for the same reason. */
  homeDir: string
  /** Canonical `rootPath`s of every OTHER registered installation - never the one being deleted. */
  otherInstallationRoots: string[]
}

/**
 * True when `ancestor` is the same folder as `descendant` or contains it. Compared through
 * `pathKey`, so the case-insensitivity of Windows/macOS filesystems is handled in one place.
 */
function isSameOrAncestor(ancestor: string, descendant: string): boolean {
  const a = pathKey(ancestor)
  const d = pathKey(descendant)
  if (a === d) return true
  return d.startsWith(a.endsWith(sep) ? a : `${a}${sep}`)
}

/** Path segments below the filesystem root: `C:\Games\Q2` and `/home/me` are two. */
function segmentsBelowRoot(canonical: string): string[] {
  const { root } = parse(canonical)
  return canonical
    .slice(root.length)
    .split(/[\\/]+/)
    .filter(Boolean)
}

/**
 * Deletes an installation's folder from disk, recursively and irreversibly.
 *
 * This is the only recursive `rm` in the launcher, so everything before it is a fence. The
 * refusals run on the *canonicalized* root - a junction or symlink cannot smuggle the deletion
 * past them by pointing somewhere else - and they all run before anything is touched, so a
 * refused call is a no-op rather than a half-finished one:
 *
 * - the root has to be an existing directory,
 * - it may not be a drive/filesystem root or otherwise fewer than two segments deep,
 * - it may not be, contain, or sit inside the launcher's own data directory,
 * - it may not be, or contain, the user's home directory,
 * - it may not contain another registered installation.
 *
 * The deletion itself uses `fs.rm`, not `shell.trashItem`: the point is reclaiming the disk space,
 * and `fs.rm` unlinks symlinks instead of descending into them, so a link inside the folder is
 * removed while whatever it points at outside the folder survives.
 */
export async function deleteInstallationFolder(
  params: DeleteInstallationFolderParams,
): Promise<Outcome<null>> {
  const root = await canonicalizePath(params.rootPath)

  // Shape first, existence second: a path that is too shallow to ever be an installation is
  // refused as such whether or not it happens to exist right now.
  const { root: filesystemRoot } = parse(root)
  if (pathKey(root) === pathKey(filesystemRoot) || segmentsBelowRoot(root).length < 2) {
    log.warn(`refusing to delete "${root}": drive root or too close to it`)
    return fail('installations.error.deleteFromDiskRoot', { path: root })
  }

  // Both directions: deleting the launcher's data directory takes the library with it, and
  // deleting something inside it (the icon cache, the log) breaks the launcher just as thoroughly.
  const userData = await canonicalizePath(params.userDataDir)
  if (isSameOrAncestor(root, userData) || isSameOrAncestor(userData, root)) {
    log.warn(`refusing to delete "${root}": inside or containing the launcher data directory`)
    return fail('installations.error.deleteFromDiskUserData', { path: root })
  }

  // Only "is or contains" here - installations legitimately live *under* the home directory.
  const home = await canonicalizePath(params.homeDir)
  if (isSameOrAncestor(root, home)) {
    log.warn(`refusing to delete "${root}": the home directory`)
    return fail('installations.error.deleteFromDiskHome', { path: root })
  }

  for (const other of params.otherInstallationRoots) {
    const otherRoot = await canonicalizePath(other)
    if (isSameOrAncestor(root, otherRoot)) {
      log.warn(`refusing to delete "${root}": contains the installation at "${otherRoot}"`)
      return fail('installations.error.deleteFromDiskOverlapsInstallation', {
        path: root,
        other: otherRoot,
      })
    }
  }

  if (!(await isDirectory(root))) {
    log.warn(`refusing to delete "${root}": not an existing directory`)
    return fail('installations.error.deleteFromDiskMissing', { path: root })
  }

  try {
    // `maxRetries`/`retryDelay` because a virus scanner or the search indexer holding a file open
    // for a moment is the most common reason this fails on Windows, and a retried delete is still
    // the same delete.
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  } catch (error) {
    log.error(`failed to delete "${root}"`, error)
    return fail('installations.error.deleteFromDiskFailed', { path: root })
  }

  log.info(`deleted installation folder "${root}"`)
  return ok(null)
}
