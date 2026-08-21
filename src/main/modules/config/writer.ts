import { readdir, readFile, rename, unlink } from 'node:fs/promises'
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
export async function writeTargetFile(filePath: string, content: string): Promise<WriteFileOutcome> {
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

/**
 * The profile id carried by a file's sentinel line, or null when the file is not
 * one of ours.
 *
 * `sentinelLine()` (`@shared/config/render`) emits exactly
 * `<OWNERSHIP_MARKER> <profileId> - generated, do not edit`, so the id is the
 * first whitespace-delimited token after the marker. Two shapes deliberately
 * return null rather than a guess:
 *
 * - the marker prefix is not followed by whitespace (`// q2-launcher profiles`
 *   is a different word, not our marker plus an id);
 * - there is no non-empty token after it.
 *
 * Anything null means "treat as the user's own file", which is the only safe
 * direction: the caller's two actions are rename and delete.
 *
 * Exported for `canonical.ts`, which needs the exact same "who owns this file"
 * answer for the canonical directory - one parser for the sentinel, so the two
 * directories can never disagree about what ownership means.
 */
export function ownedProfileId(firstLine: string): string | null {
  if (!firstLine.startsWith(OWNERSHIP_MARKER)) return null
  const rest = firstLine.slice(OWNERSHIP_MARKER.length)
  // `trim()` also drops the `\r` of a CRLF file's first line.
  if (rest.length > 0 && !/^\s/.test(rest)) return null
  const id = rest.trim().split(/\s/, 1)[0]
  return id.length > 0 ? id : null
}

/**
 * Brings the launcher-owned `.cfg` files in `<rootPath>/baseq2` in line with
 * `expected` (profileId -> file name), which the caller has already filtered
 * down to the profiles that are still relevant for this installation:
 *
 * - a file whose sentinel id is in `expected` but whose name differs is renamed
 *   to the expected name (this is what migrates an old `q2l-profile-<id>.cfg`
 *   to story 022's `<name>.cfg`);
 * - a file whose sentinel id is not in `expected` is deleted, because the
 *   profile is gone or no longer assigned here;
 * - everything else is left strictly alone.
 *
 * Meant to run immediately *before* `writeInstallationFiles`, which then writes
 * the current content under the expected names.
 *
 * This is the one function in the module that renames and deletes files inside
 * the user's real game folder, so every branch that is not provably ours ends in
 * "leave it alone":
 *
 * - **Only our own files are ever touched.** A file whose first line does not
 *   parse as our sentinel is the user's hand-written cfg - the very thing the
 *   backup-once machinery exists to protect - and is never renamed or deleted.
 * - **Unreadable is not ownership.** A file we could not read (permissions, or a
 *   race against `readdir`) is skipped exactly like a foreign file. It is never
 *   the reason to delete something.
 * - **`autoexec.cfg` is out of scope, always.** The loader starts with the
 *   marker too, but it is owned by `writeInstallationFiles`' own diff/backup
 *   path and its sentinel carries the installation's *default* profile id, not
 *   an id that says anything about this file's name. It is excluded before it is
 *   even read.
 * - **No path leaves `baseq2`.** Every path is
 *   `join(rootPath, BASE_GAME_DIR, <name>)` where `<name>` is either a direct
 *   child entry name from `readdir` or an expected name that passed
 *   `isBareFileName`; the sentinel-parsed id never reaches a path at all.
 */
export async function reconcileOwnedProfileFiles(
  installation: Pick<Installation, 'rootPath'>,
  expected: Map<string, string>,
): Promise<void> {
  // Pre-flight, before any I/O: an expected name is caller-supplied and is the
  // one value here that becomes a rename *target*, so it gets the same bare-name
  // check `writeInstallationFiles` applies to `profileFileName`, and for the same
  // reason - anything else is a programming error, and throwing up front means it
  // cannot have moved a single file first.
  for (const [profileId, fileName] of expected) {
    if (!isBareFileName(fileName)) {
      throw new Error(`invalid profile file name for ${profileId}: ${fileName}`)
    }
  }

  const baseDir = join(installation.rootPath, BASE_GAME_DIR)

  let entries
  try {
    entries = await readdir(baseDir, { withFileTypes: true })
  } catch (error) {
    // No baseq2 yet (a fresh install, or a root that moved): nothing owned can
    // be in there, so there is nothing to reconcile. Every other error - a
    // permission problem above all - propagates: silently skipping an
    // installation that is actually there would leave stale files behind and
    // hide the reason.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }

  for (const entry of entries) {
    // Plain files only. A directory named `foo.cfg`, and equally a symlink or
    // junction (which reports as neither file nor directory), is left alone -
    // renaming or unlinking one is never something this function needs to do.
    if (!entry.isFile()) continue

    const name = entry.name
    const lower = name.toLowerCase()
    // Case-insensitive on purpose, on every platform: for these two exclusions
    // the case-folding direction is the conservative one, so `AUTOEXEC.CFG` is
    // out of scope even on a case-sensitive filesystem.
    if (!lower.endsWith('.cfg')) continue
    // A `.q2l-backup` file's name ends in that suffix rather than `.cfg`, so the
    // filter above already excluded it. Stated explicitly so nobody wonders:
    // backups hold the user's originals and must never be renamed or deleted.
    if (lower.endsWith(BACKUP_SUFFIX.toLowerCase())) continue
    if (lower === LOADER_FILE_NAME) continue

    const sourcePath = join(baseDir, name)

    let content: string
    try {
      content = await readFile(sourcePath, FILE_ENCODING)
    } catch {
      // One unreadable file must not abort reconciling the rest, and must never
      // be read as "therefore delete it" (same reasoning as cleanup.ts's scan).
      continue
    }

    const profileId = ownedProfileId(content.split('\n', 1)[0])
    if (profileId === null) continue

    const expectedName = expected.get(profileId)

    if (expectedName === undefined) {
      // Ours, but for a profile that is no longer here. The content is our own
      // generated output, so there is nothing worth backing up.
      await unlink(sourcePath)
      continue
    }

    const targetPath = join(baseDir, expectedName)
    // `pathKey` applies the platform's own case rules, so a pure case
    // difference is a no-op on Windows/macOS and a real rename on Linux.
    if (pathKey(sourcePath) === pathKey(targetPath)) continue

    // `rename` replaces an existing destination *file* on both Windows and
    // POSIX unconditionally - fine when the destination is stale output from
    // an earlier partial migration, but NOT when it is the user's own
    // hand-written file that happens to share this profile's expected name
    // (review finding: a wrong ownership check here is exactly what backup-once
    // exists to protect against, and a rename's destination is no exception to
    // that rule). Back a foreign destination up first, same as a plain write
    // would.
    let destination: string | null = null
    try {
      destination = await readFile(targetPath, FILE_ENCODING)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    if (destination !== null && !destination.startsWith(OWNERSHIP_MARKER)) {
      await backupOnce(targetPath)
    }

    try {
      await rename(sourcePath, targetPath)
    } catch {
      // A transient failure (EPERM on Windows while the destination is locked)
      // must not leave BOTH names behind - the old one would keep being exec'd.
      // Dropping the source degrades to "the following write recreates it".
      await unlink(sourcePath)
    }
  }
}
