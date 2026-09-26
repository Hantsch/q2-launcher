import { describe, expect, it } from 'vitest'
import { NATURAL_DIRECTION, nextSort, sortServerRows } from './list-sort'
import type { ServerListSort } from './list-sort'
import type { ServerListRow } from '../modules/servers'

let counter = 0

function makeRow(partial: Partial<ServerListRow> = {}): ServerListRow {
  counter += 1
  return {
    address: `10.0.0.${counter}:27910`,
    origins: ['manual'],
    status: 'online',
    lastSeenAt: null,
    favourite: false,
    ...partial,
  }
}

describe('sortServerRows — default order', () => {
  it('default order: favourites first, then occupancy descending', () => {
    const a = makeRow({ players: 2, favourite: false })
    const b = makeRow({ players: 10, favourite: true })
    const c = makeRow({ players: 10, favourite: false })
    const d = makeRow({ players: 0, favourite: false })

    const result = sortServerRows([a, b, c, d], undefined)

    expect(result).toEqual([b, c, a, d])
  })

  it('gamemode only breaks occupancy ties and never groups', () => {
    const dm1 = makeRow({ players: 1, gamemode: 'deathmatch' })
    const ctf6 = makeRow({ players: 6, gamemode: 'ctf' })
    const dm3 = makeRow({ players: 3, gamemode: 'deathmatch' })
    const ctf3 = makeRow({ players: 3, gamemode: 'ctf' })

    const result = sortServerRows([dm1, ctf6, dm3, ctf3], undefined)

    expect(result).toEqual([ctf6, dm3, ctf3, dm1])
  })

  it('unknown player count sorts below zero', () => {
    const zero = makeRow({ players: 0 })
    const unknown = makeRow({ players: undefined })

    const result = sortServerRows([unknown, zero], undefined)

    expect(result).toEqual([zero, unknown])
  })

  it('the order is total: name then address break the remaining ties', () => {
    const alpha = makeRow({ players: 3, gamemode: 'deathmatch', name: 'Alpha', address: 'a:1' })
    const bravo = makeRow({ players: 3, gamemode: 'deathmatch', name: 'Bravo', address: 'b:1' })
    const charlie = makeRow({ players: 3, gamemode: 'deathmatch', name: 'Charlie', address: 'c:1' })

    const expected = [alpha, bravo, charlie]

    expect(sortServerRows([charlie, alpha, bravo], undefined)).toEqual(expected)
    expect(sortServerRows([bravo, charlie, alpha], undefined)).toEqual(expected)
    expect(sortServerRows([alpha, bravo, charlie], undefined)).toEqual(expected)
  })
})

describe('sortServerRows — column sort', () => {
  it('a column sort keeps favourites pinned and orders by the column in both directions', () => {
    const fav = makeRow({ favourite: true, map: 'q2dm5' })
    const zzz = makeRow({ favourite: false, map: 'zzz' })
    const aaa = makeRow({ favourite: false, map: 'aaa' })
    const mmm = makeRow({ favourite: false, map: 'mmm' })

    const asc: ServerListSort = { column: 'map', direction: 'asc' }
    expect(sortServerRows([zzz, aaa, mmm, fav], asc)).toEqual([fav, aaa, mmm, zzz])

    const desc: ServerListSort = { column: 'map', direction: 'desc' }
    expect(sortServerRows([zzz, aaa, mmm, fav], desc)).toEqual([fav, zzz, mmm, aaa])
  })

  it('an unknown column value sorts last in both directions', () => {
    const known = makeRow({ rttMs: 50 })
    const unknown = makeRow({ rttMs: undefined })

    const asc: ServerListSort = { column: 'ping', direction: 'asc' }
    expect(sortServerRows([unknown, known], asc)).toEqual([known, unknown])

    const desc: ServerListSort = { column: 'ping', direction: 'desc' }
    expect(sortServerRows([unknown, known], desc)).toEqual([known, unknown])
  })
})

describe('nextSort', () => {
  it('cycles natural, reversed, default', () => {
    const natural = nextSort(undefined, 'ping')
    expect(natural).toEqual({ column: 'ping', direction: NATURAL_DIRECTION.ping })

    const reversed = nextSort(natural, 'ping')
    expect(reversed).toEqual({ column: 'ping', direction: 'desc' })

    const backToDefault = nextSort(reversed, 'ping')
    expect(backToDefault).toBeUndefined()

    // Switching to a different column always starts at that column's natural direction.
    const otherColumn = nextSort(reversed, 'name')
    expect(otherColumn).toEqual({ column: 'name', direction: NATURAL_DIRECTION.name })
  })
})

describe('sortServerRows — purity', () => {
  it('does not mutate its input', () => {
    const rows = [makeRow({ players: 1 }), makeRow({ players: 5 }), makeRow({ players: 3 })]
    const original = [...rows]

    sortServerRows(rows, undefined)
    sortServerRows(rows, { column: 'players', direction: 'asc' })

    expect(rows).toEqual(original)
  })
})
