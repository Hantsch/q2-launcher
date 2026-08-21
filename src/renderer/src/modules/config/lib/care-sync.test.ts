import { describe, expect, it } from 'vitest'
import type { ProfileFileSyncStatus, ProfileSyncState } from '@shared/modules/config'
import { toCareSyncRows } from './care-sync'

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
})
