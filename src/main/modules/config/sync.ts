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
  log: Logger
}

export interface SyncProfileOutcome {
  state: ProfileSyncState
  pendingWrites: Record<string, string>
  writeFailures: Record<string, { messageKey: string; at: string }>
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
 * is assigned to. `fileNames` and `liveProfileIds` are computed once by
 * `syncProfile` below and handed down, so every profile in one cascade agrees
 * on the same resolved names.
 */
async function syncOneProfile(
  deps: SyncProfileDeps,
  fileNames: Map<string, string>,
  liveProfileIds: ReadonlySet<string>,
): Promise<SyncProfileOutcome> {
  const { profile, allProfiles, log } = deps
  const pendingWrites = { ...deps.pendingWrites }
  const writeFailures = { ...deps.writeFailures }

  // Every profile in `allProfiles` (including `profile` itself) is guaranteed
  // a key by `resolveProfileFileNames`, so every `fileNames.get(id)!` below is
  // safe.
  const ownFileName = fileNames.get(profile.id)!

  // --- Canonical file -------------------------------------------------------
  const ownFailureKey = `${profile.id}|own`
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

  const ownPath = join(deps.canonicalBaseDir, ownFileName)
  const ownStatus = await liveFileStatus(ownPath, renderProfileFile(profile))
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
      try {
        await writeInstallationFiles({
          installation,
          profileFileName: fileNames.get(fullProfile.id)!,
          profileFileContent: renderProfileFile(fullProfile),
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

    const status = await liveFileStatus(expectedPath, renderProfileFile(profile))
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
    )
    pendingWrites = outcome.pendingWrites
    writeFailures = outcome.writeFailures
    if (next.id === profile.id) mutatedState = outcome.state
    // Re-read rather than predict: a write that failed did not move a file,
    // and the next pick must see what is actually there.
    if (queue.length > 0) ownership = await readCanonicalOwnership(deps.canonicalBaseDir)
  }

  // `profile` is pushed into `queue` above and the loop only ends once the
  // queue is empty, so its own pass has run and set this.
  return { state: mutatedState!, pendingWrites, writeFailures }
}
