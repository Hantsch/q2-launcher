/**
 * Which installation's rendered config the "Raw file" tab shows (story 012,
 * D3).
 *
 * Priority, in order: keep a still-valid current pick, else the assignment
 * marked as this installation's default, else the active installation if the
 * profile is assigned to it, else the first assignment, else `null` when the
 * profile has no assignments at all - the caller renders an `EmptyState` for
 * that last case and never fires a request.
 */

import type { ConfigProfile } from '@shared/modules/config'
// `installations` is accepted to match the mandated signature and because
// `ConfigView` already has the live list at hand, but the logic below only
// needs `profile.assignments` - an assignment's `installationId` is enough on
// its own, and reconciling it against live installations already happened in
// main before `profile.assignments` reached the renderer.
import type { Installation } from '@shared/types/installation'

export function pickRawInstallationId(
  profile: ConfigProfile,
  _installations: Installation[],
  activeInstallationId: string | null,
  currentId?: string | null,
): string | null {
  const isAssigned = (id: string): boolean =>
    profile.assignments.some((assignment) => assignment.installationId === id)

  if (currentId && isAssigned(currentId)) return currentId

  const defaultAssignment = profile.assignments.find((assignment) => assignment.isDefault)
  if (defaultAssignment) return defaultAssignment.installationId

  if (activeInstallationId && isAssigned(activeInstallationId)) return activeInstallationId

  if (profile.assignments.length > 0) return profile.assignments[0].installationId

  return null
}
