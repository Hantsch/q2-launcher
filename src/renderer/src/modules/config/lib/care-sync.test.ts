import { describe, expect, it } from 'vitest'
import type { ProfileFileSyncStatus, ProfileSyncState } from '@shared/modules/config'
import {
  canonicalOutOfSyncReason,
  toCareSyncRows,
  type CareSyncRow,
  type CareSyncState,
} from './care-sync'

function own(status: ProfileFileSyncStatus, messageKey?: string) {
  return {
    path: 'C:/profiles/p1.cfg',
    fileName: 'p1.cfg',
    status,
    ...(messageKey ? { messageKey } : {}),
  }
}

function installation(
  installationId: string,
  status: ProfileFileSyncStatus,
  messageKey?: string,
) {
  return {
    installationId,
    path: `C:/games/${installationId}/p1.cfg`,
    fileName: 'p1.cfg',
    status,
    ...(messageKey ? { messageKey } : {}),
  }
}

describe('toCareSyncRows', () => {
  it('maps the canonical file to a "canonical" row first, then installations in order', () => {
    const sync: ProfileSyncState = {
      own: own('inSync'),
      installations: [installation('i1', 'outOfSync'), installation('i2', 'missing')],
    }

    const rows = toCareSyncRows(sync)

    expect(rows.map((row) => row.target)).toEqual(['canonical', 'i1', 'i2'])
  })

  it('passes "inSync" through unchanged', () => {
    const sync: ProfileSyncState = { own: own('inSync'), installations: [] }
    expect(toCareSyncRows(sync)[0].state).toBe('inSync')
  })

  it('passes "outOfSync" through unchanged', () => {
    const sync: ProfileSyncState = { own: own('outOfSync'), installations: [] }
    expect(toCareSyncRows(sync)[0].state).toBe('outOfSync')
  })

  it('passes "missing" through unchanged', () => {
    const sync: ProfileSyncState = { own: own('missing'), installations: [] }
    expect(toCareSyncRows(sync)[0].state).toBe('missing')
  })

  it('renames "error" to "failed" and carries the messageKey through unchanged', () => {
    const sync: ProfileSyncState = {
      own: own('inSync'),
      installations: [installation('i1', 'error', 'config.care.sync.messages.writeFailed')],
    }

    const rows = toCareSyncRows(sync)

    expect(rows[1].state).toBe('failed')
    expect(rows[1].messageKey).toBe('config.care.sync.messages.writeFailed')
  })

  it('omits messageKey entirely when the source has none', () => {
    const sync: ProfileSyncState = { own: own('inSync'), installations: [] }
    expect(toCareSyncRows(sync)[0].messageKey).toBeUndefined()
  })

  // Story 043 D9 acceptance, narrowed by story 079 (D5): "the states of 022 decision 5 still each
  // mean what their copy says" - pinned here as one assertion per state, on top of the individual
  // pass-through tests above, so a future change to this function cannot quietly blur two states
  // together. Story 079 dropped 'pending' from the set entirely - see the exhaustive check below.
  it('keeps each of the four remaining states meaning exactly what it did before story 079', () => {
    const sync: ProfileSyncState = {
      own: own('inSync'),
      installations: [
        installation('i1', 'outOfSync'),
        installation('i2', 'missing'),
        installation('i3', 'error'),
      ],
    }

    const states = toCareSyncRows(sync).map((row) => row.state)

    expect(states).toEqual(['inSync', 'outOfSync', 'missing', 'failed'])
  })

  /**
   * Story 079 AC3 (renderer half): no pending state exists any more. A running installation's
   * write used to be deferred and reported as 'pending'; it is now written exactly like a stopped
   * one, so a write that actually fails is still reported as 'failed' (with Retry) and nothing
   * else sits in between.
   *
   * Exhaustive rather than a single spot-check: `Record<ProfileFileSyncStatus, true>` forces this
   * test to name every member of the source union (main's write pipeline) - if either union ever
   * regrows a 'pending' member, this file fails to typecheck rather than silently passing. The
   * second `Record<CareSyncState, true>` does the same for the row model itself, so 'pending'
   * cannot re-enter through the mapping layer even if the source union stayed clean.
   */
  it('no pending state exists', () => {
    const everySourceStatus: Record<ProfileFileSyncStatus, true> = {
      inSync: true,
      outOfSync: true,
      missing: true,
      error: true,
    }
    const everyRowState: Record<CareSyncState, true> = {
      inSync: true,
      outOfSync: true,
      missing: true,
      failed: true,
    }

    expect(Object.keys(everySourceStatus)).not.toContain('pending')
    expect(Object.keys(everyRowState)).not.toContain('pending')

    for (const status of Object.keys(everySourceStatus) as ProfileFileSyncStatus[]) {
      const sync: ProfileSyncState = { own: own(status), installations: [] }
      expect(toCareSyncRows(sync)[0].state).not.toBe('pending')
    }
  })
})

describe('canonicalOutOfSyncReason', () => {
  const canonicalRow = (state: CareSyncRow['state']): CareSyncRow => ({
    target: 'canonical',
    path: 'C:/profiles/p1.cfg',
    state,
  })

  const installationRow = (state: CareSyncRow['state']): CareSyncRow => ({
    target: 'i1',
    path: 'C:/games/i1/p1.cfg',
    state,
  })

  it('reads as "unsavedChanges" for the canonical row when the profile is dirty', () => {
    expect(canonicalOutOfSyncReason(canonicalRow('outOfSync'), true)).toBe('unsavedChanges')
  })

  it('reads as "externalEdit" for the canonical row when the profile is not dirty', () => {
    expect(canonicalOutOfSyncReason(canonicalRow('outOfSync'), false)).toBe('externalEdit')
  })

  it('reads as "externalEdit" when dirty is absent (pre-story-043 profiles)', () => {
    expect(canonicalOutOfSyncReason(canonicalRow('outOfSync'), undefined)).toBe('externalEdit')
  })

  it('is undefined for the canonical row in every state other than outOfSync', () => {
    expect(canonicalOutOfSyncReason(canonicalRow('inSync'), true)).toBeUndefined()
    expect(canonicalOutOfSyncReason(canonicalRow('missing'), true)).toBeUndefined()
    expect(canonicalOutOfSyncReason(canonicalRow('failed'), true)).toBeUndefined()
  })

  // Regression (story 043 D9 acceptance): an edited installation copy is still a plain
  // "outOfSync" row - never reinterpreted as unsaved-changes/external-edit, which is a canonical-
  // only distinction. Its Retry affordance (SyncRow, `failed` only) is therefore untouched.
  it('is undefined for an installation row even when outOfSync and the profile is dirty', () => {
    expect(canonicalOutOfSyncReason(installationRow('outOfSync'), true)).toBeUndefined()
  })
})
