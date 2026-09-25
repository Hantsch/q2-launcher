import { describe, expect, it } from 'vitest'
import {
  EMPTY_SERVER_LIST_FILTER,
  filterOptions,
  filterServers,
  isFilterActive,
  matchesFilter,
  matchesSearch,
} from './list-filter'
import type { ServerListFilter } from './list-filter'
import type { ServerListRow } from '../modules/servers'

function row(overrides: Partial<ServerListRow>): ServerListRow {
  return {
    address: '10.0.0.1:27910',
    origins: [],
    status: 'online',
    favourite: false,
    lastSeenAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

const filter = (overrides: Partial<ServerListFilter>): ServerListFilter => ({
  ...EMPTY_SERVER_LIST_FILTER,
  ...overrides,
})

// Fixture rows covering every dimension the filter engine cares about.
const rocket = row({
  address: '10.0.0.1:27910',
  name: 'Rocket Arena',
  mod: 'CTF',
  map: 'q2dm1',
  gamemode: 'ctf',
  players: 4,
  maxclients: 8,
  needpass: false,
})

const full = row({
  address: '10.0.0.2:27910',
  name: 'Full House',
  mod: 'baseq2',
  map: 'q2dm2',
  gamemode: 'deathmatch',
  players: 8,
  maxclients: 8,
  needpass: true,
})

const empty = row({
  address: '10.0.0.3:27910',
  name: 'Empty Server',
  mod: 'baseq2',
  map: 'Q2DM1', // deliberately different case than `rocket`'s map for case-insensitivity checks
  gamemode: 'deathmatch',
  players: 0,
  maxclients: 16,
  needpass: false,
})

const waiting = row({
  address: '10.0.0.4:27910',
  name: 'Lonely Duelist',
  mod: 'baseq2',
  map: 'q2dm3',
  gamemode: 'single',
  players: 1,
  maxclients: 2,
  needpass: false,
})

const unknownFields = row({
  address: '10.0.0.5:27910',
  name: 'Mystery Server',
  status: 'online',
  // mod, map, gamemode, players, maxclients, needpass all left undefined.
})

const stale = row({
  address: '10.0.0.6:27910',
  name: 'Old News',
  status: 'stale',
  mod: 'ctf',
  map: 'q2dm4',
  gamemode: 'ctf',
  players: 2,
  maxclients: 4,
  needpass: false,
})

const pending = row({
  address: '10.0.0.7:27910',
  status: 'pending',
  lastSeenAt: null,
  // No name, no other domain fields at all yet.
})

const roster = row({
  address: '10.0.0.8:27910',
  name: 'Roster Server',
  mod: 'baseq2',
  map: 'q2dm5',
  gamemode: 'deathmatch',
  players: [
    { name: 'Alice', score: 3, ping: 20 },
    { name: 'Bob', score: 1, ping: 40 },
  ],
  maxclients: 8,
  needpass: false,
})

const numericPlayers = row({
  address: '10.0.0.9:27910',
  name: 'Solo Grinder',
  mod: 'baseq2',
  map: 'q2dm6',
  gamemode: 'deathmatch',
  players: 3,
  maxclients: 8,
  needpass: false,
})

const undefinedPlayers = row({
  address: '10.0.0.10:27910',
  name: 'No Roster Yet',
  mod: 'baseq2',
  map: 'q2dm7',
  gamemode: 'deathmatch',
  maxclients: 8,
  needpass: false,
})

const allRows: ServerListRow[] = [
  rocket,
  full,
  empty,
  waiting,
  unknownFields,
  stale,
  pending,
  roster,
  numericPlayers,
  undefinedPlayers,
]

describe('each filter applied alone keeps exactly the rows that satisfy it', () => {
  it('mod, case-insensitive, excludes rows with an unknown mod', () => {
    const result = filterServers(allRows, filter({ mod: 'ctf' }))
    expect(result).toEqual([rocket, stale])
  })

  it('gamemode excludes rows with an unknown gamemode', () => {
    const result = filterServers(allRows, filter({ gamemode: 'deathmatch' }))
    expect(result).toEqual([full, empty, roster, numericPlayers, undefinedPlayers])
  })

  it('nonEmpty excludes the 0-player row and rows with an unknown count', () => {
    const result = filterServers(allRows, filter({ nonEmpty: true }))
    expect(result).toEqual([rocket, full, waiting, stale, roster, numericPlayers])
  })

  it('notFull excludes the full row and rows with an unknown count or maxclients', () => {
    const result = filterServers(allRows, filter({ notFull: true }))
    expect(result).toEqual([rocket, empty, waiting, stale, roster, numericPlayers])
  })

  it('noPassword excludes the passworded row and rows with an unknown needpass', () => {
    const result = filterServers(allRows, filter({ noPassword: true }))
    expect(result).toEqual([rocket, empty, waiting, stale, roster, numericPlayers, undefinedPlayers])
  })

  it('waitingForOpponent keeps only the exactly-one-player row', () => {
    const result = filterServers(allRows, filter({ waitingForOpponent: true }))
    expect(result).toEqual([waiting])
  })

  it('map, case-insensitive, matches the stale row on its last-known value', () => {
    const result = filterServers(allRows, filter({ map: 'q2dm1' }))
    expect(result).toEqual([rocket, empty])
  })

  it('a stale row filters on its last-known field values like any other', () => {
    const result = filterServers(allRows, filter({ mod: 'ctf', gamemode: 'ctf' }))
    expect(result).toContainEqual(stale)
  })
})

describe('active filters intersect', () => {
  it('two filters combined give the intersection of what each alone would give', () => {
    const byMod = filterServers(allRows, filter({ mod: 'baseq2' }))
    const byNonEmpty = filterServers(allRows, filter({ nonEmpty: true }))
    const combined = filterServers(allRows, filter({ mod: 'baseq2', nonEmpty: true }))

    const expected = allRows.filter((r) => byMod.includes(r) && byNonEmpty.includes(r))
    expect(combined).toEqual(expected)
    expect(combined).toEqual([full, waiting, roster, numericPlayers])
  })

  it('three filters combined give the intersection of what each alone would give', () => {
    const combined = filterServers(
      allRows,
      filter({ mod: 'baseq2', nonEmpty: true, noPassword: true }),
    )
    expect(combined).toEqual([waiting, roster, numericPlayers])
  })

  it('an unsatisfiable combination yields an empty result', () => {
    const combined = filterServers(allRows, filter({ nonEmpty: true, mod: 'does-not-exist' }))
    expect(combined).toEqual([])
  })
})

describe('no active filter lists every row, empty servers included', () => {
  it('returns exactly the same rows in the same order for the empty filter', () => {
    const result = filterServers(allRows, EMPTY_SERVER_LIST_FILTER)
    expect(result).toEqual(allRows)
    expect(result).not.toBe(allRows)
    expect(result).toContain(empty)
    expect(result).toContain(pending)
  })

  it('a whitespace-only search counts as no search', () => {
    expect(isFilterActive(filter({ search: '   ' }))).toBe(false)
    const result = filterServers(allRows, filter({ search: '   ' }))
    expect(result).toEqual(allRows)
  })
})

describe('search matches server name or address for every row', () => {
  it('finds a named row by its name', () => {
    expect(matchesSearch(rocket, 'rocket')).toBe(true)
  })

  it('finds a pending row (no name) by its address', () => {
    expect(matchesSearch(pending, '10.0.0.7')).toBe(true)
  })

  it('finds a numeric-players row by its name', () => {
    expect(matchesSearch(numericPlayers, 'solo')).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(matchesSearch(rocket, 'ROCKET ARENA')).toBe(true)
  })

  it('does not match an unrelated term', () => {
    expect(matchesSearch(rocket, 'nonexistent')).toBe(false)
  })
})

describe('search matches player names only where a roster was fetched', () => {
  it('finds the roster row by one of its player names', () => {
    expect(matchesSearch(roster, 'alice')).toBe(true)
    expect(matchesSearch(roster, 'bob')).toBe(true)
  })

  it('a numeric-count row is not found by a name search, and is simply excluded, not penalized', () => {
    expect(matchesSearch(numericPlayers, 'alice')).toBe(false)
    // Still matches everything else normally.
    expect(matchesSearch(numericPlayers, 'solo grinder')).toBe(true)
  })

  it('an undefined-players row is not found by a name search', () => {
    expect(matchesSearch(undefinedPlayers, 'alice')).toBe(false)
    expect(matchesSearch(undefinedPlayers, 'no roster yet')).toBe(true)
  })
})

describe('filtering preserves the input order', () => {
  it('the result is a subsequence of the input in the same relative order', () => {
    const shuffled = [
      undefinedPlayers,
      rocket,
      pending,
      stale,
      numericPlayers,
      empty,
      roster,
      full,
      waiting,
      unknownFields,
    ]
    const result = filterServers(shuffled, filter({ noPassword: true }))

    const indices = result.map((r) => shuffled.indexOf(r))
    const sortedIndices = [...indices].sort((a, b) => a - b)
    expect(indices).toEqual(sortedIndices)
    expect(result.every((r) => matchesFilter(r, filter({ noPassword: true })))).toBe(true)
  })
})

describe('filter options are distinct, case-insensitive and sorted', () => {
  it('deduplicates case-insensitively (first spelling wins) and sorts with localeCompare', () => {
    const rows: ServerListRow[] = [
      row({ address: 'a', mod: 'baseq2', map: 'q2dm1' }),
      row({ address: 'b', mod: 'BASEQ2', map: 'Q2DM1' }),
      row({ address: 'c', mod: 'CTF', map: 'q2dm2' }),
      row({ address: 'd', mod: undefined, map: undefined }),
    ]
    const options = filterOptions(rows)
    expect(options.mods).toEqual(['baseq2', 'CTF'])
    expect(options.maps).toEqual(['q2dm1', 'q2dm2'])
  })

  it('across the full fixture set, gives distinct case-insensitive sorted values', () => {
    const options = filterOptions(allRows)
    // `rocket`'s 'CTF' and `stale`'s 'ctf' collide case-insensitively; `rocket` comes first.
    expect(options.mods).toContain('CTF')
    expect(options.mods).not.toContain('ctf')
    expect(new Set(options.mods.map((m) => m.toLowerCase())).size).toBe(options.mods.length)
    expect(options.mods).toEqual([...options.mods].sort((a, b) => a.localeCompare(b)))
    expect(options.maps.length).toBeGreaterThan(0)
    expect(new Set(options.maps.map((m) => m.toLowerCase())).size).toBe(options.maps.length)
    expect(options.maps).toEqual([...options.maps].sort((a, b) => a.localeCompare(b)))
  })
})
