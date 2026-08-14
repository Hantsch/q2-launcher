import type { ConfigProfile, ProfileAssignment } from '@shared/modules/config'

/**
 * The assignment rules between profiles and installations.
 *
 * Pure on purpose, in the spirit of `services/launch-plan.ts`: every function
 * takes the whole profile list and returns a new one, touching no state store,
 * no clock and no Electron. The reason is the one invariant this file exists to
 * keep:
 *
 *   For any installation id, **at most one** assignment across *all* profiles
 *   may have `isDefault: true`.
 *
 * That invariant spans the entire list, not a single profile - an installation
 * can be assigned to several profiles at once, and each profile can serve
 * several installations. So every rule below has to look at the full list to be
 * correct, and a rule that reasons about one profile in isolation is a bug.
 * Keeping it pure is what makes those cross-profile cases cheap to unit test
 * instead of only observable after a round trip through `state.json`.
 *
 * What this file deliberately does not do:
 *
 *  - validate `installationId` against anything. It has no access to the
 *    installation list; that check belongs to the caller.
 *  - stamp `updatedAt`. A pure function has no clock, and the caller that
 *    commits the result is the one that knows when the change happened.
 */

/** Whether any profile already holds the default assignment for `installationId`. */
function hasDefaultFor(profiles: ConfigProfile[], installationId: string): boolean {
  return profiles.some((profile) =>
    profile.assignments.some((a) => a.installationId === installationId && a.isDefault),
  )
}

function requireProfile(profiles: ConfigProfile[], profileId: string): ConfigProfile {
  const profile = profiles.find((p) => p.id === profileId)
  if (!profile) throw new Error(`config profile not found: ${profileId}`)
  return profile
}

/**
 * Gives `installationId` a default again, by promoting the first assignment
 * found when scanning profiles in list order, then assignments in list order.
 *
 * Deterministic order matters more than which entry wins: the same state has to
 * produce the same default on every machine, or two clients disagree about what
 * an installation launches with.
 *
 * A no-op when the installation still has a default somewhere (so a list that
 * arrived with a stray second default is never made worse) or when it has no
 * assignments left at all (zero assignments trivially means zero defaults).
 */
function promoteDefaultFor(profiles: ConfigProfile[], installationId: string): ConfigProfile[] {
  if (hasDefaultFor(profiles, installationId)) return profiles

  const target = profiles.find((profile) =>
    profile.assignments.some((a) => a.installationId === installationId),
  )
  if (!target) return profiles

  let promoted = false
  const assignments = target.assignments.map((a) => {
    if (promoted || a.installationId !== installationId) return a
    promoted = true
    return { ...a, isDefault: true }
  })

  return profiles.map((p) => (p === target ? { ...p, assignments } : p))
}

/**
 * Assigns `installationId` to the profile.
 *
 * Idempotent: assigning an installation the profile already carries changes
 * nothing, in particular not its default flag - the UI can fire this twice
 * without silently reshuffling which profile the installation launches with.
 *
 * The new assignment becomes the default exactly when the installation has no
 * default anywhere yet, which covers both its first assignment ever and the
 * case where its previous default was unassigned. Note this is checked against
 * the list *before* the insert, so the new entry cannot vote for itself.
 */
export function assign(
  profiles: ConfigProfile[],
  input: { profileId: string; installationId: string },
): ConfigProfile[] {
  const profile = requireProfile(profiles, input.profileId)

  const already = profile.assignments.some((a) => a.installationId === input.installationId)
  if (already) return profiles

  const assignment: ProfileAssignment = {
    installationId: input.installationId,
    isDefault: !hasDefaultFor(profiles, input.installationId),
  }

  return profiles.map((p) =>
    p === profile ? { ...p, assignments: [...p.assignments, assignment] } : p,
  )
}

/**
 * Removes `installationId` from the profile.
 *
 * If the removed entry was the installation's default, one of its remaining
 * assignments in another profile is promoted, so an installation that is still
 * assigned somewhere is never left without a default. If nothing remains, it
 * simply ends up with no assignments and no default.
 *
 * Unassigning something that was never assigned is a no-op rather than an
 * error: the end state the caller asked for already holds.
 */
export function unassign(
  profiles: ConfigProfile[],
  input: { profileId: string; installationId: string },
): ConfigProfile[] {
  const profile = requireProfile(profiles, input.profileId)

  const removed = profile.assignments.filter((a) => a.installationId === input.installationId)
  if (removed.length === 0) return profiles

  const next = profiles.map((p) =>
    p === profile
      ? {
          ...p,
          assignments: p.assignments.filter((a) => a.installationId !== input.installationId),
        }
      : p,
  )

  if (!removed.some((a) => a.isDefault)) return next
  return promoteDefaultFor(next, input.installationId)
}

/**
 * Makes this profile the installation's default, and clears the flag on every
 * other profile's assignment for the *same* installation.
 *
 * Scoped per installation on both ends: other installations assigned to this
 * profile keep their default flags, and this installation's status on other
 * installations is meaningless anyway. Only entries matching `installationId`
 * are ever rewritten.
 */
export function setDefault(
  profiles: ConfigProfile[],
  input: { profileId: string; installationId: string },
): ConfigProfile[] {
  const profile = requireProfile(profiles, input.profileId)

  const assigned = profile.assignments.some((a) => a.installationId === input.installationId)
  if (!assigned) {
    throw new Error(
      `config profile ${input.profileId} is not assigned to installation ${input.installationId}`,
    )
  }

  return profiles.map((p) => ({
    ...p,
    assignments: p.assignments.map((a) =>
      a.installationId === input.installationId ? { ...a, isDefault: p.id === input.profileId } : a,
    ),
  }))
}

/**
 * Drops assignments pointing at installations that no longer exist.
 *
 * An installation can be removed while profiles still reference it, which would
 * otherwise leave rows the UI cannot render and a default nobody can reach.
 * Pruning is all that is needed: an orphan's assignments are removed entirely,
 * so the vanished installation has nothing left to hold a default - there is
 * never anything to promote here, and promoting across installations would be
 * plain wrong.
 */
export function reconcileAssignments(
  profiles: ConfigProfile[],
  knownInstallationIds: string[],
): ConfigProfile[] {
  const known = new Set(knownInstallationIds)
  if (profiles.every((p) => p.assignments.every((a) => known.has(a.installationId)))) {
    return profiles
  }

  return profiles.map((profile) => {
    const assignments = profile.assignments.filter((a) => known.has(a.installationId))
    return assignments.length === profile.assignments.length ? profile : { ...profile, assignments }
  })
}
