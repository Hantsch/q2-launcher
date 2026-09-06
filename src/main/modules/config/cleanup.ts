import { copyFile, readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { BASE_GAME_DIR } from '@shared/constants'
import { isLauncherOwnedFile } from '@shared/config/file-ownership'
import type { Installation } from '@shared/types'
import { fileSize, isFile, listDir, pathExists } from '../../lib/fs-utils'
import { BACKUP_SUFFIX, backupOnce } from './backup'
import { gameDirBelongsToInstallation } from './import'
import { isSafeGameDirName, LOADER_FILE_NAME } from './writer'

/**
 * Story 010's redundancy scan: a mod-folder `.cfg` file is redundant when the
 * engine's own search path would find a same-named `baseq2` file anyway, so
 * the mod-folder copy is dead weight the user probably forgot about rather
 * than something they rely on.
 *
 * `scanRedundantCopies()` is read-only by construction. `removeRedundantCopies()`
 * and `restoreRemovedCopies()` (D2) are the only things in this module that
 * touch the disk, and they are the one irreversible step of the whole feature,
 * so they are built the same conservative way `writer.ts` is:
 *
 * - **Backup before unlink, always.** A file is copied to `<file>.q2l-backup`
 *   via `backupOnce()` - the exact same helper and suffix the write pipeline
 *   uses - and only then deleted. There is no code path to `unlink` that has
 *   not awaited `backupOnce` for that same path first, and `backupOnce` only
 *   resolves when a backup is in place (it swallows nothing but `EEXIST`,
 *   which means one is already there). A pre-existing backup always wins: it
 *   holds the user's original, and re-copying over it would destroy exactly
 *   what it protects.
 * - **Never delete outside the installation's own mod folders.** Entries are
 *   `{ gameDir, fileName }` ids, never paths: every path is built here from
 *   `installation.rootPath`, a gamedir the installation itself recorded, and a
 *   bare `*.cfg` name. `baseq2` is explicitly out of scope for deletion - it is
 *   the reference side of the comparison, never the copy.
 * - **Delete only what is a finding right now.** `removeRedundantCopies()`
 *   re-scans and deletes only entries the fresh scan still reports, which makes
 *   a stale or forged entry structurally undeletable rather than merely
 *   validated.
 *
 * A rejected entry is returned as data, never thrown - only a genuine I/O
 * failure on an otherwise valid entry propagates, the same way `writer.ts`
 * refuses to fall through on a file it could not read.
 */

/** Case-sensitive suffix a candidate file name must end with (mirrors the plain string check `render.ts` uses for `PROFILE_FILE_SUFFIX`). */
const CFG_SUFFIX = '.cfg'

/**
 * A bare `*.cfg` file name: one or more of the same ASCII token characters the
 * rest of the codebase allows for game directories, ending in a literal `.cfg`.
 * Separators, `:`, a lone `..` and anything absolute-path-shaped fail it, so a
 * name that passes can only ever address a direct child of the gamedir it is
 * joined onto.
 *
 * Case-sensitive on the suffix on purpose: `scanRedundantCopies()`'s own
 * `endsWith(CFG_SUFFIX)` check is too, so a `HUD.CFG` on disk is not a finding
 * in the first place and must not become deletable through this door either.
 */
const BARE_CFG_NAME = /^[A-Za-z0-9_.-]+\.cfg$/

/**
 * One mod-folder `.cfg` file that duplicates a same-named `baseq2` file.
 *
 * Kept local and minimal for D1: `gameDir`/`fileName`/`identical` are what
 * the acceptance criteria require. `size` is added too - `fileSize()` is
 * already in scope for this scan and later Ds (the review UI) want it for
 * free rather than re-reading the file - but nothing else is speculative.
 * D3 may re-shape/re-export this as the module's shared contract type.
 */
export interface CleanupFinding {
  /** One of `installation.gameDirs` - the mod folder the redundant copy lives in. */
  gameDir: string
  /** File name only, as it appears on disk inside `gameDir`. */
  fileName: string
  /** True when the mod-folder copy is byte-identical (latin1) to the baseq2 file of the same name. */
  identical: boolean
  /** Byte size of the mod-folder copy, or null if it could not be stat'd. */
  size: number | null
}

/**
 * Scans every mod folder of `installation` (`installation.gameDirs`, minus
 * `baseq2` itself - decision 9: `baseq2` is only ever the comparison
 * reference here, never a source of findings) for `.cfg` files that also
 * exist in `<rootPath>/baseq2`.
 *
 * Non-recursive: `listDir()` only ever returns direct children, so a `.cfg`
 * file living in a mod folder's subdirectory is never looked at - that falls
 * out of using `listDir()` rather than needing its own guard.
 *
 * Excluded, per the sprint decisions: `autoexec.cfg` (case-insensitive -
 * story 004 puts it there on purpose), anything that is not a regular file,
 * and any file `isLauncherOwnedFile` recognises (the launcher's own previous
 * output, either ownership shape, never a "leftover" the user needs
 * reviewing).
 */
export async function scanRedundantCopies(installation: Installation): Promise<CleanupFinding[]> {
  const baseDir = join(installation.rootPath, BASE_GAME_DIR)
  const baseListing = await listDir(baseDir)

  const findings: CleanupFinding[] = []

  for (const gameDir of installation.gameDirs) {
    if (gameDir.toLowerCase() === BASE_GAME_DIR) continue

    const modDir = join(installation.rootPath, gameDir)
    // listDir()'s own `.files` array already excludes directories and
    // symlinks-to-directories (see its doc comment), so every name here is
    // already known to be a regular file - no need to re-confirm with
    // isFile() for the mod-folder side too.
    const listing = await listDir(modDir)

    for (const name of listing.files) {
      if (!name.endsWith(CFG_SUFFIX)) continue
      if (name.toLowerCase() === LOADER_FILE_NAME) continue

      // Case-insensitive lookup of the baseq2 counterpart's real on-disk
      // name. `byLowerName` covers both files and directories, so isFile()
      // below is what actually rules out "baseq2 has a *folder* with this
      // name", which byLowerName alone cannot tell us.
      const baseName = baseListing.byLowerName.get(name.toLowerCase())
      if (!baseName) continue

      const baseFilePath = join(baseDir, baseName)
      if (!(await isFile(baseFilePath))) continue

      const modFilePath = join(modDir, name)
      const modContent = await readFile(modFilePath, 'latin1')

      // Our own previous output is never a finding, regardless of which
      // profile id it currently carries (same ownership check the writer
      // itself uses to recognise its own files).
      if (isLauncherOwnedFile(modContent)) continue

      const baseContent = await readFile(baseFilePath, 'latin1')

      findings.push({
        gameDir,
        fileName: name,
        identical: modContent === baseContent,
        size: await fileSize(modFilePath),
      })
    }
  }

  return findings
}

/**
 * How a caller addresses one redundant copy: an id, never a path (decision 7).
 * Both results echo this same minimal shape back, so `result.removed` can be
 * handed straight to `restoreRemovedCopies()` for the undo.
 *
 * D3 will mirror this in `src/shared/modules/config.ts`; it is local for now.
 */
export interface CleanupEntry {
  /** One of `installation.gameDirs`, never `baseq2`, never a path. */
  gameDir: string
  /** Bare file name inside `gameDir`, matching `BARE_CFG_NAME`. */
  fileName: string
}

export interface CleanupRemoveResult {
  /** Entries whose file was backed up and then deleted by this call. */
  removed: CleanupEntry[]
  /** Entries this call did not act on - untrusted, no longer a finding, or a repeat. */
  rejected: CleanupEntry[]
}

export interface CleanupRestoreResult {
  /** Entries whose backup was copied back into place by this call. */
  restored: CleanupEntry[]
  /** Entries this call did not act on - untrusted, no backup, or the file is already there. */
  rejected: CleanupEntry[]
}

/** Lookup key for "the same file", exact-match on both parts. `\0` cannot occur in either. */
function entryKey(gameDir: string, fileName: string): string {
  return `${gameDir}\u0000${fileName}`
}

/** The entry reduced to exactly the two fields this module promises to echo back. */
function refOf(entry: CleanupEntry): CleanupEntry {
  return { gameDir: entry.gameDir, fileName: entry.fileName }
}

/**
 * The path-trust boundary for both functions below, applied before any path is
 * built. Four conditions, all required:
 *
 * 1. `gameDir` is one the installation itself recorded
 *    (`gameDirBelongsToInstallation`, story 005's rule - decision 10, reused
 *    rather than reimplemented).
 * 2. `gameDir` is still a safe folder name in its own right
 *    (`isSafeGameDirName`, `writer.ts`'s own second line of defence, reused for
 *    the same reason it exists there): condition 1 answers "did the
 *    installation record this?", and `gameDirs` is persisted in `state.json`
 *    and parsed forgivingly (`z.array(z.string()).catch([])`), so a
 *    hand-edited state file could put `..` in it and satisfy condition 1 alone.
 *    The write path refuses to write through such an entry; the delete path
 *    must refuse harder.
 * 3. `gameDir` is not `baseq2`. Condition 1 returns true for `baseq2` because
 *    it is a legitimate gamedir for the *import* feature, so it alone would let
 *    the base game's own files be deleted (decision 9). Compared lowercased,
 *    mirroring `scanRedundantCopies()`'s own guard.
 * 4. `fileName` is a bare `*.cfg` name.
 */
function entryIsTrusted(installation: Installation, entry: CleanupEntry): boolean {
  if (!gameDirBelongsToInstallation(installation, entry.gameDir)) return false
  if (!isSafeGameDirName(entry.gameDir)) return false
  if (entry.gameDir.toLowerCase() === BASE_GAME_DIR) return false
  return BARE_CFG_NAME.test(entry.fileName)
}

/**
 * Backs up and deletes the redundant copies named by `entries`.
 *
 * An entry is only ever deleted when it survives all of: the trust checks
 * (`entryIsTrusted`), and a *fresh* `scanRedundantCopies()` still reporting it
 * as a finding (decision 8) - so the list the user reviewed cannot delete
 * something that has changed underneath it in the meantime, and an invented
 * `fileName` has nothing to match. Everything else comes back in `rejected`;
 * nothing here throws for a rejected entry.
 *
 * The order per file is fixed and has no alternative branch: `backupOnce()` is
 * awaited first, `unlink()` only after it resolved. `backupOnce()` resolving
 * means a `.q2l-backup` is on disk - either freshly copied, or one that was
 * already there and is deliberately left untouched (decision 5). A failure to
 * back up therefore propagates and the file is *not* deleted.
 */
export async function removeRedundantCopies(
  installation: Installation,
  entries: CleanupEntry[],
): Promise<CleanupRemoveResult> {
  const removed: CleanupEntry[] = []
  const rejected: CleanupEntry[] = []

  // Trust checks first, so an untrusted gameDir/fileName never has a path built
  // for it at all - not even one that is merely stat'ed.
  const trusted: CleanupEntry[] = []
  // Guards against deleting the same file twice in one run, the way writer.ts's
  // `claimed` set guards against writing one twice: the second pass would find
  // the backup already present, skip the copy and unlink a file that is gone,
  // which is an I/O error rather than a no-op. A repeat is reported, not
  // silently dropped.
  const seen = new Set<string>()
  for (const entry of entries) {
    const key = entryKey(entry.gameDir, entry.fileName)
    if (!entryIsTrusted(installation, entry) || seen.has(key)) {
      rejected.push(refOf(entry))
      continue
    }
    seen.add(key)
    trusted.push(entry)
  }

  if (trusted.length === 0) return { removed, rejected }

  const findings = await scanRedundantCopies(installation)
  const stillAFinding = new Set(findings.map((f) => entryKey(f.gameDir, f.fileName)))

  // Sequential on purpose, same reasoning as writer.ts's own write loop: a
  // failure halfway must not race deletes that are still in flight, and every
  // backup must be settled before the unlink it belongs to.
  for (const entry of trusted) {
    if (!stillAFinding.has(entryKey(entry.gameDir, entry.fileName))) {
      rejected.push(refOf(entry))
      continue
    }

    const filePath = join(installation.rootPath, entry.gameDir, entry.fileName)
    await backupOnce(filePath)
    await unlink(filePath)
    removed.push(refOf(entry))
  }

  return { removed, rejected }
}

/**
 * Copies the `.q2l-backup` of each entry back into place - the disk half of the
 * "Undo removal" action (decision 6).
 *
 * Deliberately does *not* re-scan: a file this is meant to restore is, by
 * definition, gone from the mod folder, so intersecting with a fresh scan would
 * reject every real undo.
 *
 * The backup file is never deleted, not even after a successful restore: it is
 * permanent, so undoing the undo - or simply trying again - stays possible.
 * Two cases are rejected rather than treated as success, because this call did
 * not put anything back in either: no backup to restore from, and the target
 * already existing again (a file that reappeared is never overwritten).
 */
export async function restoreRemovedCopies(
  installation: Installation,
  entries: CleanupEntry[],
): Promise<CleanupRestoreResult> {
  const restored: CleanupEntry[] = []
  const rejected: CleanupEntry[] = []

  // Sequential on purpose, same reasoning as above. A repeated entry needs no
  // separate guard here: the second pass finds the file it just restored and
  // lands in the already-present branch.
  for (const entry of entries) {
    // Same trust boundary as removal - including `baseq2`, which must not be
    // writable through the undo path either.
    if (!entryIsTrusted(installation, entry)) {
      rejected.push(refOf(entry))
      continue
    }

    const filePath = join(installation.rootPath, entry.gameDir, entry.fileName)
    const backupPath = `${filePath}${BACKUP_SUFFIX}`

    if (!(await pathExists(backupPath))) {
      rejected.push(refOf(entry))
      continue
    }
    // The file came back since the delete (a re-copy, a mod reinstall): leave
    // it exactly as it is. No COPYFILE_EXCL below because of this check, not
    // instead of it.
    if (await pathExists(filePath)) {
      rejected.push(refOf(entry))
      continue
    }

    await copyFile(backupPath, filePath)
    restored.push(refOf(entry))
  }

  return { restored, rejected }
}
