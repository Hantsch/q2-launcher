import { describe, expect, it } from 'vitest'
import type { ProfileFileSyncStatus, ProfileSyncState } from '@shared/modules/config'
import { canonicalOutOfSyncReason, toCareSyncRows, type CareSyncRow } from './care-sync'

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

  it('keeps a "pending" row pending - it must not collapse into "failed" or "outOfSync"', () => {
    const sync: ProfileSyncState = {
      own: own('inSync'),
      installations: [installation('i1', 'pending', 'config.care.sync.messages.running')],
    }

    const rows = toCareSyncRows(sync)

    expect(rows[1].state).toBe('pending')
    expect(rows[1].state).not.toBe('failed')
    expect(rows[1].state).not.toBe('outOfSync')
    expect(rows[1].messageKey).toBe('config.care.sync.messages.running')
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

  // Story 043 D9 acceptance: "the five states of 022 decision 5 still each mean what their copy
  // says" - pinned here as one assertion per state, on top of the individual pass-through tests
  // above, so a future change to this function cannot quietly blur two of the five together.
  it('keeps each of the five states meaning exactly what it did before story 043', () => {
    const sync: ProfileSyncState = {
      own: own('inSync'),
      installations: [
        installation('i1', 'outOfSync'),
        installation('i2', 'missing'),
        installation('i3', 'pending'),
        installation('i4', 'error'),
      ],
    }

    const states = toCareSyncRows(sync).map((row) => row.state)

    expect(states).toEqual(['inSync', 'outOfSync', 'missing', 'pending', 'failed'])
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
    expect(canonicalOutOfSyncReason(canonicalRow('pending'), true)).toBeUndefined()
  })

  // Regression (story 043 D9 acceptance): an edited installation copy is still a plain
  // "outOfSync" row - never reinterpreted as unsaved-changes/external-edit, which is a canonical-
  // only distinction. Its Retry affordance (SyncRow, `failed` only) is therefore untouched.
  it('is undefined for an installation row even when outOfSync and the profile is dirty', () => {
    expect(canonicalOutOfSyncReason(installationRow('outOfSync'), true)).toBeUndefined()
  })
})
