import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  ConfigProfile,
  ProfileFileSync,
  ProfileInstallationSync,
  ProfileSyncState,
} from '@shared/modules/config'
import { resolveProfileFileNames } from '@shared/config/profile-files'
import { renderLoaderFile, renderProfileFile } from '@shared/config/render'
import type { SwitchBindProfile } from '@shared/config/switch-bind'
import type { Installation, LaunchState } from '@shared/types'
import type { Logger } from '../../lib/logger'
import { readCanonicalOwnership, writeCanonicalProfileFile } from './canonical'
import { hashCanonicalFileContent } from './file-source'
import { assignedProfilesFor, defaultProfileFor, isInstallationRunning } from './write-plan'
import { BASE_GAME_DIR, reconcileOwnedProfileFiles, writeInstallationFiles } from './writer'

/**
 * D6 of story 022 — the sync engine that reports, and drives towards, "is
 * every copy of this profile actually on disk where it should be". Supersedes
 * `index.ts`'s `writeProfileToAssignedInstallations` for the one profile being
 * synced (wiring it in as the module's own write path is a later
 * deliverable): unlike that function, this one writes EVERY profile assigned
 * to a not-running installation, not just the one being saved plus the
 * installation's default, so a `missing`/`outOfSync` report means a real
 * problem rather than "assigned but never itself saved".
 *
 * `syncProfile` (bottom of this file) is the entry point: it orchestrates the
 * per-profile pass `syncOneProfile` over the mutated profile AND over every
 * profile whose resolved file name that mutation moved - see its own doc.
 *
 * Quake II configs are read/written as latin1 throughout this codebase (see
 * `writer.ts`'s own `FILE_ENCODING`); this module reads with the same
 * encoding so every diff/compare below is a true byte-for-byte comparison.
 */
const FILE_ENCODING: BufferEncoding = 'latin1'

export interface SyncProfileDeps {
  profile: ConfigProfile
  /** Full profile list — used to resolve file names and each installation's assigned set. */
  allProfiles: ConfigProfile[]
  installations: { find: (id: string) => Installation | undefined }
  launchState: LaunchState
  playedModsFor: (installationId: string) => string[]
  switchBindFor?: (installationId: string) => string | undefined
  /** Base directory for the canonical file, e.g. `app.getPath('userData')` — a plain string so tests need no electron. */
  canonicalBaseDir: string
  /** Current pending-write map (installationId -> profileId), read and returned updated. */
  pendingWrites: Record<string, string>
  /** Current write-failure map (`<profileId>|own` or `<profileId>|<installationId>` -> {messageKey, at}), read and returned updated. */
  writeFailures: Record<string, { messageKey: string; at: string }>
  /**
   * Story 043 D4: "is THIS profile's canonical file ours to write on this pass?" - the deliberate
   * inversion of story 022 decision 8 ("every mutation writes immediately"). Asked per profile, not
   * once per cascade: one pass can touch the mutated profile plus every profile a rename displaced
   * plus every profile assigned to the same installation, and each of them answers for itself
   * (`index.ts` answers "not while it carries unsaved edits, and not over bytes we have never
   * read").
   *
   * Story 043 D10: the second argument is what the file currently says - its raw bytes and their
   * hash, or `null`/`null` when there is no file. Handed in rather than left for the predicate to
   * fetch because this function reads that file anyway (see `writeSourceFor` below), and because a
   * predicate that did its own read could decide on different bytes than the ones this pass then
   * writes over. It is what lets `index.ts` answer AC5's actual promise - "the launcher never
   * overwrites a hand-edit it has not read" - for the paths that are not a save: an `assign`, a
   * `setDefault`, a rename cascade, the startup retry sweep.
   *
   * Answering `false` has two consequences, both in `syncOneProfile` below, and the second is the
   * point of the first: that profile's canonical file is left exactly as it is, AND its
   * per-installation copies are written from the canonical file's own on-disk bytes instead of from
   * `renderProfileFile(profile)` - so unsaved edits cannot reach an installation through a sync
   * triggered by something else (an `assign`, a retry sweep), which is story AC6's "installation
   * copies only ever come from the canonical file".
   *
   * Optional, defaulting to "always ours": every caller that does not opt in keeps the pre-043
   * unconditional write, so no existing call site changes behaviour by accident.
   */
  canonicalWriteAllowed?: (profile: ConfigProfile, onDisk: CanonicalFileFacts) => boolean
  log: Logger
}

/**
 * What a profile's canonical file currently holds, as `canonicalWriteAllowed` is told it (story 043
 * D10). `content: null` means there is no readable file at all - which is not the same as an empty
 * one, and the difference decides whether "nothing there to lose" applies.
 */
export interface CanonicalFileFacts {
  content: string | null
  /** `hashCanonicalFileContent(content)`, or `null` when there is no content - so a caller can
   * compare against a cached `fileHash` without re-hashing (or re-reading) anything. */
  hash: string | null
}

export interface SyncProfileOutcome {
  state: ProfileSyncState
  pendingWrites: Record<string, string>
  writeFailures: Record<string, { messageKey: string; at: string }>
  /**
   * Story 043 D2/D4: `profileId -> sha-256 of the canonical file's bytes`, for every profile this
   * pass *confirmed* by reading its canonical file back and finding it byte-identical to
   * `renderProfileFile(profile)` - the mutated profile and every cascaded one alike.
   *
   * This is D2's "a write seeds the baseline, so the launcher's own write is never mistaken for an
   * external edit" made available to the caller, who owns the cache (`ConfigProfile.fileHash`) that
   * `readFileState` compares against. Confirmed-by-read rather than assumed-from-a-successful-write,
   * the same "trust the disk, not the write outcome" rule `liveFileStatus` already follows; a
   * profile whose file could not be confirmed simply has no entry here and keeps whatever baseline
   * it had.
   */
  canonicalHashes: Record<string, string>
}

/**
 * Live status of the file at `path` compared against `expectedContent`.
 * "Trust the disk, not the write outcome" (deliberate — a later deliverable
 * depends on it): this is always computed by actually reading the file,
 * regardless of whether a preceding write attempt threw or succeeded.
 *
 * Only `ENOENT` counts as "missing" (mirrors `writer.ts`'s own `readExisting`
 * idiom); every other read error (a directory sitting where the file should
 * be, a permission problem, ...) maps to `'error'`, never silently to
 * `'missing'`.
 */
async function liveFileStatus(
  path: string,
  expectedContent: string,
): Promise<'inSync' | 'outOfSync' | 'missing' | 'error'> {
  try {
    const content = await readFile(path, FILE_ENCODING)
    return content === expectedContent ? 'inSync' : 'outOfSync'
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing'
    return 'error'
  }
}

/**
 * One profile's full sync pass - its canonical file plus every installation it
 * is assigned to. `fileNames`, `liveProfileIds` and `ownership` are computed
 * once by `syncProfile` below and handed down, so every profile in one cascade
 * agrees on the same resolved names and on the same view of the disk.
 */
async function syncOneProfile(
  deps: SyncProfileDeps,
  fileNames: Map<string, string>,
  liveProfileIds: ReadonlySet<string>,
  ownership: ReadonlyMap<string, string>,
): Promise<SyncProfileOutcome> {
  const { profile, allProfiles, log } = deps
  const pendingWrites = { ...deps.pendingWrites }
  const writeFailures = { ...deps.writeFailures }
  const canonicalHashes: Record<string, string> = {}

  // Every profile in `allProfiles` (including `profile` itself) is guaranteed
  // a key by `resolveProfileFileNames`, so every `fileNames.get(id)!` below is
  // safe.
  const ownFileName = fileNames.get(profile.id)!

  /**
   * A profile's canonical file as it stands on disk right now, read at most once per pass.
   *
   * Looked up by `ownership` (the sentinel's actual current file name) before falling back to the
   * resolved name, because a rename now only marks the profile dirty - the canonical file itself is
   * not moved until the user saves, so for a renamed-but-unsaved profile the resolved name is not
   * yet the name on disk. Cached because both consumers below can ask for the same profile several
   * times in one pass (once for the write decision, once per assigned installation), and re-reading
   * the same file each time would be pure cost.
   */
  const diskCache = new Map<string, string | null>()
  const canonicalBytesOf = async (candidate: ConfigProfile): Promise<string | null> => {
    const cached = diskCache.get(candidate.id)
    if (cached !== undefined) return cached
    const onDiskName = ownership.get(candidate.id) ?? fileNames.get(candidate.id)!
    let content: string | null
    try {
      content = await readFile(join(deps.canonicalBaseDir, onDiskName), FILE_ENCODING)
    } catch (error) {
      content = null
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        log.warn(
          `canonical file ${onDiskName} for profile ${candidate.id} could not be read; this pass ` +
            `treats it as having no authoritative content`,
          error,
        )
      }
    }
    diskCache.set(candidate.id, content)
    return content
  }

  /**
   * Story 043 D4/D10: the write decision per profile, asked once and remembered for the rest of the
   * pass - it must not be re-derived after the canonical write below, since by then the bytes it
   * was made from are (deliberately) no longer what is on disk.
   */
  const writeAllowed = new Map<string, boolean>()
  const mayWrite = async (candidate: ConfigProfile): Promise<boolean> => {
    if (!deps.canonicalWriteAllowed) return true
    const remembered = writeAllowed.get(candidate.id)
    if (remembered !== undefined) return remembered
    const content = await canonicalBytesOf(candidate)
    const allowed = deps.canonicalWriteAllowed(candidate, {
      content,
      hash: content === null ? null : hashCanonicalFileContent(content),
    })
    writeAllowed.set(candidate.id, allowed)
    return allowed
  }

  /**
   * Story 043 D4: the bytes ANY profile's copies may be written from on this pass.
   *
   * `renderProfileFile(p)` when `p`'s canonical file is ours to write (the pre-043 behaviour, and
   * exactly what the canonical write below puts on disk), otherwise the canonical file's own
   * current bytes - `null` when there are none to read. Resolved per profile because the
   * installation loop below writes EVERY profile assigned to an installation, not just `profile`:
   * a dirty sibling's unsaved edits must not reach an installation either, and neither must a
   * render that would overwrite a hand-edit nobody has read.
   */
  const writeSourceFor = async (candidate: ConfigProfile): Promise<string | null> =>
    (await mayWrite(candidate)) ? renderProfileFile(candidate) : canonicalBytesOf(candidate)

  // --- Canonical file -------------------------------------------------------
  const ownFailureKey = `${profile.id}|own`
  const ownRendered = renderProfileFile(profile)
  if (await mayWrite(profile)) {
    try {
      await writeCanonicalProfileFile(deps.canonicalBaseDir, profile, ownFileName, liveProfileIds)
      // A previous failure is now resolved.
      delete writeFailures[ownFailureKey]
    } catch (error) {
      log.error(`failed to write canonical profile file for ${profile.id}`, error)
      writeFailures[ownFailureKey] = {
        messageKey: 'config.error.writeFailed',
        at: new Date().toISOString(),
      }
    }
  } else {
    // Nothing was attempted, so an existing failure entry is neither cleared (it is still true)
    // nor added (this is not a failure - it is the file not being ours to write yet).
    log.debug(
      `canonical file ${ownFileName} for profile ${profile.id} left untouched: it either carries ` +
        `unsaved edits (only an explicit save writes those) or holds bytes the launcher has not ` +
        `read yet (only an explicit save, or a resolved conflict, may overwrite those)`,
    )
  }

  const ownPath = join(deps.canonicalBaseDir, ownFileName)
  // Deliberately still compared against `renderProfileFile(profile)`, whether or not the write
  // above ran: story 043's "no sixth sync state" decision is that a profile with unsaved edits
  // reports its canonical file as `outOfSync` (a later deliverable adds the *reason* in
  // `messageKey`), which is exactly what this comparison yields.
  const ownStatus = await liveFileStatus(ownPath, ownRendered)
  // Confirmed byte-for-byte, so this hash is a valid `fileHash` baseline for the caller's cache -
  // see `SyncProfileOutcome.canonicalHashes`. Also true on the skipped path, where it means "the
  // file happens to already say what the profile says".
  if (ownStatus === 'inSync') canonicalHashes[profile.id] = hashCanonicalFileContent(ownRendered)
  const own: ProfileFileSync = {
    path: ownPath,
    fileName: ownFileName,
    status: ownStatus,
    ...(ownStatus === 'error'
      ? { messageKey: writeFailures[ownFailureKey]?.messageKey ?? 'config.error.writeFailed' }
      : {}),
  }

  // --- Per assigned installation --------------------------------------------
  const installationsOut: ProfileInstallationSync[] = []

  for (const assignment of profile.assignments) {
    const installation = deps.installations.find(assignment.installationId)
    // An assignment pointing at an installation that no longer exists is not
    // this function's problem (mirrors the existing precedent in `index.ts`).
    if (!installation) continue

    const failureKey = `${profile.id}|${installation.id}`
    const expectedPath = join(installation.rootPath, BASE_GAME_DIR, ownFileName)

    if (isInstallationRunning(deps.launchState, installation.id)) {
      pendingWrites[installation.id] = profile.id
      // Pending is a distinct, non-error state: any existing write failure for
      // this key is left untouched, neither cleared nor overwritten.
      installationsOut.push({
        installationId: installation.id,
        path: expectedPath,
        fileName: ownFileName,
        status: 'pending',
        messageKey: 'config.error.installationRunning',
      })
      continue
    }

    // `assignedProfilesFor` returns `{id, name}[]` in the installation's own
    // cycle order; resolved to full profiles and file names below.
    const assignedProfiles = assignedProfilesFor(allProfiles, installation.id)
    const expected = new Map(assignedProfiles.map((p) => [p.id, fileNames.get(p.id)!]))

    // We've now confirmed this installation is not running, so whatever was
    // previously deferred here is at least being attempted again - regardless
    // of whether the reconcile/write below actually succeed.
    delete pendingWrites[installation.id]

    // Before any write, so a renamed or migrated file lands under its new
    // name first and the write below diff-skips it. Wrapped (review finding):
    // an uncaught throw here (a permission error walking `baseq2`, or a rename
    // fallback's own `unlink` failing) must still end up in `writeFailures`,
    // not silently abort the rest of this installation's sync with nothing to
    // show for it - attributed to `profile`'s own key since reconcile is not
    // scoped to one assigned profile. A failed reconcile does not necessarily
    // mean the write below will also fail (they are independent I/O passes,
    // and `writeInstallationFiles`'s own diff-skip/backup-once stays safe even
    // if a file wasn't renamed to its expected name first), so this is not a
    // reason to skip attempting it.
    try {
      await reconcileOwnedProfileFiles(installation, expected)
    } catch (error) {
      log.error(
        `failed to reconcile owned profile files for installation ${installation.id}`,
        error,
      )
      writeFailures[failureKey] = {
        messageKey: 'config.error.writeFailed',
        at: new Date().toISOString(),
      }
    }

    const foundDefault = defaultProfileFor(allProfiles, installation.id)
    if (!foundDefault) {
      // Should not happen once an installation has any assignment (the
      // assignment invariant in `assignments.ts` guarantees a default), but a
      // violated invariant must degrade to "write the profile being synced",
      // not to a crash.
      log.warn(
        `no default profile found for installation ${installation.id}; ` +
          `falling back to the profile being written (${profile.id})`,
      )
    }
    const defaultProfile = foundDefault ?? profile

    const switchBindKey = deps.switchBindFor?.(installation.id)
    const switchBindProfiles: SwitchBindProfile[] = assignedProfiles.map((p) => ({
      id: p.id,
      name: p.name,
      // Every assigned profile comes from `allProfiles`, which `fileNames`
      // was resolved from above, so this lookup cannot miss.
      fileName: fileNames.get(p.id)!,
    }))
    const loaderFileContent = renderLoaderFile(
      defaultProfile,
      fileNames.get(defaultProfile.id)!,
      switchBindKey
        ? { key: switchBindKey, profiles: switchBindProfiles, defaultProfileId: defaultProfile.id }
        : undefined,
    )

    // Write EVERY profile assigned to this installation (a deliberate
    // behavior change from the old `writeProfileToAssignedInstallations` -
    // see the file doc comment), sequentially: two targets can resolve to the
    // same file on a case-insensitive filesystem, and a failure halfway must
    // not race writes that are still in flight. Each assigned profile's
    // failure is caught and attributed to ITS OWN key, not `profile`'s
    // (review finding): a sibling's locked file must never be reported as a
    // problem with a profile whose own write actually succeeded, and one
    // sibling's failure must not abort writing the rest.
    for (const assigned of assignedProfiles) {
      // Every entry of `assignedProfiles` comes from `allProfiles`, so this
      // lookup cannot miss.
      const fullProfile = allProfiles.find((p) => p.id === assigned.id)!
      const assignedFailureKey = `${assigned.id}|${installation.id}`
      // Story 043 D4: the canonical file is the only source for an installation copy (AC6). For a
      // profile whose canonical file is ours to write this is `renderProfileFile` as before; for
      // one carrying unsaved edits it is that file's own bytes.
      const profileFileContent = await writeSourceFor(fullProfile)
      if (profileFileContent === null) {
        // No authoritative content exists (a canonical file that carries unsaved edits and is
        // missing or unreadable - e.g. deleted outside the launcher, which the story calls an error
        // state awaiting the user's decision, not something sync silently resurrects). Writing
        // `renderProfileFile(fullProfile)` here is exactly the leak this deliverable exists to
        // prevent, so this profile contributes no write at all on this pass: its installation copy
        // is left as it is and the status below reports the mismatch honestly. No `writeFailures`
        // entry either - nothing failed, there was nothing to write. Consequence worth naming: the
        // loader is written by every OTHER assigned profile's iteration, so an installation whose
        // only assigned profile lands here gets no write at all until the user saves.
        log.warn(
          `skipping installation ${installation.id}'s copy of profile ${assigned.id}: its ` +
            `canonical file is not this pass's to write and could not be read`,
        )
        continue
      }
      try {
        await writeInstallationFiles({
          installation,
          profileFileName: fileNames.get(fullProfile.id)!,
          profileFileContent,
          loaderFileContent,
          playedMods: deps.playedModsFor(installation.id),
        })
        delete writeFailures[assignedFailureKey]
      } catch (error) {
        log.error(
          `failed to write config profile ${assigned.id} for installation ${installation.id}`,
          error,
        )
        writeFailures[assignedFailureKey] = {
          messageKey: 'config.error.writeFailed',
          at: new Date().toISOString(),
        }
      }
    }

    // Compared against the content the canonical file authorises for `profile` (story 043 AC6:
    // installation copies are generated output of that file), not against the in-memory profile -
    // so an installation holding exactly what the canonical file says is `inSync`, and a
    // hand-edited installation copy is still `outOfSync` "exactly as today". Falls back to the
    // render when there is no readable canonical file at all, which reports the missing/mismatched
    // copy rather than claiming it is fine.
    const expectedCopy = (await writeSourceFor(profile)) ?? ownRendered
    const status = await liveFileStatus(expectedPath, expectedCopy)
    installationsOut.push({
      installationId: installation.id,
      path: expectedPath,
      fileName: ownFileName,
      status,
      ...(status === 'error'
        ? { messageKey: writeFailures[failureKey]?.messageKey ?? 'config.error.writeFailed' }
        : {}),
    })
  }

  return {
    state: { own, installations: installationsOut },
    pendingWrites,
    writeFailures,
    canonicalHashes,
  }
}

/**
 * True when `currentFileName` is a real on-disk name that is not the name this
 * profile now resolves to. Compared case-insensitively, the same way
 * `resolveProfileFileNames` claims names: a pure case difference is fixed by
 * that profile's own next sync and is never worth cascading for.
 */
function isDisplaced(currentFileName: string | undefined, resolvedFileName: string): boolean {
  if (currentFileName === undefined) return false
  return currentFileName.toLowerCase() !== resolvedFileName.toLowerCase()
}

/**
 * Index of the next profile in `queue` to sync.
 *
 * A profile can move now unless another profile STILL IN THE QUEUE currently
 * occupies the name it wants - that one has to vacate first, or the rename
 * would land on a live profile's file (which `canonical.ts` now refuses
 * outright). A profile not in the queue can never be the blocker: not being
 * queued means its on-disk name already equals its resolved name, and resolved
 * names are unique.
 *
 * Among the ones that can move, a displaced profile goes before the mutated
 * one, so a file that has to get out of the way is renamed before the mutated
 * profile's own write - never the other way round.
 *
 * When nothing can move (a rename cycle - two profiles trading names, which
 * needs two mutations to set up), the first entry is taken anyway: a refusal
 * recorded in `writeFailures` and retried is the honest outcome, an endless
 * loop or a silently skipped profile is not.
 */
function pickNextToSync(
  queue: readonly ConfigProfile[],
  mutatedProfileId: string,
  ownership: Map<string, string>,
  fileNames: Map<string, string>,
): number {
  const blocked = (candidate: ConfigProfile): boolean => {
    const target = fileNames.get(candidate.id)!.toLowerCase()
    return queue.some(
      (other) => other.id !== candidate.id && ownership.get(other.id)?.toLowerCase() === target,
    )
  }

  const displacedFirst = queue.findIndex((p) => p.id !== mutatedProfileId && !blocked(p))
  if (displacedFirst !== -1) return displacedFirst

  const anyMovable = queue.findIndex((p) => !blocked(p))
  return anyMovable !== -1 ? anyMovable : 0
}

/**
 * Syncs `profile` - and, cascading, every other profile whose resolved file
 * name this operation changed too.
 *
 * The cascade is the fix for a confirmed AC-3 bug (review finding): renaming
 * `Frag` to `Duel` while another, later-created profile named `Duel` exists
 * makes `resolveProfileFileNames` re-resolve the WHOLE list - the renamed
 * profile claims `Duel.cfg` and the other one moves to `Duel-2.cfg`. Syncing
 * only the profile the user edited wrote the renamed profile straight over the
 * other one's canonical file, which then stayed destroyed until that profile
 * happened to be edited itself.
 *
 * "Whose name changed" is read off the disk (`readCanonicalOwnership`) rather
 * than from a remembered pre-mutation profile list - decision 6's "reconcile
 * from disk instead of persisting file names", and the only variant that is
 * also correct after a crash halfway through a previous sync, or for a name
 * that was never migrated. Displaced profiles are moved before the mutated
 * profile's own write (see `pickNextToSync`), so no name is briefly occupied
 * twice or missing.
 *
 * The signature and outcome are deliberately unchanged: `state` is still the
 * state of `profile` only, and the returned `pendingWrites`/`writeFailures`
 * are still the full maps to persist - now carrying the cascaded profiles'
 * entries as well, under their own keys.
 */
export async function syncProfile(deps: SyncProfileDeps): Promise<SyncProfileOutcome> {
  const { profile, allProfiles } = deps
  const fileNames = resolveProfileFileNames(allProfiles)
  const liveProfileIds = new Set(allProfiles.map((p) => p.id))

  let pendingWrites = deps.pendingWrites
  let writeFailures = deps.writeFailures
  let canonicalHashes: Record<string, string> = {}

  let ownership = await readCanonicalOwnership(deps.canonicalBaseDir)
  // `profile` is always last in the queue, and every other entry is a profile
  // this operation displaced - `pickNextToSync` decides the actual order.
  const queue = allProfiles.filter(
    (p) => p.id !== profile.id && isDisplaced(ownership.get(p.id), fileNames.get(p.id)!),
  )
  queue.push(profile)

  let mutatedState: ProfileSyncState | null = null
  while (queue.length > 0) {
    const next = queue.splice(pickNextToSync(queue, profile.id, ownership, fileNames), 1)[0]!
    const outcome = await syncOneProfile(
      { ...deps, profile: next, pendingWrites, writeFailures },
      fileNames,
      liveProfileIds,
      ownership,
    )
    pendingWrites = outcome.pendingWrites
    writeFailures = outcome.writeFailures
    // Later passes win for the same id, which is the fresher confirmation of the two.
    canonicalHashes = { ...canonicalHashes, ...outcome.canonicalHashes }
    if (next.id === profile.id) mutatedState = outcome.state
    // Re-read rather than predict: a write that failed did not move a file,
    // and the next pick must see what is actually there.
    if (queue.length > 0) ownership = await readCanonicalOwnership(deps.canonicalBaseDir)
  }

  // `profile` is pushed into `queue` above and the loop only ends once the
  // queue is empty, so its own pass has run and set this.
  return { state: mutatedState!, pendingWrites, writeFailures, canonicalHashes }
}
