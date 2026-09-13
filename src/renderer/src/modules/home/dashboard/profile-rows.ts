import type { ConfigProfile, ProfileSyncState } from '@shared/modules/config'
import { toCareSyncRows, type CareSyncState } from '../../config/lib/care-sync'

/**
 * Story 087 D4: one row per config profile for the dashboard's Config profiles tile.
 *
 * - `own` ("sync state", Decisions (Sprint)): the profile's own canonical file's status -
 *   `toCareSyncRows(sync)[0].state`, the `'canonical'` row.
 * - `installations` ("care state", Decisions (Sprint)): the WORST (most severe) state across the
 *   profile's installation copies, per the canonical `inSync < outOfSync < missing < failed`
 *   ordering `care-sync.test.ts` asserts. A profile with zero assigned installations has nothing to
 *   report, so it defaults to `'inSync'` rather than being treated as a problem.
 * - `counts.assigned`: `profile.assignments.length` - the only count this deliverable needs (the
 *   story only asks for "sync and care state" per profile).
 */
export interface ConfigProfileRow {
  id: string
  name: string
  own: CareSyncState
  installations: CareSyncState
  counts: { assigned: number }
}

/** Least to most severe - the authoritative ordering `care-sync.test.ts:93` asserts for
 * `CareSyncState`. Do not reinterpret. */
const SEVERITY_ORDER: readonly CareSyncState[] = ['inSync', 'outOfSync', 'missing', 'failed']

function worstState(states: CareSyncState[]): CareSyncState {
  return states.reduce<CareSyncState>(
    (worst, state) => (SEVERITY_ORDER.indexOf(state) > SEVERITY_ORDER.indexOf(worst) ? state : worst),
    'inSync',
  )
}

function buildRow(profile: ConfigProfile, sync: ProfileSyncState | undefined): ConfigProfileRow {
  const counts = { assigned: profile.assignments.length }

  // The caller's per-profile `getProfileSyncState` fetch failed (rejected, or came back `!ok`) -
  // this profile's row still renders (D4's own acceptance line), marked with the most severe state
  // in both columns rather than being dropped or crashing the tile.
  if (!sync) {
    return { id: profile.id, name: profile.name, own: 'failed', installations: 'failed', counts }
  }

  const [canonical, ...installationRows] = toCareSyncRows(sync)
  return {
    id: profile.id,
    name: profile.name,
    own: canonical.state,
    installations: worstState(installationRows.map((row) => row.state)),
    counts,
  }
}

/**
 * Maps `listConfigProfiles()`'s result plus one `getProfileSyncState()` result per profile to the
 * tile's rows. `syncStates` is aligned by index with `profiles` (the same order the tile fetches
 * them in, via `Promise.all(profiles.map(...))`) - a `undefined` entry stands for that one profile's
 * sync-state fetch having failed, so a caller can catch each fetch individually without needing a
 * sentinel `ProfileSyncState` value.
 */
export function toConfigProfileRows(
  profiles: ConfigProfile[],
  syncStates: ReadonlyArray<ProfileSyncState | undefined>,
): ConfigProfileRow[] {
  return profiles.map((profile, index) => buildRow(profile, syncStates[index]))
}
