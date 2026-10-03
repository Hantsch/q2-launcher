import { join } from 'node:path'
import { renderLoaderFile, renderProfileFile } from '@shared/config/render'
import { resolveProfileFileNames } from '@shared/config/profile-files'
import type { ConfigProfile, PreviewFile } from '@shared/modules/config'
import type { Installation, LaunchState } from '@shared/types'
import { BASE_GAME_DIR, LOADER_FILE_NAME } from './writer'

/**
 * The profile that is `installationId`'s current default, across ALL profiles
 * (not just the one being saved) - this is what the loader `autoexec.cfg`
 * always execs, per story 004 decision 3. Returns null only if the
 * installation has no default assignment anywhere, which should not happen for
 * an installation that has at least one assignment (the assignment invariant
 * in `assignments.ts` guarantees a default exists once anything is assigned),
 * but callers must handle it defensively rather than assume.
 */
export function defaultProfileFor(
  profiles: ConfigProfile[],
  installationId: string,
): ConfigProfile | null {
  return (
    profiles.find((profile) =>
      profile.assignments.some((a) => a.installationId === installationId && a.isDefault),
    ) ?? null
  )
}

/**
 * `installationId`'s assigned profiles, filtered from the full list and kept
 * in that list's own order (story 007 decision 8: this IS the switch-bind
 * cycle order, and it is what the UI already shows via
 * `InstallationProfilesPanel`).
 */
export function assignedProfilesFor(
  profiles: ConfigProfile[],
  installationId: string,
): Array<{ id: string; name: string }> {
  return profiles
    .filter((profile) => profile.assignments.some((a) => a.installationId === installationId))
    .map((profile) => ({ id: profile.id, name: profile.name }))
}

/** True when `installationId` is the one currently running, per the launch service's own state. */
export function isInstallationRunning(launchState: LaunchState, installationId: string): boolean {
  return (
    (launchState.phase === 'starting' || launchState.phase === 'running') &&
    launchState.installationId === installationId
  )
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
  // Mirrors the `defaultProfile.id !== profile.id` branch `sync.ts`'s write
  // loop follows for every assigned profile, so a preview never shows fewer
  // files than an actual sync would put on disk.
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
 * Keeps only entries that are actually one of the installation's own game
 * directories. The path-trust boundary for played-mod names lives in
 * `writer.ts` too (it re-checks at write time); this is what keeps
 * `state.json` itself from persisting a name that was never real.
 */
export function validatePlayedMods(gameDirs: string[], playedMods: string[]): string[] {
  return playedMods.filter((mod) => gameDirs.includes(mod))
}
