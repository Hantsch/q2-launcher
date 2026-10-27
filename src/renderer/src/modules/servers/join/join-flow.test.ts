import { describe, expect, it } from 'vitest'
import type { ServerListRow } from '@shared/modules/servers'
import { needsJoinPassword } from './join-flow'

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

describe('needsJoinPassword', () => {
  it('is true only when needpass is exactly true', () => {
    expect(needsJoinPassword(makeRow({ needpass: true }))).toBe(true)
    expect(needsJoinPassword(makeRow({ needpass: false }))).toBe(false)
    expect(needsJoinPassword(makeRow({ needpass: undefined }))).toBe(false)
  })
})
