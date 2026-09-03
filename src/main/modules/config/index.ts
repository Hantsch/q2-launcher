import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { shell } from 'electron'
import {
  CONFIG_HANDLERS,
  type CleanupApplyResult,
  type CleanupEntry,
  type CleanupRestoreResult,
  type CleanupScanResult,
  type ConfigProfile,
  type DiscardProfileResult,
  type ImportPreviewResult,
  type ImportScanResult,
  type PreviewFile,
  type PreviewProfileResult,
  type ProfileFileSyncStatus,
  type ProfileInstallationSync,
  type ProfileSyncState,
  type RawFilesResult,
  type RawInstallationTarget,
  type RawProfileFile,
  type RefreshedProfileResult,
  type RefreshFromFilesResult,
  type SaveProfileResult,
  type TidyUpApplyResult,
  type WriteState,
  type WriteTargetResult,
} from '@shared/modules/config'
import type { Installation, LaunchState } from '@shared/types'
import { reconcileAssignments } from './assignments'
import { applyTidyUpOps } from '@shared/config/tidy-up'
import { resolveProfileFileNames } from '@shared/config/profile-files'
import { fail, ok, type Outcome } from '@shared/types'
import type { AppContext } from '../../context'
import { isFile } from '../../lib/fs-utils'
import type { Logger } from '../../lib/logger'
import { userDataDir } from '../../lib/paths'
import type { MainModule } from '../types'
import { readCanonicalOwnership, removeCanonicalProfileFile } from './canonical'
import { readFileState } from './file-source'
import { syncProfile } from './sync'
import { removeRedundantCopies, restoreRemovedCopies, scanRedundantCopies } from './cleanup'
import { commitImport, previewImport, scanImportCandidates } from './import'
import { ProfilesStore } from './profiles'
import {
  detectSectionHeaderStyle,
  detectWriteUnbindall,
  recoverProfileName,
  runFileSourceStartup,
} from './rebuild'
import { renderLoaderFile, renderProfileFile } from './render'
import {
  assignProfileInputSchema,
  cleanupApplyInputSchema,
  cleanupRestoreInputSchema,
  cleanupScanInputSchema,
  createConfigProfileInputSchema,
  discardProfileInputSchema,
  importCommitInputSchema,
  importPreviewInputSchema,
  importScanInputSchema,
  listInputSchema,
  openFileInputSchema,
  previewProfileInputSchema,
  rawFilesInputSchema,
  refreshFromFilesInputSchema,
  removeConfigProfileInputSchema,
  renameConfigProfileInputSchema,
  saveProfileInputSchema,
  setDefaultProfileInputSchema,
  setPlayedModsInputSchema,
  setProfileActionsInputSchema,
  setProfileBindsInputSchema,
  setProfileCvarsInputSchema,
  setProfileLayersInputSchema,
  setSectionHeaderStyleInputSchema,
  setSwitchBindInputSchema,
  setWriteUnbindallInputSchema,
  switchBindsInputSchema,
  syncStateInputSchema,
  tidyUpApplyInputSchema,
  unassignProfileInputSchema,
  writeProfileInputSchema,
  writeStateInputSchema,
} from './schemas'
import { assignedProfilesFor, defaultProfileFor, isInstallationRunning } from './write-plan'
import {
  BASE_GAME_DIR,
  LOADER_FILE_NAME,
  ownedProfileId,
  readExisting,
  writeInstallationFiles,
} from './writer'

export interface WriteProfileDeps {
  profile: ConfigProfile
  /** The full profile list, used to resolve each target installation's default. */
  allProfiles: ConfigProfile[]
  installations: { find: (id: string) => Installation | undefined }
  launchState: LaunchState
  playedModsFor: (installationId: string) => string[]
  /**
   * Story 007: the key (if any) bound to that installation's in-session
   * profile-switch chain. Optional - and defaulting to "no bind" when absent
   * - so every pre-story-007 test/call site that builds `WriteProfileDeps`
   * without it keeps compiling untouched.
   */
  switchBindFor?: (installationId: string) => string | undefined
  /** Current pending-write map (installationId -> profileId) to update from. */
  pendingWrites: Record<string, string>
  log: Logger
}

export interface WriteProfileOutcome {
  results: WriteTargetResult[]
  /** The pending-write map after this run - callers persist it. */
  pendingWrites: Record<string, string>
}

/**
 * Writes `profile`'s files to every installation it is assigned to, skipping
 * (and marking `pending`) any installation that is currently running.
 *
 * Pure I/O orchestration, no state store: takes and returns plain data so it
 * is testable without booting `configModule.setup()`. Assignments pointing at
 * an installation that no longer exists are silently skipped - reconciling
 * those away is `withLiveAssignments`'s job elsewhere in this module, not an
 * error here.
 */
export async function writeProfileToAssignedInstallations(
  deps: WriteProfileDeps,
): Promise<WriteProfileOutcome> {
  const { profile, allProfiles, installations, launchState, playedModsFor, log } = deps
  const switchBindFor = deps.switchBindFor ?? (() => undefined)
  const results: WriteTargetResult[] = []
  const pendingWrites = { ...deps.pendingWrites }
  // Resolved once per call - `allProfiles` does not change across the loop below.
  const fileNames = resolveProfileFileNames(allProfiles)

  for (const assignment of profile.assignments) {
    const installation = installations.find(assignment.installationId)
    if (!installation) continue

    if (isInstallationRunning(launchState, installation.id)) {
      results.push({ installationId: installation.id, status: 'pending' })
      pendingWrites[installation.id] = profile.id
      continue
    }

    let defaultProfile = defaultProfileFor(allProfiles, installation.id)
    if (!defaultProfile) {
      // Should not happen once an installation has any assignment (the
      // assignment invariant in `assignments.ts` guarantees a default), but a
      // violated invariant must degrade to "write the profile being saved",
      // not to a crash.
      log.warn(
        `no default profile found for installation ${installation.id}; ` +
          `falling back to the profile being written (${profile.id})`,
      )
      defaultProfile = profile
    }

    try {
      // The loader always execs the installation's *default* profile's own
      // file (Decision 3), which is not necessarily `profile` - the one being
      // saved here can be a non-default profile also assigned to this
      // installation. If that default's own file was never written yet (e.g.
      // it was assigned but never itself saved), the loader would point at a
      // file that does not exist and the engine silently execs nothing. So
      // when the two differ, the default's own file is written first (or
      // confirmed unchanged) to guarantee the loader's exec target exists,
      // before writing the profile actually being saved.
      const targets = defaultProfile.id === profile.id ? [profile] : [defaultProfile, profile]

      // Story 007: the switch-bind chain is a function of the installation
      // (its bound key and its ordered assigned profiles), not of which
      // target is being written, so it is computed once per installation and
      // reused for every target's loader render below.
      const switchBindKey = switchBindFor(installation.id)
      const assignedProfiles = assignedProfilesFor(allProfiles, installation.id).map((p) => ({
        ...p,
        // Every assigned profile comes from `allProfiles`, which `fileNames`
        // was resolved from above, so this lookup cannot miss.
        fileName: fileNames.get(p.id)!,
      }))
      const loaderFileContent = renderLoaderFile(
        defaultProfile,
        // `defaultProfile` is drawn from `allProfiles` (or falls back to
        // `profile`, itself the one being saved and therefore also a member
        // of `allProfiles`), so this lookup cannot miss.
        fileNames.get(defaultProfile.id)!,
        switchBindKey
          ? { key: switchBindKey, profiles: assignedProfiles, defaultProfileId: defaultProfile.id }
          : undefined,
      )

      let anyChanged = false
      for (const target of targets) {
        const result = await writeInstallationFiles({
          installation,
          // `target` is always `profile` or `defaultProfile`, both drawn from
          // `allProfiles`, so this lookup cannot miss.
          profileFileName: fileNames.get(target.id)!,
          profileFileContent: renderProfileFile(target),
          loaderFileContent,
          playedMods: playedModsFor(installation.id),
        })
        anyChanged = anyChanged || result.changed
      }

      results.push({
        installationId: installation.id,
        status: anyChanged ? 'written' : 'unchanged',
      })
      delete pendingWrites[installation.id]
    } catch (error) {
      log.error(
        `failed to write config profile ${profile.id} for installation ${installation.id}`,
        error,
      )
      results.push({
        installationId: installation.id,
        status: 'error',
        messageKey: 'config.error.writeFailed',
      })
      // Leave the pending map untouched: a real error must never be reported
      // as merely "pending, will retry on its own".
    }
  }

  return { results, pendingWrites }
}

/**
 * The exact files a `write` of `profile` would put on `installation`'s disk,
 * without writing them - what `preview` answers and what `write` itself
 * produces internally. Kept as one function so the two can never drift apart.
 */
export function previewProfileFiles(
  profile: ConfigProfile,
  allProfiles: ConfigProfile[],
  installation: Pick<Installation, 'id' | 'rootPath'>,
  switchBindKey?: string,
): Omit<PreviewFile, 'onDisk'>[] {
  const defaultProfile = defaultProfileFor(allProfiles, installation.id) ?? profile
  const baseDir = join(installation.rootPath, BASE_GAME_DIR)
  const fileNames = resolveProfileFileNames(allProfiles)
  const assignedProfiles = assignedProfilesFor(allProfiles, installation.id).map((p) => ({
    ...p,
    // Every assigned profile comes from `allProfiles`, which `fileNames`
    // was resolved from above, so this lookup cannot miss.
    fileName: fileNames.get(p.id)!,
  }))

  const files: Omit<PreviewFile, 'onDisk'>[] = []
  // Mirrors the `defaultProfile.id !== profile.id` branch in
  // `writeProfileToAssignedInstallations` above, so a preview never shows
  // fewer files than an actual write would put on disk.
  if (defaultProfile.id !== profile.id) {
    files.push({
      // `defaultProfile` is drawn from `allProfiles` (or falls back to
      // `profile`, itself always a member of `allProfiles`), so this lookup
      // cannot miss.
      path: join(baseDir, fileNames.get(defaultProfile.id)!),
      content: renderProfileFile(defaultProfile),
    })
  }
  files.push(
    {
      // `profile` is always a member of `allProfiles`, so this lookup cannot miss.
      path: join(baseDir, fileNames.get(profile.id)!),
      content: renderProfileFile(profile),
    },
    {
      path: join(baseDir, LOADER_FILE_NAME),
      content: renderLoaderFile(
        defaultProfile,
        fileNames.get(defaultProfile.id)!,
        switchBindKey
          ? { key: switchBindKey, profiles: assignedProfiles, defaultProfileId: defaultProfile.id }
          : undefined,
      ),
    },
  )
  return files
}

/**
 * Story 023 D1: read-only report of the profile's own canonical file plus one
 * entry per live assignment - what the `rawFiles` handler answers.
 *
 * Deliberately takes plain data (a live-installation lookup, a base dir, a
 * played-mods getter) rather than `AppContext`, same reasoning as
 * `previewProfileFiles` above: testable without booting `configModule.setup()`.
 * Never writes - `readExisting` (`writer.ts`) is the same ENOENT-only-swallowed
 * read the write pipeline itself uses, so a missing file is reported as
 * `onDisk: false` rather than thrown, and `matches` reuses the write pipeline's
 * own byte-for-byte comparison instead of a second one that could drift from it.
 */
export async function collectRawFiles(
  profile: ConfigProfile,
  allProfiles: ConfigProfile[],
  installations: { find: (id: string) => Installation | undefined },
  userDataBaseDir: string,
  playedModsFor: (installationId: string) => string[],
): Promise<RawFilesResult> {
  const fileNames = resolveProfileFileNames(allProfiles)
  // `profile` is always a member of `allProfiles`, so this lookup cannot miss.
  const fileName = fileNames.get(profile.id)!

  const canonicalPath = join(userDataBaseDir, fileName)
  const canonicalContent = await readExisting(canonicalPath)
  const canonical: RawProfileFile = {
    path: canonicalPath,
    // A freshly created, unassigned profile has no canonical file yet - that
    // must still be a successful result (story 023 AC 3), not a thrown error.
    content: canonicalContent ?? '',
    onDisk: canonicalContent !== null,
  }

  // Story 043 D4: same rule the sync engine and `syncState` follow - an installation copy is
  // generated output of the canonical file, so a profile carrying unsaved edits has its copies
  // judged against that file's bytes (which is what is actually written there), not against the
  // unsaved render. Falls back to the render when there are no canonical bytes to compare with, and
  // is byte-identical to the pre-043 behaviour for every profile that is not dirty.
  const expectedContent =
    profile.dirty === true ? (canonicalContent ?? renderProfileFile(profile)) : renderProfileFile(profile)
  const installationTargets: RawInstallationTarget[] = []
  for (const assignment of profile.assignments) {
    const installation = installations.find(assignment.installationId)
    // An assignment pointing at an installation that no longer exists is
    // reconciled away elsewhere, not reported here - same as `syncState`.
    if (!installation) continue

    const path = join(installation.rootPath, BASE_GAME_DIR, fileName)
    const content = await readExisting(path)
    installationTargets.push({
      installationId: installation.id,
      path,
      onDisk: content !== null,
      matches: content === expectedContent,
      playedMods: playedModsFor(installation.id),
    })
  }

  return { canonical, installations: installationTargets }
}

/**
 * Keeps only entries that are actually one of the installation's own game
 * directories. The path-trust boundary for played-mod names lives in
 * `writer.ts` too (it re-checks at write time); this is what keeps
 * `state.json` itself from persisting a name that was never real.
 */
export function validatePlayedMods(gameDirs: string[], playedMods: string[]): string[] {
  return playedMods.filter((mod) => gameDirs.includes(mod))
}

/**
 * Story 022 D7: the one place every write-triggering handler funnels through to get `profile`'s
 * files onto disk - its canonical `<userData>` copy plus every installation it is assigned to - and
 * to persist the resulting pending-write/write-failure bookkeeping.
 *
 * Deliberately returns `void` and never throws: a sync problem is reported
 * through `configWriteFailures` (which `syncState` below and the `write`
 * channel surface), never by turning a successful CRUD operation into a failed
 * IPC response. `syncProfile` already catches its own write failures
 * internally, so the try/catch here is a defensive backstop for the
 * genuinely-unexpected - not the normal error path.
 *
 * Story 043 D4 adds the one rule that inverts story 022 decision 8, and it is applied here rather
 * than at each call site so no call site can forget it: **a profile carrying unsaved edits
 * (`dirty`) is never written to disk by anything but `save`**. It holds for every profile a run
 * touches, not just the one that triggered it - the mutated profile, a sibling displaced by a
 * rename, another profile assigned to the same installation - which is why it is handed to
 * `syncProfile` as a per-profile predicate. `assign`/`unassign`/`setDefault`/`write` still call this
 * function and still sync immediately (they change assignment relationships, not profile *content*),
 * and this predicate is what keeps them from carrying a dirty profile's unsaved edits onto disk
 * through that side door.
 *
 * Story 043 D10 adds the second half of that rule, for the case `dirty` alone cannot cover: **a
 * canonical file whose current bytes the launcher has never read is not ours to overwrite either**,
 * however clean the profile is. `dirty` only says "the cache is ahead of the file"; it says nothing
 * about the file having moved underneath us, and every write path that is not a save
 * (`assign`/`unassign`/`setDefault`, a rename cascade, `write`'s retry, and above all the startup
 * retry sweep, which runs before the renderer exists and therefore before any focus re-read can
 * have happened) used to render straight over such a file. That is precisely the hand-edit
 * clobbering AC5 forbids, so the decision is made from what the file actually says: the write is
 * allowed when there is no file, when its bytes hash to the profile's own cached `fileHash` (we read
 * or wrote exactly these bytes), when they already equal what we would write anyway, or when the
 * user explicitly asked for this profile to be overwritten (`overwriteProfileId` - `save`'s
 * `force`, i.e. the conflict dialog's "overwrite with my version"). Otherwise the file is left
 * alone, no `writeFailures` entry is recorded (nothing failed), and the canonical row reports
 * `outOfSync`, which is what invites the user to Reload/Compare (story D9).
 *
 * A profile with no `fileHash` at all keeps the pre-043 behaviour deliberately: there is no baseline
 * to compare against, and by the time a profile has one - which AC8's migration seeds for every
 * pre-existing profile on the first start, and `create`/`save`/`adopt`/rebuild seed for every other
 * - this rule applies to it.
 *
 * The mirror image of all of it is the `canonicalHashes` loop below: whenever a run confirmed a
 * profile's canonical file byte-for-byte, that hash becomes the profile's `fileHash` baseline, so
 * the launcher's own write is never later mistaken for an external edit (story D2's contract, here
 * for every profile a cascade confirmed, not only the triggering one).
 */
async function syncAndPersist(
  app: AppContext,
  log: Logger,
  profiles: ProfilesStore,
  profile: ConfigProfile,
  allProfiles: ConfigProfile[],
  options: { overwriteProfileId?: string } = {},
): Promise<ProfileSyncState | null> {
  try {
    const outcome = await syncProfile({
      profile,
      allProfiles,
      installations: app.installations,
      launchState: app.launch.getState(),
      playedModsFor: (installationId) => app.state.configPlayedMods()[installationId] ?? [],
      switchBindFor: (installationId) => app.state.configSwitchBinds()[installationId],
      canonicalBaseDir: userDataDir(),
      pendingWrites: app.state.configPendingWrites(),
      writeFailures: app.state.configWriteFailures(),
      canonicalWriteAllowed: (candidate, onDisk) => {
        if (candidate.dirty === true) return false
        if (candidate.id === options.overwriteProfileId) return true
        if (onDisk.content === null) return true
        if (typeof candidate.fileHash !== 'string') return true
        if (onDisk.hash === candidate.fileHash) return true
        if (onDisk.content === renderProfileFile(candidate)) return true
        log.warn(
          `leaving canonical file for profile ${candidate.id} alone: it holds bytes the launcher ` +
            `has not read (an external edit), and only an explicit save may overwrite those`,
        )
        return false
      },
      log,
    })
    app.state.setConfigPendingWrites(outcome.pendingWrites)
    app.state.setConfigWriteFailures(outcome.writeFailures)
    const now = Date.now()
    for (const [profileId, fileHash] of Object.entries(outcome.canonicalHashes)) {
      // A profile that vanished mid-run (removed by another handler while this one awaited) is
      // simply skipped - seeding a cache entry for it has nothing to be a cache of. So is one whose
      // baseline already IS this hash: re-confirming the same bytes (which every retry sweep and
      // every assign of an unchanged profile does) has nothing new to record, and committing the
      // whole profile list for it would be pure churn.
      const cached = profiles.find(profileId)
      if (
        cached &&
        (cached.fileHash !== fileHash ||
          cached.fileState !== 'unchanged' ||
          // Story 049 D1: `markFileSeen` also seeds the last-saved baseline, so a record that has
          // none yet - every profile persisted before this story - has something new to record even
          // when its hash is already right, and gets its baseline on the first sync that confirms
          // its file instead of waiting for the next content change. Safe for a `dirty` profile
          // too: an id only appears in `canonicalHashes` when the file was read back byte-identical
          // to this profile's own render (`sync.ts`), so the snapshot describes the file either way.
          cached.baseline === undefined)
      ) {
        profiles.markFileSeen(profileId, fileHash, now)
      }
    }
    return outcome.state
  } catch (error) {
    log.error(`unexpected error syncing config profile ${profile.id}`, error)
    return null
  }
}

/**
 * Read-only status of one on-disk file vs. what it should currently contain -
 * never writes. A persisted `configWriteFailures` entry for this exact key
 * always wins and is reported as `'error'` (the last attempted WRITE failed,
 * which matters even if the file on disk happens to look fine or absent for
 * some unrelated reason); otherwise the live file is read and compared.
 *
 * Latin1 to match `writer.ts`/`sync.ts`'s own encoding, so the comparison is a
 * true byte-for-byte one.
 */
async function readSyncFileStatus(
  path: string,
  expectedContent: string,
  failure: { messageKey: string; at: string } | undefined,
): Promise<{ status: ProfileFileSyncStatus; messageKey?: string }> {
  if (failure) return { status: 'error', messageKey: failure.messageKey }
  try {
    const content = await readFile(path, 'latin1')
    return content === expectedContent ? { status: 'inSync' } : { status: 'outOfSync' }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { status: 'missing' }
    return { status: 'error', messageKey: 'config.error.writeFailed' }
  }
}

/**
 * Story 010, decision 12: `apply`/`restore` refuse a currently-running
 * installation, the same way `write` above skips-and-marks-pending - except a
 * cleanup delete/restore has no retry queue to fall into, so this is a hard
 * refusal rather than a `pending` status. `scan` is deliberately NOT gated by
 * this (it is read-only and always safe) and so has no equivalent wrapper -
 * `configModule.setup()`'s `cleanupScan` handler calls `scanRedundantCopies`
 * directly.
 *
 * Pulled out of the handler closure - like `writeProfileToAssignedInstallations`
 * above - so the running-guard itself is testable without booting
 * `configModule.setup()`.
 */
export async function applyCleanupIfNotRunning(
  installation: Installation,
  entries: CleanupEntry[],
  launchState: LaunchState,
): Promise<Outcome<CleanupApplyResult>> {
  if (isInstallationRunning(launchState, installation.id)) {
    return fail('config.error.installationRunning')
  }
  return ok(await removeRedundantCopies(installation, entries))
}

/** Restore's half of the same running-guard - see `applyCleanupIfNotRunning` above. */
export async function restoreCleanupIfNotRunning(
  installation: Installation,
  entries: CleanupEntry[],
  launchState: LaunchState,
): Promise<Outcome<CleanupRestoreResult>> {
  if (isInstallationRunning(launchState, installation.id)) {
    return fail('config.error.installationRunning')
  }
  return ok(await restoreRemovedCopies(installation, entries))
}

/**
 * The config module - CRUD over centrally-owned config profiles, plus their
 * assignment links to installations.
 *
 * Mirrors `library`'s shape (see `../library/index.ts`): a `MainModule` whose
 * `setup` registers handlers on the shell's `module:invoke` channel and does
 * nothing else. Profile logic itself lives in `ProfilesStore`; this file only
 * wires payload validation to it and shapes the return values.
 *
 * No `emit` here - the renderer reloads from each mutation's returned list,
 * there is no broadcast event for this module in step 1.
 */
export const configModule: MainModule = {
  id: 'config',

  async setup({ handle, app, log }) {
    const profiles = new ProfilesStore(app.state)

    // One-off sweep: drop assignments to installations that vanished while the
    // launcher was closed, so a stale reference never reaches the renderer.
    profiles.reconcile(app.installations.list().map((installation) => installation.id))

    // Every handler below re-filters against the *live* installation set on
    // read, so an installation removed mid-session (no restart, no reconcile
    // sweep in between) never shows up in what the renderer sees - without
    // writing that removal to disk here, since this module deliberately does
    // not hook into `InstallationsService.remove()`.
    const withLiveAssignments = (list: ConfigProfile[]): ConfigProfile[] =>
      reconcileAssignments(
        list,
        app.installations.list().map((installation) => installation.id),
      )

    /**
     * Story 043 D4: the tail every *content* mutation now ends in, in place of `syncAndPersist`.
     *
     * This is the inversion of story 022 decision 8 ("every mutation writes immediately"), decided
     * with the user in story 043: the file is the source of truth, so the launcher may not keep
     * stamping it on every keystroke. The mutation itself is already persisted in `state.json` by
     * the setter that ran just before this (a crash must not lose an edit); all that is left is to
     * record that the canonical `.cfg` does not carry it yet. No file is touched here, and
     * `CONFIG_HANDLERS.save` is the only thing that writes profile content from now on.
     */
    const markUnsaved = (profileId: string): ConfigProfile[] =>
      withLiveAssignments(profiles.setDirty(profileId, true))

    handle(CONFIG_HANDLERS.list, listInputSchema, (): ConfigProfile[] =>
      withLiveAssignments(profiles.list()),
    )

    handle(
      CONFIG_HANDLERS.create,
      createConfigProfileInputSchema,
      async (input): Promise<ConfigProfile[]> => {
        const list = withLiveAssignments(profiles.create(input))
        // The new profile is the LAST element: `ProfilesStore.create` appends it
        // to the end of the array it hands `commit()`, and every transform in
        // between - `commit()`'s `.map`, `reconcileAssignments`' `.map` - is
        // order-preserving and never adds or drops an entry.
        const created = list[list.length - 1]!
        // Still writes immediately, and deliberately so (story 043 D4): a brand-new profile has no
        // canonical file yet, and the file is what the profile *is* now - `state.json` being only a
        // cache, a profile whose file was never written would be lost by the very rebuild pass that
        // makes the cache disposable. It is not dirty at this point, so the write goes through.
        await syncAndPersist(app, log, profiles, created, list)
        return list
      },
    )

    /**
     * Story 043 D4: a rename changes what the file is *called* as well as what it says, so it is
     * still a content mutation as far as the file goes - and it stops touching disk like the rest.
     * Until the user saves, the canonical file keeps its old name (its sentinel still identifies the
     * profile, which is how `save` and the sync engine find it again); the rename of the file, and
     * the cascade for any sibling this displaces, happen inside that save.
     */
    handle(CONFIG_HANDLERS.rename, renameConfigProfileInputSchema, (input): ConfigProfile[] => {
      // A rename cannot remove the profile, so it is always in the new list.
      profiles.rename(input)
      return markUnsaved(input.id)
    })

    handle(CONFIG_HANDLERS.remove, removeConfigProfileInputSchema, async (
      input,
    ): Promise<ConfigProfile[]> => {
      const list = withLiveAssignments(profiles.remove(input))

      // Nothing left to sync for the removed profile, so instead of a sync run:
      // delete its canonical file and drop its now-stale bookkeeping. All of it
      // best-effort - a failure here must never turn a completed removal into a
      // failed IPC response.
      //
      // Documented simplification: per-installation copies of the removed
      // profile are NOT deleted here. They are cleaned up by
      // `reconcileOwnedProfileFiles` inside `syncProfile` the next time that
      // installation is synced for any other reason.
      try {
        await removeCanonicalProfileFile(userDataDir(), input.id)
      } catch (error) {
        log.error(`failed to remove canonical profile file for ${input.id}`, error)
      }
      try {
        const failures = app.state.configWriteFailures()
        const keptFailures = Object.fromEntries(
          Object.entries(failures).filter(([key]) => !key.startsWith(`${input.id}|`)),
        )
        if (Object.keys(keptFailures).length !== Object.keys(failures).length) {
          app.state.setConfigWriteFailures(keptFailures)
        }
        const pending = app.state.configPendingWrites()
        const keptPending = Object.fromEntries(
          Object.entries(pending).filter(([, profileId]) => profileId !== input.id),
        )
        if (Object.keys(keptPending).length !== Object.keys(pending).length) {
          app.state.setConfigPendingWrites(keptPending)
        }
      } catch (error) {
        log.error(`failed to drop stale sync bookkeeping for removed profile ${input.id}`, error)
      }

      return list
    })

    handle(CONFIG_HANDLERS.setCvars, setProfileCvarsInputSchema, (input): ConfigProfile[] => {
      profiles.setCvars(input)
      return markUnsaved(input.profileId)
    })

    handle(CONFIG_HANDLERS.setBinds, setProfileBindsInputSchema, (input): ConfigProfile[] => {
      profiles.setBinds(input)
      return markUnsaved(input.profileId)
    })

    handle(CONFIG_HANDLERS.setLayers, setProfileLayersInputSchema, (input): ConfigProfile[] => {
      profiles.setLayers(input)
      return markUnsaved(input.profileId)
    })

    handle(CONFIG_HANDLERS.setActions, setProfileActionsInputSchema, (input): ConfigProfile[] => {
      profiles.setActions(input)
      return markUnsaved(input.profileId)
    })

    // Story 040 D4: a dedicated setter for one boolean, not routed through the whole-field
    // replace setters above - same "genuinely new handler" shape as `setPlayedMods`/
    // `setSwitchBind` further down, but this one is write-affecting (it changes what
    // `renderProfileFile` emits), so it is a content mutation exactly like
    // `setCvars`/`setBinds`/`setLayers`/`setActions` and takes the same `markUnsaved` tail (story
    // 043 D4) rather than the plain state write those two use.
    handle(
      CONFIG_HANDLERS.setWriteUnbindall,
      setWriteUnbindallInputSchema,
      (input): ConfigProfile[] => {
        profiles.setWriteUnbindall(input)
        return markUnsaved(input.profileId)
      },
    )

    // Story 042 D7: mirrors `setWriteUnbindall` right above exactly - a dedicated setter for one
    // field, write-affecting (it changes which decoration `renderProfileFile` draws around every
    // section banner), so it takes the same `markUnsaved` tail. Story 043 D4's acceptance list does
    // not name this handler, but its being write-affecting is the whole reason it went through
    // `syncAndPersist` before; leaving it as the one content setter that still stamps the file
    // immediately would be an inconsistency the plan clearly did not intend.
    handle(
      CONFIG_HANDLERS.setSectionHeaderStyle,
      setSectionHeaderStyleInputSchema,
      (input): ConfigProfile[] => {
        profiles.setSectionHeaderStyle(input)
        return markUnsaved(input.profileId)
      },
    )

    /**
     * Story 049 D3: discard - restores a profile's pending edits to its last-saved/loaded baseline,
     * without touching any file. Deliberately does NOT go through `markUnsaved`/`syncAndPersist`:
     * discard writes nothing to disk (the story's explicit requirement - "It never writes to the
     * file"), so it needs neither the dirty-marking tail every content setter above ends in (the
     * profile comes back out of `discard` already clean) nor a sync run.
     *
     * `profiles.discard` throws only for an unknown profile id, same as every other setter; the
     * "no baseline to discard from" case is a typed result, not an error, and is reported as such
     * rather than mapped onto `fail(...)`.
     */
    handle(
      CONFIG_HANDLERS.discard,
      discardProfileInputSchema,
      (input): DiscardProfileResult => {
        const outcome = profiles.discard(input.profileId)
        if (outcome.outcome === 'noBaseline') return { status: 'noBaseline' }
        return { status: 'discarded', profiles: withLiveAssignments(outcome.profiles) }
      },
    )

    handle(CONFIG_HANDLERS.assign, assignProfileInputSchema, async (
      input,
    ): Promise<Outcome<ConfigProfile[]>> => {
      if (!app.installations.find(input.installationId)) {
        return fail('config.error.installationNotFound')
      }
      let list: ConfigProfile[]
      try {
        list = withLiveAssignments(profiles.assign(input))
      } catch {
        // Nothing was mutated, so there is nothing to sync.
        return fail('config.error.profileNotFound')
      }
      await syncAndPersist(
        app,
        log,
        profiles,
        list.find((p) => p.id === input.profileId)!,
        list,
      )
      return ok(list)
    })

    handle(CONFIG_HANDLERS.unassign, unassignProfileInputSchema, async (
      input,
    ): Promise<Outcome<ConfigProfile[]>> => {
      if (!app.installations.find(input.installationId)) {
        return fail('config.error.installationNotFound')
      }
      let list: ConfigProfile[]
      try {
        list = withLiveAssignments(profiles.unassign(input))
      } catch {
        return fail('config.error.profileNotFound')
      }
      // Covers the profile's own canonical file plus its remaining assignments.
      await syncAndPersist(
        app,
        log,
        profiles,
        list.find((p) => p.id === input.profileId)!,
        list,
      )

      // The unassigned-from installation's own orphaned copy is only removed by
      // `reconcileOwnedProfileFiles`, which runs while syncing a profile that is
      // still assigned there - so sync its current default too.
      //
      // Documented simplification: when nothing is assigned to that
      // installation any more there is no such profile, and the orphaned file
      // is left for a future sync of that installation.
      const stillDefault = defaultProfileFor(list, input.installationId)
      if (stillDefault && stillDefault.id !== input.profileId) {
        await syncAndPersist(app, log, profiles, stillDefault, list)
      }
      return ok(list)
    })

    handle(CONFIG_HANDLERS.setDefault, setDefaultProfileInputSchema, async (
      input,
    ): Promise<Outcome<ConfigProfile[]>> => {
      if (!app.installations.find(input.installationId)) {
        return fail('config.error.installationNotFound')
      }
      let list: ConfigProfile[]
      try {
        list = withLiveAssignments(profiles.setDefault(input))
      } catch (error) {
        // The thrown message is the only way to tell "unknown profile" apart
        // from "profile exists but isn't assigned to that installation" -
        // `assignments.ts` throws a plain `Error` in both cases (see
        // `requireProfile` vs the not-assigned check in `setDefault`).
        const notAssigned =
          error instanceof Error && error.message.includes('is not assigned to installation')
        return fail(notAssigned ? 'config.error.notAssigned' : 'config.error.profileNotFound')
      }
      // The profile that just became default is still assigned to this
      // installation, so syncing it rewrites every profile assigned there
      // (including the previous default) plus the loader - which is all a
      // default change can affect.
      await syncAndPersist(
        app,
        log,
        profiles,
        list.find((p) => p.id === input.profileId)!,
        list,
      )
      return ok(list)
    })

    handle(
      CONFIG_HANDLERS.write,
      writeProfileInputSchema,
      async (input): Promise<Outcome<WriteTargetResult[]>> => {
      const profile = profiles.find(input.profileId)
      if (!profile) return fail('config.error.profileNotFound')

      // Story 022: `write` is one of the three retry triggers (decision 13), so
      // it goes through the same sync engine every mutation does now - not the
      // pre-022 `writeProfileToAssignedInstallations` (which never touches the
      // canonical file or `configWriteFailures`, and so could never actually
      // clear a persisted failure a user just retried away). That old function
      // stays exported/tested above; nothing in this module calls it anymore.
      //
      // Story 043 D4: still a retry trigger, and still not a *save*. A retry re-attempts the
      // installation copies from what the canonical file says; if the profile carries unsaved edits,
      // `syncAndPersist`'s per-profile rule leaves that file alone and the copies are written from
      // its on-disk bytes, so retrying can never publish an edit the user has not saved.
      const state = await syncAndPersist(app, log, profiles, profile, profiles.list())
      if (!state) return fail('config.error.writeFailed')

      const results: WriteTargetResult[] = state.installations.map((entry) => ({
        installationId: entry.installationId,
        // `inSync` is the only "this installation is now correctly set up"
        // status a fresh sync attempt can report, so it maps to `written` for
        // this legacy shape's consumers; `outOfSync`/`missing` right after an
        // attempted write means something did not take effect and is reported
        // as an error rather than silently claiming success. `syncState`
        // (story 022 D5/D7) is the accurate, live source of truth going
        // forward - this mapping only keeps `write`'s existing contract alive.
        status: entry.status === 'inSync' ? 'written' : entry.status === 'pending' ? 'pending' : 'error',
        ...(entry.messageKey ? { messageKey: entry.messageKey } : {}),
      }))
      return ok(results)
      },
    )

    /**
     * Story 043 D4: the explicit save - the only thing in this module that writes profile
     * *content* to disk now, and the deliberate inversion of story 022 decision 8.
     *
     * Read before write, in this order, because the order IS the guarantee (AC5: "the launcher
     * never overwrites a hand-edit it has not read"):
     *
     * 1. Find the file that actually carries this profile's ownership sentinel
     *    (`readCanonicalOwnership`), not merely the name the profile *resolves* to. A rename now
     *    only marks the profile dirty, so a renamed-but-unsaved profile's file still sits under its
     *    old name - checking the resolved name would find nothing there, call that "missing" and
     *    write straight over a hand-edit of the old file. This lookup is what closes that hole.
     * 2. Classify it against the cached `fileHash` (`readFileState`, story D2). `unchanged` and
     *    `missing` are both "ours to write": nothing changed underneath us, or there is nothing
     *    there to conflict with (including the story's "rewrite it from cache" case for a file
     *    deleted outside the launcher - pressing Save *is* that instruction).
     * 3. `changedOnDisk` refuses and answers a conflict carrying both whole files, the decided
     *    whole-file granularity; the profile stays dirty and `state.json` is left exactly as it is,
     *    so nothing about the user's unsaved edits is lost by refusing.
     * 4. `unparseable`/`readError` also refuse: a file we cannot read is as much "a hand-edit we
     *    have not read" as a changed one. Reported, never written over.
     *
     * Only then is `dirty` cleared, and only so the ordinary sync run below is allowed to write the
     * canonical file at all (`syncAndPersist`'s per-profile rule) - the installation cascade itself
     * is completely unchanged, which is what keeps AC6 true: the copies come from the same
     * canonical content this save just put on disk. The write is then *verified* by reading it back
     * (`own.status`, the sync engine's own "trust the disk") before the profile is called saved; on
     * anything less the profile goes straight back to dirty rather than being remembered as saved
     * when it is not.
     *
     * Story 043 D8: `input.force` is the "overwrite with my version" resolution of
     * `ConfigConflictDialog` - it skips steps 2-4 above entirely (no re-read, no conflict, no
     * unreadable refusal) and goes straight to the write, since the user has already been shown
     * whatever is on disk and explicitly chosen to replace it regardless of what it now says.
     */
    handle(
      CONFIG_HANDLERS.save,
      saveProfileInputSchema,
      async (input): Promise<Outcome<SaveProfileResult>> => {
        const profile = profiles.find(input.profileId)
        if (!profile) return fail('config.error.profileNotFound')

        const baseDir = userDataDir()
        // `profile` came out of the list, so this lookup cannot miss.
        const resolvedName = resolveProfileFileNames(profiles.list()).get(profile.id)!

        let ownedName: string | undefined
        try {
          ownedName = (await readCanonicalOwnership(baseDir)).get(profile.id)
        } catch (error) {
          // The canonical directory itself could not be listed (a permissions problem, something
          // in the way of the directory). Nothing is written on a disk we cannot survey.
          log.error(`failed to survey the canonical directory before saving ${profile.id}`, error)
          return ok({
            status: 'unreadable',
            fileName: resolvedName,
            path: join(baseDir, resolvedName),
            reason: 'readError',
            message: error instanceof Error ? error.message : String(error),
          })
        }
        const fileName = ownedName ?? resolvedName
        const path = join(baseDir, fileName)

        if (input.force !== true) {
          const read = await readFileState(baseDir, fileName, profile.fileHash)
          if (read.state === 'changedOnDisk') {
            return ok({
              status: 'conflict',
              fileName,
              path,
              diskContent: read.content,
              ourContent: renderProfileFile(profile),
            })
          }
          if (read.state === 'unparseable') {
            return ok({
              status: 'unreadable',
              fileName,
              path,
              reason: 'unparseable',
              line: read.line,
              message: read.message,
            })
          }
          if (read.state === 'readError') {
            return ok({
              status: 'unreadable',
              fileName,
              path,
              reason: 'readError',
              message:
                read.error instanceof Error ? read.error.message : String(read.error),
            })
          }
        }

        // `unchanged` or `missing`, or `force === true`: the file is ours to write.
        const list = withLiveAssignments(profiles.setDirty(profile.id, false))
        // `setDirty` throws on an unknown id and cannot remove the profile, so this cannot miss.
        const target = list.find((p) => p.id === profile.id)!
        // Story 043 D10: `force` is the conflict dialog's "overwrite with my version", so this one
        // profile's file may be written over even though its bytes are not ones we ever read - the
        // user was shown them and chose this. Without the opt-in, `syncAndPersist`'s own
        // never-overwrite-an-unread-hand-edit rule would (correctly) refuse the very write the user
        // just asked for. Not passed on the ordinary path: there the re-read above already
        // established that the file is exactly what we last saw.
        const state = await syncAndPersist(
          app,
          log,
          profiles,
          target,
          list,
          input.force === true ? { overwriteProfileId: profile.id } : {},
        )
        if (!state || state.own.status !== 'inSync') {
          // The file on disk is not what this profile says, so the edits are still unsaved. Says so,
          // rather than reporting a save that did not happen - `configWriteFailures` already carries
          // the why, and the next save (or any retry trigger) will try again.
          profiles.setDirty(profile.id, true)
          return fail('config.error.writeFailed')
        }
        // Re-read the record: `syncAndPersist` seeded `fileHash`/`fileSeenAt` from the bytes it just
        // confirmed on disk, and the caller wants the profile as it now stands - through
        // `withLiveAssignments`, the same view of it every other handler returns.
        const saved = withLiveAssignments(profiles.list()).find((p) => p.id === profile.id) ?? target
        return ok({ status: 'saved', profile: saved, sync: state })
      },
    )

    /**
     * Story 043 D5: the re-read side of the story's "re-read on window focus, tab open, and before
     * write" decision. `input.profileId` scopes the check to that one profile (the story's own
     * "Decided during refine": window focus/tab open re-read only the selected profile, so focus
     * latency does not scale with the profile count); omitted, every profile is checked (a later
     * deliverable's startup call site).
     *
     * Never writes profile *content* other than the display-hint bookkeeping documented on
     * `ProfilesStore.setFileState`/`adoptFromFile` below, and never deletes a profile record - a
     * missing or unparseable file leaves the cache exactly as usable as it was a moment ago.
     */
    handle(
      CONFIG_HANDLERS.refreshFromFiles,
      refreshFromFilesInputSchema,
      async (input): Promise<Outcome<RefreshFromFilesResult>> => {
        const allProfiles = profiles.list()
        if (input.profileId !== undefined && !allProfiles.some((p) => p.id === input.profileId)) {
          return fail('config.error.profileNotFound')
        }
        const targets = input.profileId
          ? allProfiles.filter((p) => p.id === input.profileId)
          : allProfiles
        const fileNames = resolveProfileFileNames(allProfiles)
        const baseDir = userDataDir()

        // Story 043 D10: the file each profile's ownership sentinel actually sits in - the same
        // lookup `save` above does, and for the same reason. A rename only marks the profile dirty
        // (D4), so a renamed-but-unsaved profile's canonical file is still under its PREVIOUS name;
        // classifying the resolved name instead reported that profile as `missing`, which is how the
        // UI ends up offering "Remove profile" for a file that was never gone. A directory that
        // cannot be surveyed degrades to the resolved names rather than failing the whole refresh -
        // each per-profile read below still classifies its own file honestly.
        let ownership: ReadonlyMap<string, string>
        try {
          ownership = await readCanonicalOwnership(baseDir)
        } catch (error) {
          log.error('failed to survey the canonical directory before a file refresh', error)
          ownership = new Map()
        }

        const results: RefreshedProfileResult[] = []
        for (const profile of targets) {
          // `profile` came out of `allProfiles`, so the fallback lookup cannot miss.
          const fileName = ownership.get(profile.id) ?? fileNames.get(profile.id)!
          const read = await readFileState(baseDir, fileName, profile.fileHash)

          if (read.state === 'unchanged') {
            // Nothing to do: the cached hash already matches the disk bytes, and the cached
            // `fileState` is already `'unchanged'` from whatever previous read/write/adopt got it
            // there. Calling `markFileSeen` again would be harmless but pointless churn.
            results.push({ profileId: profile.id, outcome: 'unchanged', fileState: 'unchanged' })
            continue
          }

          if (read.state === 'changedOnDisk') {
            // Story 043 D8: `discardLocalEdits` is the "take the file" resolution of
            // `ConfigConflictDialog` - the user has already been shown both whole-file versions
            // and chosen to throw their own edits away, so a dirty profile no longer refuses here.
            const discardingLocalEdits = profile.dirty === true && input.discardLocalEdits === true
            if (profile.dirty === true && !discardingLocalEdits) {
              // A genuine conflict: unsaved UI edits AND a disk change. Adopt nothing, touch
              // nothing about the cached profile - same whole-file shape `save` (D4) returns for
              // its own `changedOnDisk` refusal.
              results.push({
                profileId: profile.id,
                outcome: 'conflict',
                fileState: 'changedOnDisk',
                conflict: {
                  status: 'conflict',
                  fileName,
                  path: join(baseDir, fileName),
                  diskContent: read.content,
                  ourContent: renderProfileFile(profile),
                },
              })
              continue
            }

            if (discardingLocalEdits) {
              // `adoptFromFile` below deliberately leaves `dirty` alone (its own doc comment: "the
              // caller only reaches this method when the profile was not dirty in the first
              // place") - true for the ordinary adopt path, not for this one, so `dirty` is cleared
              // explicitly here before the overlay.
              profiles.setDirty(profile.id, false)
            }

            // No unsaved edits (or edits just explicitly discarded): adopt the disk version into
            // the cache. The file-carried fields
            // (name, cvars/binds/actions/categories/layers, writeUnbindall, sectionHeaderStyle) are
            // recovered the same way `rebuild.ts`'s startup rebuild recovers them for a brand-new
            // record; unlike that path, a missing/undetected style falls back to the profile's
            // *current* value rather than being omitted, since there is an existing value here to
            // preserve rather than a fresh record's implicit default.
            const list = withLiveAssignments(
              profiles.adoptFromFile(
                profile.id,
                {
                  name: recoverProfileName(read.content) ?? profile.name,
                  cvars: read.profile.cvars,
                  binds: read.profile.binds,
                  actions: read.profile.actions,
                  categories: read.profile.categories,
                  layers: read.profile.layers,
                  writeUnbindall: detectWriteUnbindall(read.content),
                  sectionHeaderStyle:
                    detectSectionHeaderStyle(read.content) ?? profile.sectionHeaderStyle,
                },
                read.hash,
                Date.now(),
              ),
            )
            // `adoptFromFile` throws on an unknown id and cannot remove the profile, so this
            // cannot miss.
            const adopted = list.find((p) => p.id === profile.id)!
            // Story-050 review (finding 4, second round): an `alias` name the file defined twice
            // cost the adopt one entry's commands before `readFileState` ever got to reconstruct the
            // profile - reported so the UI can say so, and logged so a support copy of the log says
            // it too. Deduplicated by name: the field names *which* alias collided, and one name
            // repeated three times is still one thing to tell the user about.
            const droppedAliases = [
              ...new Set(
                read.profile.warnings
                  .filter((warning) => warning.reason === 'entry-alias-duplicate')
                  .map((warning) => warning.subject)
                  .filter((subject): subject is string => subject !== undefined),
              ),
            ]
            for (const warning of read.profile.warnings) {
              if (warning.reason !== 'entry-alias-duplicate') continue
              log.warn(
                `refresh: alias "${warning.subject}" is defined more than once in ${warning.file}; ` +
                  `the definition at line ${warning.line} was discarded (profile ${profile.id})`,
              )
            }
            results.push({
              profileId: profile.id,
              outcome: 'adopted',
              fileState: 'changedOnDisk',
              profile: adopted,
              droppedAliases,
            })
            continue
          }

          if (read.state === 'unparseable') {
            // The last good cache stays exactly as it is - only the display hint changes.
            profiles.setFileState(profile.id, 'unparseable')
            results.push({
              profileId: profile.id,
              outcome: 'unparseable',
              fileState: 'unparseable',
              file: read.file,
              line: read.line,
              message: read.message,
            })
            continue
          }

          if (read.state === 'missing') {
            // Never deletes the record - the story's own decision keeps it in the list, marked
            // "file missing", awaiting the user's "rewrite from cache" or "remove profile".
            profiles.setFileState(profile.id, 'missing')
            results.push({ profileId: profile.id, outcome: 'missing', fileState: 'missing' })
            continue
          }

          // `readError`: treated exactly as conservatively as `unparseable` - reported, nothing
          // else about the cached profile touched.
          profiles.setFileState(profile.id, 'readError')
          results.push({
            profileId: profile.id,
            outcome: 'readError',
            fileState: 'readError',
            message: read.error instanceof Error ? read.error.message : String(read.error),
          })
        }

        return ok(results)
      },
    )

    handle(
      CONFIG_HANDLERS.preview,
      previewProfileInputSchema,
      async (input): Promise<Outcome<PreviewProfileResult>> => {
      const profile = profiles.find(input.profileId)
      if (!profile) return fail('config.error.profileNotFound')
      const installation = app.installations.find(input.installationId)
      if (!installation) return fail('config.error.installationNotFound')

      const files = previewProfileFiles(
        profile,
        profiles.list(),
        installation,
        app.state.configSwitchBinds()[installation.id],
      )
      return ok({
        files: await Promise.all(
          files.map(async (file) => ({ ...file, onDisk: await isFile(file.path) })),
        ),
      })
      },
    )

    handle(CONFIG_HANDLERS.writeState, writeStateInputSchema, (): WriteState =>
      app.state.configPendingWrites(),
    )

    /**
     * Story 022 D7: read-only report of where every copy of this profile stands.
     *
     * Deliberately NOT built on `syncProfile`, which writes: the story names
     * exactly three retry triggers (a profile mutation, `setup()` at start, and
     * the `write` channel) and this is not one of them. Merely looking at a
     * profile's sync state must never touch disk.
     */
    handle(
      CONFIG_HANDLERS.syncState,
      syncStateInputSchema,
      async (input): Promise<Outcome<ProfileSyncState>> => {
      const profile = profiles.find(input.profileId)
      if (!profile) return fail('config.error.profileNotFound')

      const allProfiles = profiles.list()
      const fileNames = resolveProfileFileNames(allProfiles)
      // `profile` came out of `allProfiles`, so this lookup cannot miss.
      const fileName = fileNames.get(profile.id)!
      const failures = app.state.configWriteFailures()
      const expectedContent = renderProfileFile(profile)

      const ownPath = join(userDataDir(), fileName)
      const own = await readSyncFileStatus(ownPath, expectedContent, failures[`${profile.id}|own`])

      // Story 043 D4: an installation copy is generated output of the CANONICAL FILE (AC6), so for a
      // profile carrying unsaved edits it is judged against that file's bytes - exactly what
      // `sync.ts` writes there for such a profile. Comparing it against the unsaved render instead
      // would report every installation of a dirty profile as `outOfSync` with a Retry that could
      // never clear it (the retry rewrites the canonical bytes, which is what is already there),
      // and it would disagree with the status the sync run itself just reported for the same file.
      // The canonical row is the one that shows the unsaved edits, and still does: `own` above is
      // deliberately still compared against the render.
      //
      // `readExisting` swallows only ENOENT, and the fall-back to the render then covers the two
      // cases where no canonical bytes exist to judge against: no file yet, and a
      // renamed-but-unsaved profile whose file still sits under its previous name.
      const expectedCopyContent =
        (profile.dirty === true ? await readExisting(ownPath) : null) ?? expectedContent

      const launchState = app.launch.getState()
      const installations: ProfileInstallationSync[] = []
      for (const assignment of profile.assignments) {
        const installation = app.installations.find(assignment.installationId)
        // An assignment pointing at an installation that no longer exists is
        // reconciled away elsewhere, not reported as a sync problem here.
        if (!installation) continue
        const path = join(installation.rootPath, BASE_GAME_DIR, fileName)
        if (isInstallationRunning(launchState, installation.id)) {
          installations.push({
            installationId: installation.id,
            path,
            fileName,
            status: 'pending',
            messageKey: 'config.error.installationRunning',
          })
          continue
        }
        const result = await readSyncFileStatus(
          path,
          expectedCopyContent,
          failures[`${profile.id}|${installation.id}`],
        )
        installations.push({ installationId: installation.id, path, fileName, ...result })
      }

      return ok({ own: { path: ownPath, fileName, ...own }, installations })
      },
    )

    /**
     * Story 023 D1: read-only report of the profile's own canonical file plus
     * one entry per assigned installation, for the Raw File tab. Same
     * never-writes contract as `syncState` above - `collectRawFiles` only
     * reads.
     */
    handle(
      CONFIG_HANDLERS.rawFiles,
      rawFilesInputSchema,
      async (input): Promise<Outcome<RawFilesResult>> => {
      const profile = profiles.find(input.profileId)
      if (!profile) return fail('config.error.profileNotFound')

      const result = await collectRawFiles(
        profile,
        profiles.list(),
        app.installations,
        userDataDir(),
        (installationId) => app.state.configPlayedMods()[installationId] ?? [],
      )
      return ok(result)
      },
    )

    /**
     * Story 023 D2: hand one of this profile's files to the OS - the default
     * application for `.cfg` (`mode: 'open'`) or the file manager with the file
     * selected (`mode: 'reveal'`). Mirrors `app:revealPath`
     * (`src/main/ipc/app.ts`), minus its directory branch: the target here is
     * always a file.
     *
     * This is the module's one privileged path, so the order below is the whole
     * point of it (AC 8):
     *
     * 1. The payload carries ids only - no path field exists to be trusted. The
     *    path is resolved here, from main's own profile list and installation
     *    registry, exactly the way `collectRawFiles`/`syncState` resolve it, so
     *    the renderer cannot aim this at a file of its choosing even if it
     *    wanted to.
     * 2. A non-null `installationId` must be an installation that exists AND is
     *    one this profile is actually assigned to - an id that merely exists is
     *    refused, since a copy of this profile's file is only ever expected
     *    where it is assigned.
     * 3. The file must exist and its first line must be this profile's exact
     *    sentinel. A file that exists at the resolved path but is NOT this
     *    profile's own (a hand-written file, or another profile's canonical file
     *    at a not-yet-reconciled name - the case `canonical.ts` reconciles at
     *    write time) is reported as `fileNotFound`, never opened or revealed:
     *    the same exact-sentinel rule `canonical.ts` uses before it renames or
     *    deletes anything, applied here before handing a path to the OS.
     *
     * Only then is `shell` touched at all.
     */
    handle(
      CONFIG_HANDLERS.openFile,
      openFileInputSchema,
      async (input): Promise<Outcome<null>> => {
      const { profileId, installationId, mode } = input

      const allProfiles = profiles.list()
      const profile = allProfiles.find((p) => p.id === profileId)
      if (!profile) return fail('config.error.profileNotFound')
      // `profile` came out of `allProfiles`, so this lookup cannot miss.
      const fileName = resolveProfileFileNames(allProfiles).get(profile.id)!

      let path: string
      if (installationId === null) {
        path = join(userDataDir(), fileName)
      } else {
        const installation = app.installations.find(installationId)
        const isAssigned = profile.assignments.some((a) => a.installationId === installationId)
        // Both misses collapse into one key on purpose: from the caller's side
        // "no such installation" and "that installation is not a target of this
        // profile" are the same answer - not a valid target for this profile.
        if (!installation || !isAssigned) return fail('config.error.installationNotFound')
        path = join(installation.rootPath, BASE_GAME_DIR, fileName)
      }

      // Defence in depth, not a live check: `resolveProfileFileNames` only ever
      // produces `<base>.cfg`. It is here so that a future change to the name
      // resolver can never quietly turn this handler into one that hands the OS
      // something other than a config file.
      if (!path.toLowerCase().endsWith('.cfg')) return fail('config.error.fileNotFound')

      // `readExisting` is the write pipeline's own ENOENT-only-swallowed read,
      // so "missing" means the same thing here as it does to `rawFiles`. A read
      // that fails for any OTHER reason propagates and the registry turns it
      // into a failed outcome - which is the right direction: no `shell` call
      // happens on a file we could not verify.
      const content = await readExisting(path)
      if (content === null) return fail('config.error.fileNotFound')
      if (ownedProfileId(content.split('\n', 1)[0]) !== profile.id) {
        return fail('config.error.fileNotFound')
      }

      if (mode === 'open') {
        const error = await shell.openPath(path)
        return error ? fail('config.error.openFailed', { message: error }) : ok(null)
      }
      // No error signal to surface - `showItemInFolder` returns void, same as
      // `app:revealPath`'s own reveal branch.
      shell.showItemInFolder(path)
      return ok(null)
      },
    )

    handle(
      CONFIG_HANDLERS.setPlayedMods,
      setPlayedModsInputSchema,
      (input): Outcome<string[]> => {
      const installation = app.installations.find(input.installationId)
      if (!installation) return fail('config.error.installationNotFound')

      const validated = validatePlayedMods(installation.gameDirs, input.playedMods)
      app.state.setConfigPlayedMods({
        ...app.state.configPlayedMods(),
        [installation.id]: validated,
      })
      return ok(validated)
      },
    )

    // Story 007: which key (if any) cycles an installation's assigned
    // profiles in-session. Per-installation, not part of a profile (decision
    // 1) - see `SetSwitchBindInput`'s doc comment.
    handle(
      CONFIG_HANDLERS.switchBinds,
      switchBindsInputSchema,
      (): Record<string, string> => app.state.configSwitchBinds(),
    )

    handle(
      CONFIG_HANDLERS.setSwitchBind,
      setSwitchBindInputSchema,
      async (input): Promise<Outcome<Record<string, string>>> => {
        const installation = app.installations.find(input.installationId)
        if (!installation) return fail('config.error.installationNotFound')

        const current = app.state.configSwitchBinds()
        const next = { ...current }
        if (input.key === null) delete next[installation.id]
        else next[installation.id] = input.key
        app.state.setConfigSwitchBinds(next)

        // Decision 12/13: write immediately for this one installation only,
        // through the unchanged story-004 pipeline (`writeInstallationFiles`);
        // this never touches `assignments`/`isDefault` on any profile - the
        // installation's default is only ever changed by `setDefault` above.
        //
        // Judgment call: unlike `writeProfileToAssignedInstallations`, this does
        // NOT consult `isInstallationRunning`/skip-and-mark-pending. There is no
        // pending-writes-shaped map keyed for "a switch-bind change, not a
        // profile save" and decision 12 does not ask for one; the write below is
        // still safe while the game is running (loader files are not open for
        // exclusive access), it just means the running instance keeps whatever
        // chain it already loaded until its next launch - the same story-004
        // precedent AC3 relies on for the default profile itself.
        const allProfiles = profiles.list()
        const defaultProfile = defaultProfileFor(allProfiles, installation.id)
        if (defaultProfile) {
          const fileNames = resolveProfileFileNames(allProfiles)
          const assignedProfiles = assignedProfilesFor(allProfiles, installation.id).map((p) => ({
            ...p,
            // Every assigned profile comes from `allProfiles`, which
            // `fileNames` was resolved from above, so this lookup cannot miss.
            fileName: fileNames.get(p.id)!,
          }))
          const switchBindKey = next[installation.id]
          try {
            await writeInstallationFiles({
              installation,
              // `defaultProfile` is drawn from `allProfiles` above, so this
              // lookup cannot miss.
              profileFileName: fileNames.get(defaultProfile.id)!,
              profileFileContent: renderProfileFile(defaultProfile),
              loaderFileContent: renderLoaderFile(
                defaultProfile,
                fileNames.get(defaultProfile.id)!,
                switchBindKey
                  ? {
                      key: switchBindKey,
                      profiles: assignedProfiles,
                      defaultProfileId: defaultProfile.id,
                    }
                  : undefined,
              ),
              playedMods: app.state.configPlayedMods()[installation.id] ?? [],
            })
          } catch (error) {
            log.error(`failed to write switch bind for installation ${installation.id}`, error)
            return fail('config.error.writeFailed')
          }
        }
        return ok(next)
      },
    )

    // Story 005: read-only import of a hand-written config into a new
    // profile. `import.ts` holds the fs-touching logic so it stays testable
    // without booting this module; this handler only validates the payload
    // shape and (for commit) reconciles live assignments the same way every
    // other profile-list-returning handler does.
    handle(
      CONFIG_HANDLERS.importScan,
      importScanInputSchema,
      (input): Promise<Outcome<ImportScanResult>> => scanImportCandidates(app.installations, input),
    )

    handle(
      CONFIG_HANDLERS.importPreview,
      importPreviewInputSchema,
      (input): Promise<Outcome<ImportPreviewResult>> => previewImport(app.installations, log, input),
    )

    handle(
      CONFIG_HANDLERS.importCommit,
      importCommitInputSchema,
      async (input): Promise<Outcome<ConfigProfile[]>> => {
      const result = await commitImport(app.installations, log, input, (seed) =>
        profiles.createFromImport(seed),
      )
      // Nothing was created, so there is nothing to sync.
      if (!result.ok) return result

      const list = withLiveAssignments(result.value)
      // Same append-only reasoning as `create` above: `createFromImport`
      // appends the new profile last and every transform in between is an
      // order-preserving `.map`. It has no assignments yet, so this sync only
      // writes its canonical file.
      await syncAndPersist(app, log, profiles, list[list.length - 1]!, list)
      return ok(list)
      },
    )

    // Story 010: find and remove mod-folder `.cfg` copies that duplicate a
    // same-named `baseq2` file. `cleanup.ts` holds the fs-touching logic
    // (D1/D2, already tested against a real temp tree there); these handlers
    // only validate the payload, resolve the real installation and - for
    // `apply`/`restore` only, never for the read-only `scan` (decision 12) -
    // refuse a currently-running installation the same way `write` does.
    handle(
      CONFIG_HANDLERS.cleanupScan,
      cleanupScanInputSchema,
      async (input): Promise<Outcome<CleanupScanResult>> => {
      const installation = app.installations.find(input.installationId)
      if (!installation) return fail('config.error.installationNotFound')

      const findings = await scanRedundantCopies(installation)
      return ok({ findings })
      },
    )

    handle(
      CONFIG_HANDLERS.cleanupApply,
      cleanupApplyInputSchema,
      async (input): Promise<Outcome<CleanupApplyResult>> => {
      const installation = app.installations.find(input.installationId)
      if (!installation) return fail('config.error.installationNotFound')

      return applyCleanupIfNotRunning(installation, input.entries, app.launch.getState())
      },
    )

    handle(
      CONFIG_HANDLERS.cleanupRestore,
      cleanupRestoreInputSchema,
      async (input): Promise<Outcome<CleanupRestoreResult>> => {
        const installation = app.installations.find(input.installationId)
        if (!installation) return fail('config.error.installationNotFound')

        return restoreCleanupIfNotRunning(installation, input.entries, app.launch.getState())
      },
    )

    /**
     * Story 025 D3: one atomic tidy-up batch. The only mutating config handler
     * that is not a whole-field setter, for the reason decision 10 gives - a
     * re-classify writes `unrecognized` plus one of `cvars`/`binds`/`actions` in
     * the same result, and two setter calls would bump `updatedAt` twice and
     * write two half-tidied files to every assigned installation.
     *
     * The shape it enforces:
     *
     * - `applyTidyUpOps` (pure, `@shared/config/tidy-up`) re-checks every op
     *   against the *current* profile and returns stale ones in `rejected`
     *   rather than throwing (decision 11) - so this handler has no per-op error
     *   path at all, only a payload-shape one.
     * - Exactly one `updatedAt`, one `replaceProfile` commit and one
     *   `syncAndPersist` run for the whole batch, however many ops applied.
     * - Nothing applied means nothing changed: no timestamp bump, no commit, no
     *   sync run, and the profile is returned as it stands (with live
     *   assignments, same as every other handler's view of it) alongside the
     *   rejects, so the caller can re-scan.
     */
    handle(
      CONFIG_HANDLERS.tidyUpApply,
      tidyUpApplyInputSchema,
      async (input): Promise<Outcome<TidyUpApplyResult>> => {
      const current = profiles.find(input.profileId)
      if (!current) return fail('config.error.profileNotFound')

      const outcome = applyTidyUpOps(current, input.ops)
      if (outcome.applied.length === 0) {
        const list = withLiveAssignments(profiles.list())
        return ok({
          profile: list.find((p) => p.id === current.id) ?? current,
          applied: [],
          rejected: outcome.rejected,
        })
      }

      const list = withLiveAssignments(
        profiles.replaceProfile({ ...outcome.profile, updatedAt: new Date().toISOString() }),
      )
      const updated = list.find((p) => p.id === current.id)!
      await syncAndPersist(app, log, profiles, updated, list)
      return ok({ profile: updated, applied: outcome.applied, rejected: outcome.rejected })
      },
    )

    /**
     * Story 043 D3: `state.json` is a cache, so before the first retry sweep reads the profile
     * list, two things happen exactly once each per start:
     *
     * 1. AC8's one-time format migration (gated by `configFileSourceMigratedAt`, so a second
     *    start is a no-op) brings every pre-existing profile's canonical file up to the current
     *    040/042 format and seeds its `fileHash`.
     * 2. Every launcher-owned `.cfg` in the canonical directory whose sentinel id `state.json`
     *    has no record for gets that record rebuilt from the file, keeping the sentinel's id.
     *
     * Placed here, after handler registration and before the retry sweep, for the same reason the
     * sweep itself is at the end: `setup()` is awaited before the renderer can invoke anything, so
     * a rebuilt profile is already in the list by the time the first `list` call arrives, while
     * registration itself is not delayed by disk I/O.
     *
     * The whole call is guarded: a failure of the directory scan (a permissions problem on the
     * canonical dir, say) must leave the module running on its cached state, not take the config
     * module - and with it the app's config tab - down at start. Per-profile and per-file failures
     * are already handled inside, and the migration guard stays unset on any of them so the next
     * start retries.
     */
    try {
      const report = await runFileSourceStartup({
        baseDir: userDataDir(),
        listProfiles: () => profiles.list(),
        replaceProfile: (profile) => void profiles.replaceProfile(profile),
        addProfile: (profile) => void profiles.addRebuilt(profile),
        migratedAt: () => app.state.configFileSourceMigratedAt(),
        setMigratedAt: (at) => void app.state.setConfigFileSourceMigratedAt(at),
        log,
      })
      if (report.migration !== 'skipped' || report.rebuiltProfileIds.length > 0) {
        log.info(
          `config file source: migration ${report.migration} ` +
            `(${report.migratedProfileIds.length} file(s), ${report.failedProfileIds.length} failed), ` +
            `${report.rebuiltProfileIds.length} profile(s) rebuilt from disk, ` +
            `${report.ignoredFileNames.length} owned file(s) ignored`,
        )
      }
    } catch (error) {
      log.error('config file-source startup (story 043 D3) failed; continuing on cached state', error)
    }

    // Story 022 D7: one retry sweep at start, after every handler is
    // registered, for whatever the last session left behind - a failed write
    // (`configWriteFailures`) or a write deferred because the installation was
    // running (`configPendingWrites`). One sweep only: `syncAndPersist` records
    // a fresh failure if it fails again, and the next mutation or the `write`
    // channel are the other two retry triggers.
    const failures = app.state.configWriteFailures()
    const pending = app.state.configPendingWrites()
    const retryIds = new Set<string>()
    for (const key of Object.keys(failures)) {
      // Keys are `<profileId>|own` or `<profileId>|<installationId>`.
      const profileId = key.split('|')[0]
      if (profileId) retryIds.add(profileId)
    }
    for (const profileId of Object.values(pending)) retryIds.add(profileId)

    if (retryIds.size > 0) {
      const allProfiles = profiles.list()
      for (const profileId of retryIds) {
        const profile = allProfiles.find((p) => p.id === profileId)
        // A profile id referenced by stale bookkeeping that no longer exists is
        // simply skipped - cleaning that dangling entry up is not this
        // deliverable's job.
        // Sequentially awaited, never `Promise.all`: overlapping fs writes to
        // the same installation must not race, the same reasoning the write
        // loops in `sync.ts` use.
        if (profile) await syncAndPersist(app, log, profiles, profile, allProfiles)
      }
    }

    log.debug('config module ready')
  },
}
