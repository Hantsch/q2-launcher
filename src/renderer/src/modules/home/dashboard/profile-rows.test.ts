import { describe, expect, it } from 'vitest'
import type { ConfigProfile, ProfileFileSyncStatus, ProfileSyncState } from '@shared/modules/config'
import { toConfigProfileRows } from './profile-rows'

/**
 * Story 087 D4 (AC2's acceptance test): "every profile gets its own and its installations' state" -
 * plus the D4 acceptance line that a profile whose sync-state fetch failed still produces a row
 * rather than being dropped.
 */

function profile(id: string, name: string, assignedInstallationIds: string[]): ConfigProfile {
  return {
    id,
    name,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    cvars: {},
    binds: {},
    assignments: assignedInstallationIds.map((installationId) => ({ installationId, isDefault: false })),
  }
}

function own(status: ProfileFileSyncStatus) {
  return { path: 'C:/profiles/p.cfg', fileName: 'p.cfg', status }
}

function installation(installationId: string, status: ProfileFileSyncStatus) {
  return { installationId, path: `C:/games/${installationId}/p.cfg`, fileName: 'p.cfg', status }
}

describe('toConfigProfileRows', () => {
  it('every profile gets its own and its installations state', () => {
    const profiles = [
      profile('p1', 'Competitive', ['i1', 'i2', 'i3']),
      profile('p2', 'Casual', []),
    ]
    const syncStates: Array<ProfileSyncState | undefined> = [
      {
        own: own('inSync'),
        // mixed severities - proves the worst-of reduction picks 'failed', not the first/last entry
        installations: [
          installation('i1', 'outOfSync'),
          installation('i2', 'error'),
          installation('i3', 'missing'),
        ],
      },
      { own: own('outOfSync'), installations: [] },
    ]

    const rows = toConfigProfileRows(profiles, syncStates)

    expect(rows).toEqual([
      { id: 'p1', name: 'Competitive', own: 'inSync', installations: 'failed', counts: { assigned: 3 } },
      { id: 'p2', name: 'Casual', own: 'outOfSync', installations: 'inSync', counts: { assigned: 0 } },
    ])
  })

  it('picks the worst installation state regardless of input order', () => {
    const profiles = [profile('p1', 'One', ['i1', 'i2'])]
    const syncStates: Array<ProfileSyncState | undefined> = [
      {
        own: own('inSync'),
        installations: [installation('i1', 'missing'), installation('i2', 'outOfSync')],
      },
    ]

    const rows = toConfigProfileRows(profiles, syncStates)

    expect(rows[0]?.installations).toBe('missing')
  })

  it('a profile with zero assigned installations defaults installations to inSync', () => {
    const profiles = [profile('p1', 'Solo', [])]
    const syncStates: Array<ProfileSyncState | undefined> = [{ own: own('inSync'), installations: [] }]

    const rows = toConfigProfileRows(profiles, syncStates)

    expect(rows[0]?.installations).toBe('inSync')
  })

  it('a profile whose sync-state fetch failed still produces a row, marked failed rather than dropped', () => {
    const profiles = [
      profile('p1', 'Ok profile', ['i1']),
      profile('p2', 'Failed profile', ['i1']),
    ]
    const syncStates: Array<ProfileSyncState | undefined> = [
      { own: own('inSync'), installations: [installation('i1', 'inSync')] },
      undefined,
    ]

    const rows = toConfigProfileRows(profiles, syncStates)

    expect(rows).toHaveLength(2)
    expect(rows[1]).toEqual({
      id: 'p2',
      name: 'Failed profile',
      own: 'failed',
      installations: 'failed',
      counts: { assigned: 1 },
    })
  })
})
