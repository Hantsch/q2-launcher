import { describe, expect, it } from 'vitest'
import { sortPlayers } from './player-sort'
import type { ServerPlayer } from './status-reply'

describe('sortPlayers', () => {
  it('sorts by each column in both directions, stable on ties', () => {
    const players: ServerPlayer[] = [
      { name: 'Bravo', score: 5, ping: 50 },
      { name: 'alpha', score: 10, ping: 20 },
      { name: 'Charlie', score: 5, ping: 30 },
    ]

    // name asc is case-insensitive: alpha < Bravo < Charlie.
    expect(sortPlayers(players, 'name', 'asc').map((p) => p.name)).toEqual([
      'alpha',
      'Bravo',
      'Charlie',
    ])
    expect(sortPlayers(players, 'name', 'desc').map((p) => p.name)).toEqual([
      'Charlie',
      'Bravo',
      'alpha',
    ])

    // score: Bravo and Charlie tie at 5 -> keep original roster order (Bravo before Charlie).
    expect(sortPlayers(players, 'score', 'desc').map((p) => p.name)).toEqual([
      'alpha',
      'Bravo',
      'Charlie',
    ])
    expect(sortPlayers(players, 'score', 'asc').map((p) => p.name)).toEqual([
      'Bravo',
      'Charlie',
      'alpha',
    ])

    expect(sortPlayers(players, 'ping', 'asc').map((p) => p.name)).toEqual([
      'alpha',
      'Charlie',
      'Bravo',
    ])
    expect(sortPlayers(players, 'ping', 'desc').map((p) => p.name)).toEqual([
      'Bravo',
      'Charlie',
      'alpha',
    ])

    // Original array is untouched.
    expect(players.map((p) => p.name)).toEqual(['Bravo', 'alpha', 'Charlie'])
  })

  it('malformed values sort last in either direction', () => {
    const players: ServerPlayer[] = [
      { name: 'Bravo', score: 5, ping: Number.NaN },
      { name: 'alpha', score: Number.POSITIVE_INFINITY, ping: 20 },
      { name: '', score: 3, ping: 10 },
      { name: 'Charlie', score: 1, ping: 5 },
    ]

    // ping: NaN sorts last regardless of direction.
    expect(sortPlayers(players, 'ping', 'asc').map((p) => p.name)).toEqual([
      'Charlie',
      '',
      'alpha',
      'Bravo',
    ])
    expect(sortPlayers(players, 'ping', 'desc').map((p) => p.name)).toEqual([
      'alpha',
      '',
      'Charlie',
      'Bravo',
    ])

    // score: Infinity is a finite-number failure, sorts last regardless of direction.
    expect(sortPlayers(players, 'score', 'desc').map((p) => p.name)).toEqual([
      'Bravo',
      '',
      'Charlie',
      'alpha',
    ])
    expect(sortPlayers(players, 'score', 'asc').map((p) => p.name)).toEqual([
      'Charlie',
      '',
      'Bravo',
      'alpha',
    ])

    // name: empty name sorts last regardless of direction.
    expect(sortPlayers(players, 'name', 'asc').map((p) => p.name)).toEqual([
      'alpha',
      'Bravo',
      'Charlie',
      '',
    ])
    expect(sortPlayers(players, 'name', 'desc').map((p) => p.name)).toEqual([
      'Charlie',
      'Bravo',
      'alpha',
      '',
    ])
  })
})
