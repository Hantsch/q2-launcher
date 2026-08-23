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
import { removeCanonicalProfileFile } from './canonical'
import { syncProfile } from './sync'
import { removeRedundantCopies, restoreRemovedCopies, scanRedundantCopies } from './cleanup'
import { commitImport, previewImport, scanImportCandidates } from './import'
import { ProfilesStore } from './profiles'
import { renderLoaderFile, renderProfileFile } from './render'
import {
  assignProfileInputSchema,
  cleanupApplyInputSchema,
  cleanupRestoreInputSchema,
  cleanupScanInputSchema,
  createConfigProfileInputSchema,
  importCommitInputSchema,
  importPreviewInputSchema,
  importScanInputSchema,
  listInputSchema,
  openFileInputSchema,
  previewProfileInputSchema,
  rawFilesInputSchema,
  removeConfigProfileInputSchema,
  renameConfigProfileInputSchema,
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

  const expectedContent = renderProfileFile(profile)
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
 * Story 022 D7: the one place every mutating handler funnels through to get
 * `profile`'s files onto disk - its canonical `<userData>` copy plus every
 * installation it is assigned to - and to persist the resulting
 * pending-write/write-failure bookkeeping.
 *
 * Deliberately returns `void` and never throws: a sync problem is reported
 * through `configWriteFailures` (which `syncState` below and the `write`
 * channel surface), never by turning a successful CRUD operation into a failed
 * IPC response. `syncProfile` already catches its own write failures
 * internally, so the try/catch here is a defensive backstop for the
 * genuinely-unexpected - not the normal error path.
 */
async function syncAndPersist(
  app: AppContext,
  log: Logger,
  profile: ConfigProfile,
  allProfiles: ConfigProfile[],
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
      log,
    })
    app.state.setConfigPendingWrites(outcome.pendingWrites)
    app.state.setConfigWriteFailures(outcome.writeFailures)
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
        await syncAndPersist(app, log, created, list)
        return list
      },
    )

    handle(CONFIG_HANDLERS.rename, renameConfigProfileInputSchema, async (input): Promise<
      ConfigProfile[]
    > => {
      const list = withLiveAssignments(profiles.rename(input))
      // A rename cannot remove the profile, so it is always in the new list.
      await syncAndPersist(
        app,
        log,
        list.find((p) => p.id === input.id)!,
        list,
      )
      return list
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

    handle(CONFIG_HANDLERS.setCvars, setProfileCvarsInputSchema, async (
      input,
    ): Promise<ConfigProfile[]> => {
      const list = withLiveAssignments(profiles.setCvars(input))
      await syncAndPersist(
        app,
        log,
        list.find((p) => p.id === input.profileId)!,
        list,
      )
      return list
    })

    handle(CONFIG_HANDLERS.setBinds, setProfileBindsInputSchema, async (
      input,
    ): Promise<ConfigProfile[]> => {
      const list = withLiveAssignments(profiles.setBinds(input))
      await syncAndPersist(
        app,
        log,
        list.find((p) => p.id === input.profileId)!,
        list,
      )
      return list
    })

    handle(CONFIG_HANDLERS.setLayers, setProfileLayersInputSchema, async (
      input,
    ): Promise<ConfigProfile[]> => {
      const list = withLiveAssignments(profiles.setLayers(input))
      await syncAndPersist(
        app,
        log,
        list.find((p) => p.id === input.profileId)!,
        list,
      )
      return list
    })

    handle(CONFIG_HANDLERS.setActions, setProfileActionsInputSchema, async (
      input,
    ): Promise<ConfigProfile[]> => {
      const list = withLiveAssignments(profiles.setActions(input))
      await syncAndPersist(
        app,
        log,
        list.find((p) => p.id === input.profileId)!,
        list,
      )
      return list
    })

    // Story 040 D4: a dedicated setter for one boolean, not routed through the whole-field
    // replace setters above - same "genuinely new handler" shape as `setPlayedMods`/
    // `setSwitchBind` further down, but this one is write-affecting (it changes what
    // `renderProfileFile` emits), so it goes through the same `syncAndPersist` rewrite/sync path
    // `setCvars`/`setBinds`/`setLayers`/`setActions` do, not the plain state write those two use.
    handle(CONFIG_HANDLERS.setWriteUnbindall, setWriteUnbindallInputSchema, async (
      input,
    ): Promise<ConfigProfile[]> => {
      const list = withLiveAssignments(profiles.setWriteUnbindall(input))
      await syncAndPersist(
        app,
        log,
        list.find((p) => p.id === input.profileId)!,
        list,
      )
      return list
    })

    // Story 042 D7: mirrors `setWriteUnbindall` right above exactly - a dedicated setter for one
    // field, write-affecting (it changes which decoration `renderProfileFile` draws around every
    // section banner), so it goes through the same `syncAndPersist` rewrite/sync path.
    handle(CONFIG_HANDLERS.setSectionHeaderStyle, setSectionHeaderStyleInputSchema, async (
      input,
    ): Promise<ConfigProfile[]> => {
      const list = withLiveAssignments(profiles.setSectionHeaderStyle(input))
      await syncAndPersist(
        app,
        log,
        list.find((p) => p.id === input.profileId)!,
        list,
      )
      return list
    })

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
        await syncAndPersist(app, log, stillDefault, list)
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
      const state = await syncAndPersist(app, log, profile, profiles.list())
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
          expectedContent,
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
      await syncAndPersist(app, log, list[list.length - 1]!, list)
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
      await syncAndPersist(app, log, updated, list)
      return ok({ profile: updated, applied: outcome.applied, rejected: outcome.rejected })
      },
    )

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
        if (profile) await syncAndPersist(app, log, profile, allProfiles)
      }
    }

    log.debug('config module ready')
  },
}
