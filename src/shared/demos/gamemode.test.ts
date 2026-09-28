import { describe, expect, it } from 'vitest'
import { OPENTDM_PATTERN_ID } from '../replays/name-patterns'
import {
  describeGamemode,
  gamemodeFilterMatches,
  gamemodeFilterOptions,
  resolveGamemode,
  type EffectiveGamemode,
} from './gamemode'

describe('resolveGamemode', () => {
  it('sidecar wins over name fact and heuristic', () => {
    const result = resolveGamemode({
      sidecar: 'ctf',
      nameFact: 'tdm',
      gameDir: 'ctf',
      playerCount: 2,
    })
    expect(result).toEqual({ value: 'ctf', source: 'sidecar' })
  })

  it('name fact wins over heuristic', () => {
    const result = resolveGamemode({ nameFact: 'duel', gameDir: 'ctf', playerCount: 2 })
    expect(result).toEqual({ value: 'duel', source: 'name' })
  })

  it('heuristic applies when sidecar and name are empty', () => {
    const result = resolveGamemode({ gameDir: 'ctf' })
    expect(result).toEqual({ value: 'ctf', source: 'guessed' })
  })

  it('no rung yields unknown', () => {
    const result = resolveGamemode({})
    expect(result).toEqual({ value: null, source: 'none' })
  })

  it('blank/whitespace-only sidecar falls through to name/heuristic', () => {
    const withName = resolveGamemode({ sidecar: '   ', nameFact: 'duel' })
    expect(withName).toEqual({ value: 'duel', source: 'name' })

    const withHeuristic = resolveGamemode({ sidecar: '', nameFact: '  ', gameDir: 'ctf' })
    expect(withHeuristic).toEqual({ value: 'ctf', source: 'guessed' })
  })

  it('normalises "CTF" (sidecar or name) to ctf', () => {
    expect(resolveGamemode({ sidecar: 'CTF' })).toEqual({ value: 'ctf', source: 'sidecar' })
    expect(resolveGamemode({ nameFact: 'CTF' })).toEqual({ value: 'ctf', source: 'name' })
  })

  it('ctf game dir guesses ctf', () => {
    expect(resolveGamemode({ gameDir: 'CTF' })).toEqual({ value: 'ctf', source: 'guessed' })
  })

  it('exactly two players guesses duel', () => {
    expect(resolveGamemode({ playerCount: 2 })).toEqual({ value: 'duel', source: 'guessed' })
  })

  it('OpenTDM pattern or opentdm dir guesses tdm', () => {
    expect(resolveGamemode({ matchedPatternId: OPENTDM_PATTERN_ID })).toEqual({
      value: 'tdm',
      source: 'guessed',
    })
    expect(resolveGamemode({ gameDir: 'opentdm' })).toEqual({ value: 'tdm', source: 'guessed' })
  })

  it('ctf dir outranks two players', () => {
    expect(resolveGamemode({ gameDir: 'ctf', playerCount: 2 })).toEqual({
      value: 'ctf',
      source: 'guessed',
    })
  })

  it('two players outrank OpenTDM', () => {
    expect(resolveGamemode({ playerCount: 2, matchedPatternId: OPENTDM_PATTERN_ID })).toEqual({
      value: 'duel',
      source: 'guessed',
    })
    expect(resolveGamemode({ playerCount: 2, gameDir: 'opentdm' })).toEqual({
      value: 'duel',
      source: 'guessed',
    })
  })

  it('action dir alone guesses nothing', () => {
    expect(resolveGamemode({ gameDir: 'action', playerCount: 4 })).toEqual({
      value: null,
      source: 'none',
    })
    expect(resolveGamemode({ gameDir: 'baseq2', playerCount: 4 })).toEqual({
      value: null,
      source: 'none',
    })
  })
})

describe('describeGamemode', () => {
  it('known id gets its label key', () => {
    expect(describeGamemode({ value: 'ctf', source: 'sidecar' })).toEqual({
      labelKey: 'replays.gamemode.ctf',
    })
  })

  it('free text is shown verbatim', () => {
    expect(describeGamemode({ value: 'insta-ctf', source: 'name' })).toEqual({
      text: 'insta-ctf',
    })
  })

  it('unknown gets the unknown label key', () => {
    expect(describeGamemode({ value: null, source: 'none' })).toEqual({
      labelKey: 'replays.gamemode.unknown',
    })
  })

  it('a guessed value carries the guessed marker', () => {
    expect(describeGamemode({ value: 'duel', source: 'guessed' })).toEqual({
      labelKey: 'replays.gamemode.duel',
      guessedKey: 'replays.gamemode.guessed',
    })
  })

  it('sidecar and name values carry no guessed marker', () => {
    expect(describeGamemode({ value: 'ctf', source: 'sidecar' })).toEqual({
      labelKey: 'replays.gamemode.ctf',
    })
    expect(describeGamemode({ value: 'ctf', source: 'name' })).toEqual({
      labelKey: 'replays.gamemode.ctf',
    })
  })
})

describe('gamemodeFilterMatches', () => {
  it('a guessed duel matches the duel filter by default', () => {
    const g: EffectiveGamemode = { value: 'duel', source: 'guessed' }
    expect(gamemodeFilterMatches(g, { gamemode: 'duel', excludeGuessed: false })).toBe(true)
  })

  it('excludeGuessed drops guessed rows', () => {
    const g: EffectiveGamemode = { value: 'duel', source: 'guessed' }
    expect(gamemodeFilterMatches(g, { gamemode: 'duel', excludeGuessed: true })).toBe(false)
    expect(gamemodeFilterMatches(g, { gamemode: null, excludeGuessed: true })).toBe(false)
  })

  it('unknown matches only any', () => {
    const g: EffectiveGamemode = { value: null, source: 'none' }
    expect(gamemodeFilterMatches(g, { gamemode: null, excludeGuessed: false })).toBe(true)
    expect(gamemodeFilterMatches(g, { gamemode: null, excludeGuessed: true })).toBe(true)
    expect(gamemodeFilterMatches(g, { gamemode: 'duel', excludeGuessed: false })).toBe(false)
  })

  it('filter options merge guessed and known values', () => {
    const options = gamemodeFilterOptions([
      { value: 'ctf', source: 'sidecar' },
      { value: 'duel', source: 'guessed' },
      { value: null, source: 'none' },
      { value: 'ctf', source: 'guessed' },
    ])
    expect(options).toEqual(['ctf', 'duel'])
  })
})
