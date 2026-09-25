import { describe, expect, it } from 'vitest'
import { deriveGamemode, isWaitingForOpponent, knownPlayerCount } from './row-markers'

describe('deriveGamemode', () => {
  it('derives each gamemode from its flags', () => {
    expect(deriveGamemode({ ctf: '1' })).toBe('ctf')
    // ctf wins over deathmatch even when both are set.
    expect(deriveGamemode({ ctf: '1', deathmatch: '1' })).toBe('ctf')
    expect(deriveGamemode({ deathmatch: '1', teamplay: '1' })).toBe('team')
    expect(deriveGamemode({ deathmatch: '1' })).toBe('deathmatch')
    expect(deriveGamemode({ coop: '1' })).toBe('coop')
    expect(deriveGamemode({ deathmatch: '0', coop: '0', ctf: '0', teamplay: '0' })).toBe('single')
  })

  it('no mode flag at all means unknown', () => {
    expect(deriveGamemode({})).toBeUndefined()
    expect(deriveGamemode({ deathmatch: 'abc', coop: '', ctf: '3.5', teamplay: 'x' })).toBeUndefined()
  })
})

describe('waiting for an opponent', () => {
  it('is exactly one known player', () => {
    expect(isWaitingForOpponent({ players: 0 })).toBe(false)
    expect(isWaitingForOpponent({ players: 1 })).toBe(true)
    expect(isWaitingForOpponent({ players: 2 })).toBe(false)
    expect(isWaitingForOpponent({ players: [{ name: 'a', score: 0, ping: 0 }] })).toBe(true)
    expect(isWaitingForOpponent({ players: undefined })).toBe(false)
  })

  it('knownPlayerCount reads the array length or the bare number', () => {
    expect(knownPlayerCount({ players: [{ name: 'a', score: 0, ping: 0 }] })).toBe(1)
    expect(knownPlayerCount({ players: 3 })).toBe(3)
    expect(knownPlayerCount({ players: undefined })).toBeUndefined()
  })
})
