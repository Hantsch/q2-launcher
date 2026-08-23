/**
 * Care tab, Sync section (story 025 D2): turns story 022's `ProfileSyncState`
 * (the profile's own canonical file plus one entry per assigned installation,
 * as returned by `getProfileSyncState` in `client.ts`) into a flat list of
 * rows the section can render without knowing anything about the underlying
 * `own`/`installations` shape.
 *
 * `ProfileFileSyncStatus` and `CareSyncRow['state']` are almost the same
 * vocabulary - `'inSync' | 'outOfSync' | 'missing' | 'pending'` are identical
 * spellings on both sides and pass through unchanged. The one exception is
 * `'error'`, which this adapter renames to `'failed'` so the UI's retry
 * affordance has a name that describes what a user can do about it, rather
 * than the write pipeline's internal vocabulary. `'pending'` (an
 * installation that was running when the last write ran, so the write was
 * deferred) is deliberately its own state here too - it must never collapse
 * into `'failed'` or `'outOfSync'`, both of which would misdescribe a write
 * that has not been attempted yet as one that failed or is simply stale.
 */

import type { ProfileFileSync, ProfileFileSyncStatus, ProfileSyncState } from '@shared/modules/config'

/** One row's sync state - `ProfileFileSyncStatus` with `'error'` renamed to `'failed'`. */
export type CareSyncState = 'inSync' | 'outOfSync' | 'missing' | 'failed' | 'pending'

export interface CareSyncRow {
  /** `'canonical'` for the profile's own file, an installation id for its copy. */
  target: 'canonical' | string
  path: string
  state: CareSyncState
  /** i18n key, never prose - carried through unchanged from the source status. */
  messageKey?: string
}

function toState(status: ProfileFileSyncStatus): CareSyncState {
  return status === 'error' ? 'failed' : status
}

function toRow(target: 'canonical' | string, file: ProfileFileSync): CareSyncRow {
  return {
    target,
    path: file.path,
    state: toState(file.status),
    ...(file.messageKey ? { messageKey: file.messageKey } : {}),
  }
}

/**
 * `sync.own` first (the canonical row), then one row per assigned
 * installation in `sync.installations`' own order - the same order
 * `getProfileSyncState` returns them in, which matches assignment order.
 */
export function toCareSyncRows(sync: ProfileSyncState): CareSyncRow[] {
  return [
    toRow('canonical', sync.own),
    ...sync.installations.map((installation) => toRow(installation.installationId, installation)),
  ]
}

/**
 * Story 043 D9: which of the two real-world causes put the canonical row into `outOfSync` - the
 * profile carries edits the UI has not saved yet (`unsavedChanges`), or its file was changed by
 * something other than this launcher and has not been adopted (`externalEdit`). Both currently
 * arrive as the same `outOfSync` state (022 decision 5's five states are not growing a sixth, per
 * story 043's own "Decided during refine"), so telling them apart is a rendering decision, not a
 * new state - `CareSyncSection` uses this to choose copy and actions, `toCareSyncRows`/`CareSyncState`
 * above stay exactly as they were.
 *
 * `profile.dirty` (story 043 D2/D4) is the only signal needed and is already on the `ConfigProfile`
 * `CareSyncSection` receives - no IPC/schema addition for this deliverable. Undefined for every
 * installation row and for every other canonical state; those keep today's exact rendering.
 */
export type CanonicalOutOfSyncReason = 'unsavedChanges' | 'externalEdit'

export function canonicalOutOfSyncReason(
  row: CareSyncRow,
  profileDirty: boolean | undefined,
): CanonicalOutOfSyncReason | undefined {
  if (row.target !== 'canonical' || row.state !== 'outOfSync') return undefined
  return profileDirty === true ? 'unsavedChanges' : 'externalEdit'
}
