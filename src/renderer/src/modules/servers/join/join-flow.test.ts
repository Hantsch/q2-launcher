import { describe, expect, it } from 'vitest'
import type { ServerListRow } from '@shared/modules/servers'
import { modMismatch, needsJoinPassword } from './join-flow'
import { makeInstallation } from '../../../../../test-support/fixtures'

function makeRow(overrides: Partial<ServerListRow> = {}): ServerListRow {
  return {
    address: '1.2.3.4:27910',
    origins: ['manual'],
    status: 'online',
    lastSeenAt: null,
    favourite: false,
    ...overrides,
  }
}

describe('modMismatch', () => {
  it('compares the server mod with the active game dir, baseq2 for empty', () => {
    expect(modMismatch(makeRow({ mod: 'ctf' }), makeInstallation({ activeGameDir: '' }))).toEqual({
      server: 'ctf',
      installation: 'baseq2',
    })

    expect(
      modMismatch(makeRow({ mod: 'BaseQ2' }), makeInstallation({ activeGameDir: '' })),
    ).toBeNull()

    expect(modMismatch(makeRow({ mod: '' }), makeInstallation({ activeGameDir: 'ctf' }))).toBeNull()
    expect(
      modMismatch(makeRow({ mod: undefined }), makeInstallation({ activeGameDir: 'ctf' })),
    ).toBeNull()
  })

  it('matches case-insensitively against a non-empty active game dir', () => {
    expect(
      modMismatch(makeRow({ mod: 'CTF' }), makeInstallation({ activeGameDir: 'ctf' })),
    ).toBeNull()
    expect(
      modMismatch(makeRow({ mod: 'xatrix' }), makeInstallation({ activeGameDir: 'ctf' })),
    ).toEqual({ server: 'xatrix', installation: 'ctf' })
  })
})

describe('needsJoinPassword', () => {
  it('is true only when needpass is exactly true', () => {
    expect(needsJoinPassword(makeRow({ needpass: true }))).toBe(true)
    expect(needsJoinPassword(makeRow({ needpass: false }))).toBe(false)
    expect(needsJoinPassword(makeRow({ needpass: undefined }))).toBe(false)
  })
})
