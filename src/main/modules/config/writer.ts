import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Installation } from '@shared/types'
import { pathKey, writeFileAtomic } from '../../lib/fs-utils'
import { BACKUP_SUFFIX, backupOnce } from './backup'
import { OWNERSHIP_MARKER } from './render'

export { BACKUP_SUFFIX }

/**
 * Puts already-rendered config text onto an installation's disk. This module
 * knows nothing about `ConfigProfile` - it only decides, per target file,
 * whether to skip, back up or overwrite, and where the target files live.
 *
 * It is the one irreversible step of the config module, so both of its
 * decisions are deliberately conservative:
 *
 * - **Backup once, forever.** A file we are about to overwrite that is not ours
 *   is the user's own hand-written cfg. It is copied to `<file>.q2l-backup`
 *   exactly once - a later save must never replace that backup with output we
 *   generated ourselves, or the original is gone for good.
 * - **Never write outside the installation's own known folders.** Every target
 *   path is built from `installation.rootPath` plus either the literal
 *   `baseq2` or a mod name that the installation's own validation scan already
 *   found on disk (`installation.gameDirs`). Nothing else reaches the filesystem.
 */

/** Name of the file the engine auto-executes on startup. */
export const LOADER_FILE_NAME = 'autoexec.cfg'

/** Folder holding the base game's assets and configs. */
export const BASE_GAME_DIR = 'baseq2'

/**
 * Quake II configs are read and written as latin1: the engine is byte-oriented
 * and predates UTF-8, so a cfg is whatever bytes are in it. Reading with the
 * same encoding we write with is what makes the diff check below a true
 * byte-for-byte comparison.
 */
const FILE_ENCODING: BufferEncoding = 'latin1'

/**
 * What the rest of this codebase considers a valid game directory
 * (`src/main/lib/schemas.ts`): a single ASCII token, which rules out traversal,
 * separators, absolute paths and drive letters in one check.
 */
const GAME_DIR_TOKEN = /^[A-Za-z0-9_.-]+$/

export interface WriteInstallationFilesOptions {
  installation: Installation
  /** File name only (e.g. "q2l-profile-<id>.cfg"), written inside baseq2. */
  profileFileName: string
  /** Rendered content for the profile's own cvars/binds file. */
  profileFileContent: string
  /**
   * Rendered content for the loader `autoexec.cfg` - written to
   * `baseq2/autoexec.cfg` AND copied byte-for-byte into every folder in
   * `playedMods` (as that folder's own `autoexec.cfg`), because
   * `FS_ExecAutoexec` never consults the search path, unlike everything else
   * the engine loads.
   */
  loaderFileContent: string
  /**
   * Mod/mission-pack folder names the caller wants the loader copied into.
   * NOT trusted as-is: only entries that are also present in
   * `installation.gameDirs` (exact string match) are used. Anything else is
   * silently dropped - this is the path-trust boundary for mod folder names,
   * so a caller passing a bogus or malicious name must never cause a write
   * outside the installation's own known folders.
   */
  playedMods: string[]
}

export type WriteFileOutcome = 'written' | 'unchanged'

export interface WriteInstallationFilesResult {
  /** True when at least one target file was actually written to disk. */
  changed: boolean
  /** Per-target-file detail, useful for tests and logging. */
  files: Array<{ path: string; outcome: WriteFileOutcome }>
  /** playedMods entries that were dropped because they are not in installation.gameDirs. */
  rejectedMods: string[]
}

interface WriteTarget {
  path: string
  content: string
}

/**
 * True for a name that can only ever address a direct child of a directory.
 * Applied to the caller-supplied profile file name, which is documented as a
 * bare file name; anything else is a programming error and throws rather than
 * writing somewhere unexpected.
 */
function isBareFileName(name: string): boolean {
  if (name.length === 0 || name === '.' || name === '..') return false
  return !/[/\\:]/.test(name)
}

/**
 * Second line of defence for mod folder names. `gameDirs` is produced by the
 * installation scan and therefore trusted, but it is also persisted in
 * `state.json` and parsed forgivingly (`z.array(z.string()).catch([])`), so a
 * hand-edited state file could carry anything. `.` and `..` are excluded
 * explicitly: both match the token regex on their own.
 *
 * Exported for `cleanup.ts`, whose delete path needs the exact same second line
 * of defence for the exact same reason - a caller, not a variant.
 */
export function isSafeGameDirName(name: string): boolean {
  if (name === '.' || name === '..') return false
  return GAME_DIR_TOKEN.test(name)
}

/**
 * Current content of `filePath`, or null when it does not exist.
 *
 * Only ENOENT counts as "not there". Any other error (permissions, a directory
 * in the way, an I/O fault) is rethrown: we must never fall through to the
 * overwrite path for a file we could not read, because that is exactly the case
 * where the ownership check - the thing standing between a user's cfg and the
 * bin - could not be performed.
 */
async function readExisting(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, FILE_ENCODING)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

/**
 * Skip / back up + write / write, for one target file.
 *
 * The diff check compares the file's decoded content against `content`. Should
 * `content` ever carry a character outside latin1, the comparison fails and the
 * file is rewritten - the harmless direction: an unnecessary write, never a
 * skipped backup.
 */
async function writeTargetFile(filePath: string, content: string): Promise<WriteFileOutcome> {
  const existing = await readExisting(filePath)

  if (existing !== null) {
    // Byte-for-byte identical: nothing to write, nothing to back up. Keeps
    // mtimes stable and makes a resave into N mod folders cheap.
    if (existing === content) return 'unchanged'

    // About to overwrite. A file that starts with our marker is our own
    // previous output - possibly rendered for a different profile id, which is
    // why only the prefix is compared - and is never worth preserving.
    if (!existing.startsWith(OWNERSHIP_MARKER)) {
      await backupOnce(filePath)
    }
  }

  await writeFileAtomic(filePath, content, FILE_ENCODING)
  return 'written'
}

export async function writeInstallationFiles(
  options: WriteInstallationFilesOptions,
): Promise<WriteInstallationFilesResult> {
  const { installation, profileFileName, profileFileContent, loaderFileContent, playedMods } =
    options

  if (!isBareFileName(profileFileName)) {
    throw new Error(`invalid profile file name: ${profileFileName}`)
  }

  const baseDir = join(installation.rootPath, BASE_GAME_DIR)
  const targets: WriteTarget[] = [
    { path: join(baseDir, profileFileName), content: profileFileContent },
    { path: join(baseDir, LOADER_FILE_NAME), content: loaderFileContent },
  ]
  // Guards against writing the same file twice in one run (a duplicate entry in
  // `playedMods`, or "baseq2" listed as a played mod). `pathKey` applies the
  // platform's own case rules, so `BASEQ2` and `baseq2` collapse on Windows.
  const claimed = new Set(targets.map((target) => pathKey(target.path)))
  const rejectedMods: string[] = []

  // The membership filter runs before any I/O, so a name that is not one of the
  // installation's own folders never even gets a path built for it.
  for (const mod of playedMods) {
    if (!isSafeGameDirName(mod) || !installation.gameDirs.includes(mod)) {
      rejectedMods.push(mod)
      continue
    }
    const path = join(installation.rootPath, mod, LOADER_FILE_NAME)
    const key = pathKey(path)
    if (claimed.has(key)) continue
    claimed.add(key)
    targets.push({ path, content: loaderFileContent })
  }

  // Sequential on purpose: two targets can resolve to the same file on a
  // case-insensitive filesystem, and a failure halfway must not race writes
  // that are still in flight.
  const files: WriteInstallationFilesResult['files'] = []
  for (const target of targets) {
    files.push({ path: target.path, outcome: await writeTargetFile(target.path, target.content) })
  }

  return {
    changed: files.some((file) => file.outcome === 'written'),
    files,
    rejectedMods,
  }
}
