import type { ConfigProfile } from '@shared/modules/config'
import type { LaunchState } from '@shared/types'

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
