import { readdir, readFile, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { ConfigProfile } from '@shared/modules/config'
import { isLauncherOwnedFile } from '@shared/config/file-ownership'
import { renderProfileFile } from '@shared/config/render'
import { backupOnce } from './backup'
import { ownedProfileIdFromContent, writeTargetFile } from './writer'
import type { WriteFileOutcome } from './writer'

/**
 * The one canonical file every profile gets, `<userData>/<name>.cfg`, next to
 * `state.json` - it exists as soon as the profile does, regardless of
 * whether the profile is currently assigned to any installation. This module
 * takes `baseDir` as a plain string so it stays testable without an
 * `electron` import; the caller (a later deliverable) is the one that
 * resolves it to `app.getPath('userData')`.
 *
 * Both functions below identify "this profile's own file" the same way: by
 * reading a `*.cfg` file's whole content and running it through `writer.ts`'s
 * `ownedProfileIdFromContent` - the same forgiving ownership reader every
 * other ownership check in this codebase uses (banner or legacy sentinel,
 * `@shared/config/file-ownership`) - and comparing the id it returns to
 * `profileId`. This is deliberately stricter than plain
 * `isLauncherOwnedFile` matching (`writer.ts`, `cleanup.ts`): a file that is
 * launcher-owned but for a *different* profile id is still one of ours,
 * globally, but it is never THIS profile's file, and this module must never
 * rename or delete another profile's canonical file while acting on this
 * one. Going through `ownedProfileIdFromContent` rather than an exact-string
 * sentinel comparison is what lets a file written with an older sentinel
 * wording, or the newer banner shape, still be recognised as this profile's
 * own (story 043 D1, story 051 D3): only the id is load-bearing, never the
 * surrounding wording or shape.
 */

/** One target file's on-disk write result, plus the path it resolved to. */
export interface WriteCanonicalProfileFileResult {
  path: string
  outcome: WriteFileOutcome
}

/**
 * Current content of `filePath`, or null if the file cannot be read (missing,
 * a directory, anything else). Only used for the ownership comparison below,
 * so a file that cannot be read is never a match - the conservative
 * direction, since it means "leave it alone", not "delete it". Whole content,
 * not just the first line, is what `ownedProfileIdFromContent` needs to
 * recognise a banner-shape header (story 051 D3) - its `id` field lives on
 * line 4, never line 1.
 */
async function contentOf(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'latin1')
  } catch {
    return null
  }
}

/**
 * Direct children of `baseDir`, or an empty list when `baseDir` does not
 * exist yet - the very first write for a fresh userData dir hits this.
 * Mirrors `writer.ts`'s `readExisting`: only `ENOENT` is swallowed, any other
 * error (permissions, a file in the way of what should be a directory)
 * propagates rather than being silently treated as "nothing here".
 */
async function readdirSafe(dir: string): Promise<string[]> {
  try {
    return await readdir(dir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

/**
 * Current content of `filePath`, or null when it does not exist. Same
 * ENOENT-only-swallowed contract as `writer.ts`'s own `readExisting` -
 * deliberately NOT `contentOf`'s "any read failure means null" contract,
 * because this one decides whether a rename below is about to destroy a
 * foreign file; an unreadable-for-some-other-reason file must not be treated
 * as "safe to overwrite silently".
 */
async function readExistingIfAny(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'latin1')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

/**
 * Finds this profile's own canonical file wherever it currently sits in
 * `baseDir`, by matching `ownedProfileIdFromContent(content) === profileId` -
 * never a bare `isLauncherOwnedFile` match, which would also match a
 * different profile's file. Tolerant of either ownership shape and the
 * sentinel's trailing wording: only the id decides ownership, so a file
 * written before story 043 D1's wording change, or before story 051's banner
 * shape, is still found. Returns null when `baseDir` does not exist yet, or
 * no `*.cfg` file in it matches.
 */
async function findOwnCanonicalFile(baseDir: string, profileId: string): Promise<string | null> {
  const names = await readdirSafe(baseDir)

  for (const name of names) {
    if (!name.toLowerCase().endsWith('.cfg')) continue
    const path = join(baseDir, name)
    const content = await contentOf(path)
    if (content !== null && ownedProfileIdFromContent(content) === profileId) return path
  }
  return null
}

/**
 * Every launcher-owned canonical file in `baseDir`, as
 * `profileId -> current file name` - i.e. the file-name mapping that is
 * actually on disk right now, as opposed to the one
 * `resolveProfileFileNames` says should be there.
 *
 * This is decision 6's "reconcile from disk instead of persisting file names"
 * applied to the canonical directory: comparing the two maps is how a caller
 * sees that an operation moved some OTHER profile's file name, without having
 * to carry the pre-mutation profile list around (and while still being right
 * after a crash halfway through a previous sync).
 *
 * Ownership is read the same forgiving way `writer.ts` reads it inside an
 * installation (`ownedProfileIdFromContent` on the whole file, reused rather
 * than reimplemented): a file we cannot read, or whose content carries
 * neither ownership shape, simply has no owner here. `<name>.cfg` only - a
 * `.q2l-backup` file's name does not end in `.cfg`, so the user's backed-up
 * originals are never reported as anyone's file.
 */
export async function readCanonicalOwnership(baseDir: string): Promise<Map<string, string>> {
  const names = await readdirSafe(baseDir)
  const owners = new Map<string, string>()

  for (const name of names) {
    if (!name.toLowerCase().endsWith('.cfg')) continue
    const content = await contentOf(join(baseDir, name))
    if (content === null) continue
    const owner = ownedProfileIdFromContent(content)
    if (owner !== null) owners.set(owner, name)
  }
  return owners
}

/**
 * Writes `profile`'s canonical file at `<baseDir>/<fileName>`.
 *
 * Reconciles first: if this profile's own canonical file already exists
 * under a different name (a rename), it is moved to `fileName` before the
 * write, so a profile rename moves the file in place instead of leaving an
 * orphan behind and creating a fresh duplicate under the new name. The
 * actual write - diff-skip, backup-once, atomic write - is `writer.ts`'s own
 * `writeTargetFile`, reused rather than reimplemented.
 *
 * The rename target might already be occupied - by a foreign, hand-written
 * file (two different profile names can resolve to a target another user
 * file already sits at) or by stale output from an earlier partial
 * migration. `rename()` replaces an existing destination unconditionally, so
 * a foreign file there is backed up first (review finding: this is exactly
 * the boundary decision 7 says must not weaken - "a file that is not ours is
 * the user's" applies to a rename's destination just as much as to a plain
 * write). A destination that is already launcher-owned (either shape, story
 * 051 D3) is one of ours (this profile's own stale output) and is never worth
 * backing up.
 *
 * `liveProfileIds`, when given, turns the one case that used to be waved away
 * into a hard refusal (review finding): a destination whose content names
 * a DIFFERENT profile that still exists is that profile's canonical file, and
 * `rename()`/an overwrite would destroy it. It happens whenever a rename
 * makes this profile claim a name another profile currently occupies on disk
 * (`resolveProfileFileNames` re-resolves the whole list, so the other profile
 * moves to `<base>-2.cfg` - but only once IT is synced too). Throwing here is
 * the second, independent net under `sync.ts`'s cascade: the caller records it
 * in `configWriteFailures` and retries, which is strictly better than losing
 * a file. Left optional so a caller that cannot say which profiles are live
 * keeps the previous behaviour - a marker-carrying destination whose owner is
 * gone is still stale output, and is still replaced.
 */
export async function writeCanonicalProfileFile(
  baseDir: string,
  profile: ConfigProfile,
  fileName: string,
  liveProfileIds?: ReadonlySet<string>,
): Promise<WriteCanonicalProfileFileResult> {
  const targetPath = join(baseDir, fileName)

  const existingOwnPath = await findOwnCanonicalFile(baseDir, profile.id)

  // Not (yet) known to be this profile's own file, so whatever sits at the
  // destination is inspected before anything is renamed or written over it.
  if (existingOwnPath !== targetPath) {
    const destination = await readExistingIfAny(targetPath)
    if (destination !== null) {
      const owner = ownedProfileIdFromContent(destination)
      if (owner !== null && owner !== profile.id && liveProfileIds?.has(owner) === true) {
        throw new Error(
          `refusing to write canonical file ${fileName} for profile ${profile.id}: ` +
            `it is live profile ${owner}'s canonical file`,
        )
      }
      // Only a rename needs a backup decision here; a plain write's own
      // backup-once lives in `writeTargetFile` below.
      if (existingOwnPath !== null && !isLauncherOwnedFile(destination)) {
        await backupOnce(targetPath)
      }
    }
    if (existingOwnPath !== null) await rename(existingOwnPath, targetPath)
  }

  const outcome = await writeTargetFile(targetPath, renderProfileFile(profile))
  return { path: targetPath, outcome }
}

/**
 * Deletes `profileId`'s canonical file, wherever it currently sits in
 * `baseDir`. A no-op - not an error - when `baseDir` does not exist, or no
 * file in it matches this profile's sentinel exactly.
 */
export async function removeCanonicalProfileFile(
  baseDir: string,
  profileId: string,
): Promise<void> {
  const existingOwnPath = await findOwnCanonicalFile(baseDir, profileId)
  if (existingOwnPath === null) return
  await unlink(existingOwnPath)
}
