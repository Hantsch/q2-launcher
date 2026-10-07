import { describe, expect, it } from 'vitest'
import { equalsIgnoreCase, matchesTerm } from './search'

const VALUES = ['Quad Damage FFA', '10.0.0.1:27910', null, undefined, 'Player']

describe('matchesTerm', () => {
  it('an empty term matches everything', () => {
    expect(matchesTerm('', VALUES)).toBe(true)
    expect(matchesTerm('   ', VALUES)).toBe(true)
    expect(matchesTerm('', [])).toBe(true)
  })

  it('a plain term is a case-insensitive substring', () => {
    expect(matchesTerm('damage', VALUES)).toBe(true)
    expect(matchesTerm('  QUAD  ', VALUES)).toBe(true)
    expect(matchesTerm('27910', VALUES)).toBe(true)
    expect(matchesTerm('railgun', VALUES)).toBe(false)
    expect(matchesTerm('x', [null, undefined])).toBe(false)
  })

  it('a quoted term matches a whole value only', () => {
    expect(matchesTerm('"player"', VALUES)).toBe(true)
    expect(matchesTerm('  "QUAD DAMAGE ffa"  ', VALUES)).toBe(true)
    expect(matchesTerm('"play"', VALUES)).toBe(false)
    expect(matchesTerm('"ffa"', VALUES)).toBe(false)
    // The quoted text is not trimmed: surrounding spaces must be part of the value.
    expect(matchesTerm('" player"', VALUES)).toBe(false)
    expect(matchesTerm('" player"', [' Player'])).toBe(true)
  })

  it('an unclosed, empty or single-quoted term is plain text', () => {
    expect(matchesTerm('"quad', ['say "quad damage'])).toBe(true)
    expect(matchesTerm('"quad', VALUES)).toBe(false)
    expect(matchesTerm('""', ['an "" pair'])).toBe(true)
    expect(matchesTerm('""', VALUES)).toBe(false)
    expect(matchesTerm('"', ['a " quote'])).toBe(true)
    expect(matchesTerm("'player'", ["'player' (tagged)"])).toBe(true)
    expect(matchesTerm("'player'", VALUES)).toBe(false)
  })

  it('accepts any iterable of values', () => {
    expect(matchesTerm('ffa', new Set(['ffa']))).toBe(true)
  })
})

describe('equalsIgnoreCase', () => {
  it('matches the whole value regardless of case and never matches a missing value', () => {
    expect(equalsIgnoreCase('Q2DM1', 'q2dm1')).toBe(true)
    expect(equalsIgnoreCase('q2dm10', 'q2dm1')).toBe(false)
    expect(equalsIgnoreCase(null, 'q2dm1')).toBe(false)
    expect(equalsIgnoreCase(undefined, '')).toBe(false)
  })
})
