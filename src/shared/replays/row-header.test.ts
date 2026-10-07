import { describe, expect, it } from 'vitest'
import type { DiscoveredDemo } from '../modules/replays'
import { headerFromRow } from './row-header'

const ROSTER = { teams: [{ name: 'Home', players: ['A'] }], spectators: ['B'] }

function row(overrides: Partial<DiscoveredDemo>): DiscoveredDemo {
  return {
    readable: true,
    gameDir: 'opentdm',
    map: 'q2rdm2',
    pov: 'A',
    players: ['A', 'B'],
    roster: ROSTER,
    ...overrides,
  } as DiscoveredDemo
}

describe('a row becomes the header the resolver reads', () => {
  it('a readable row carries game dir, map, pov, players and roster', () => {
    expect(headerFromRow(row({}))).toEqual({
      ok: true,
      gameDir: 'opentdm',
      map: 'q2rdm2',
      pov: 'A',
      players: ['A', 'B'],
      roster: ROSTER,
    })
  })

  it('an unreadable row has no header', () => {
    expect(headerFromRow(row({ readable: false }))).toBeNull()
  })

  it('a readable row without a game dir has no header', () => {
    expect(headerFromRow(row({ gameDir: null }))).toBeNull()
  })
})
