import { join } from 'node:path'
import {
  CONFIG_HANDLERS,
  type ConfigProfile,
  type PreviewFile,
  type PreviewProfileResult,
  type WriteState,
  type WriteTargetResult,
} from '@shared/modules/config'
import type { Installation, LaunchState } from '@shared/types'
import { reconcileAssignments } from './assignments'
import { fail, ok, type Outcome } from '@shared/types'
import type { Logger } from '../../lib/logger'
import type { MainModule } from '../types'
import { ProfilesStore } from './profiles'
import { profileFileName, renderLoaderFile, renderProfileFile } from './render'
import {
  assignProfileInputSchema,
  createConfigProfileInputSchema,
  previewProfileInputSchema,
  removeConfigProfileInputSchema,
  renameConfigProfileInputSchema,
  setDefaultProfileInputSchema,
  setPlayedModsInputSchema,
  setProfileCvarsInputSchema,
  unassignProfileInputSchema,
  writeProfileInputSchema,
} from './schemas'
import { defaultProfileFor, isInstallationRunning } from './write-plan'
import { BASE_GAME_DIR, LOADER_FILE_NAME, writeInstallationFiles } from './writer'

export interface WriteProfileDeps {
  profile: ConfigProfile
  /** The full profile list, used to resolve each target installation's default. */
  allProfiles: ConfigProfile[]
  installations: { find: (id: string) => Installation | undefined }
  launchState: LaunchState
  playedModsFor: (installationId: string) => string[]
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
  const results: WriteTargetResult[] = []
  const pendingWrites = { ...deps.pendingWrites }

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
      const result = await writeInstallationFiles({
        installation,
        profileFileName: profileFileName(profile.id),
        profileFileContent: renderProfileFile(profile),
        loaderFileContent: renderLoaderFile(defaultProfile),
        playedMods: playedModsFor(installation.id),
      })
      results.push({
        installationId: installation.id,
        status: result.changed ? 'written' : 'unchanged',
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
): PreviewFile[] {
  const defaultProfile = defaultProfileFor(allProfiles, installation.id) ?? profile
  const baseDir = join(installation.rootPath, BASE_GAME_DIR)

  return [
    { path: join(baseDir, profileFileName(profile.id)), content: renderProfileFile(profile) },
    { path: join(baseDir, LOADER_FILE_NAME), content: renderLoaderFile(defaultProfile) },
  ]
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

  setup({ handle, app, log }) {
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

    handle(CONFIG_HANDLERS.list, (): ConfigProfile[] => withLiveAssignments(profiles.list()))

    handle(CONFIG_HANDLERS.create, (payload): ConfigProfile[] =>
      withLiveAssignments(profiles.create(createConfigProfileInputSchema.parse(payload))),
    )

    handle(CONFIG_HANDLERS.rename, (payload): ConfigProfile[] =>
      withLiveAssignments(profiles.rename(renameConfigProfileInputSchema.parse(payload))),
    )

    handle(CONFIG_HANDLERS.remove, (payload): ConfigProfile[] =>
      withLiveAssignments(profiles.remove(removeConfigProfileInputSchema.parse(payload))),
    )

    handle(CONFIG_HANDLERS.setCvars, (payload): ConfigProfile[] =>
      withLiveAssignments(profiles.setCvars(setProfileCvarsInputSchema.parse(payload))),
    )

    handle(CONFIG_HANDLERS.assign, (payload): Outcome<ConfigProfile[]> => {
      const parsed = assignProfileInputSchema.safeParse(payload)
      if (!parsed.success) return fail('ipc.error.invalidPayload')
      if (!app.installations.find(parsed.data.installationId)) {
        return fail('config.error.installationNotFound')
      }
      try {
        return ok(withLiveAssignments(profiles.assign(parsed.data)))
      } catch {
        return fail('config.error.profileNotFound')
      }
    })

    handle(CONFIG_HANDLERS.unassign, (payload): Outcome<ConfigProfile[]> => {
      const parsed = unassignProfileInputSchema.safeParse(payload)
      if (!parsed.success) return fail('ipc.error.invalidPayload')
      if (!app.installations.find(parsed.data.installationId)) {
        return fail('config.error.installationNotFound')
      }
      try {
        return ok(withLiveAssignments(profiles.unassign(parsed.data)))
      } catch {
        return fail('config.error.profileNotFound')
      }
    })

    handle(CONFIG_HANDLERS.setDefault, (payload): Outcome<ConfigProfile[]> => {
      const parsed = setDefaultProfileInputSchema.safeParse(payload)
      if (!parsed.success) return fail('ipc.error.invalidPayload')
      if (!app.installations.find(parsed.data.installationId)) {
        return fail('config.error.installationNotFound')
      }
      try {
        return ok(withLiveAssignments(profiles.setDefault(parsed.data)))
      } catch (error) {
        // The thrown message is the only way to tell "unknown profile" apart
        // from "profile exists but isn't assigned to that installation" -
        // `assignments.ts` throws a plain `Error` in both cases (see
        // `requireProfile` vs the not-assigned check in `setDefault`).
        const notAssigned =
          error instanceof Error && error.message.includes('is not assigned to installation')
        return fail(notAssigned ? 'config.error.notAssigned' : 'config.error.profileNotFound')
      }
    })

    handle(CONFIG_HANDLERS.write, async (payload): Promise<Outcome<WriteTargetResult[]>> => {
      const parsed = writeProfileInputSchema.safeParse(payload)
      if (!parsed.success) return fail('ipc.error.invalidPayload')
      const profile = profiles.find(parsed.data.profileId)
      if (!profile) return fail('config.error.profileNotFound')

      const { results, pendingWrites } = await writeProfileToAssignedInstallations({
        profile,
        allProfiles: profiles.list(),
        installations: app.installations,
        launchState: app.launch.getState(),
        playedModsFor: (installationId) => app.state.configPlayedMods()[installationId] ?? [],
        pendingWrites: app.state.configPendingWrites(),
        log,
      })
      app.state.setConfigPendingWrites(pendingWrites)
      return ok(results)
    })

    handle(CONFIG_HANDLERS.preview, (payload): Outcome<PreviewProfileResult> => {
      const parsed = previewProfileInputSchema.safeParse(payload)
      if (!parsed.success) return fail('ipc.error.invalidPayload')
      const profile = profiles.find(parsed.data.profileId)
      if (!profile) return fail('config.error.profileNotFound')
      const installation = app.installations.find(parsed.data.installationId)
      if (!installation) return fail('config.error.installationNotFound')

      return ok({ files: previewProfileFiles(profile, profiles.list(), installation) })
    })

    handle(CONFIG_HANDLERS.writeState, (): WriteState => app.state.configPendingWrites())

    handle(CONFIG_HANDLERS.setPlayedMods, (payload): Outcome<string[]> => {
      const parsed = setPlayedModsInputSchema.safeParse(payload)
      if (!parsed.success) return fail('ipc.error.invalidPayload')
      const installation = app.installations.find(parsed.data.installationId)
      if (!installation) return fail('config.error.installationNotFound')

      const validated = validatePlayedMods(installation.gameDirs, parsed.data.playedMods)
      app.state.setConfigPlayedMods({
        ...app.state.configPlayedMods(),
        [installation.id]: validated,
      })
      return ok(validated)
    })

    log.debug('config module ready')
  },
}
