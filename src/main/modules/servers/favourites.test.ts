import { describe, expect, it } from 'vitest'
import { DEFAULT_SERVERS_STATE, type FavouriteServerEntry, type ServersState } from '@shared/modules/servers'
import { addFavourite, listFavourites, removeFavourite } from './favourites'

/**
 * Story 112 D2: the three pure favourites ops. Everything here is state in, list out - no
 * `StateStore`, no `AppContext` (mirrors `master-sources.test.ts`'s scope for this module).
 */

function stateWith(favourites: FavouriteServerEntry[]): ServersState {
  return { ...DEFAULT_SERVERS_STATE, favourites }
}

describe('listFavourites', () => {
  it('returns the current favourites sorted by addedAt ascending', () => {
    const state = stateWith([
      { address: '10.0.0.2:27910', addedAt: '2024-01-02T00:00:00.000Z' },
      { address: '10.0.0.1:27910', addedAt: '2024-01-01T00:00:00.000Z' },
    ])

    expect(listFavourites(state).map((f) => f.address)).toEqual(['10.0.0.1:27910', '10.0.0.2:27910'])
  })
})

describe('addFavourite / removeFavourite', () => {
  it('a marked address appears in the list and an unmarked one is gone (AC2)', () => {
    const state = stateWith([])

    const afterAdd = addFavourite(state, '10.0.0.1:27910')
    expect(afterAdd.map((f) => f.address)).toEqual(['10.0.0.1:27910'])

    const afterRemove = removeFavourite(stateWith(afterAdd), '10.0.0.1:27910')
    expect(afterRemove).toEqual([])
  })

  it('the same address marked twice stays one entry, and unmarking removes exactly it (AC4)', () => {
    const state = stateWith([])
    const onceAdded = addFavourite(state, '10.0.0.1:27910')
    const twiceAdded = addFavourite(stateWith(onceAdded), '10.0.0.1:27910')

    expect(twiceAdded).toHaveLength(1)
    expect(twiceAdded.map((f) => f.address)).toEqual(['10.0.0.1:27910'])

    const removed = removeFavourite(stateWith(twiceAdded), '10.0.0.1:27910')
    expect(removed).toEqual([])
  })

  it('two differently-spelled forms of the same address collapse to one entry (AC4)', () => {
    const state = stateWith([])
    const added = addFavourite(state, '  10.0.0.1:27910  ')
    const addedAgain = addFavourite(stateWith(added), '10.0.0.1:27910')

    expect(addedAgain).toHaveLength(1)
  })

  it('an address no scan has ever seen can be marked (AC5)', () => {
    const state = stateWith([])
    const result = addFavourite(state, '203.0.113.9:27920')

    expect(result).toHaveLength(1)
    expect(result[0]?.address).toBe('203.0.113.9:27920')
  })

  it('adding an already-favourite address keeps the original addedAt and creates no duplicate', () => {
    const original: FavouriteServerEntry = {
      address: '10.0.0.1:27910',
      addedAt: '2024-01-01T00:00:00.000Z',
    }
    const state = stateWith([original])

    const result = addFavourite(state, '10.0.0.1:27910')

    expect(result).toHaveLength(1)
    expect(result[0]).toEqual(original)
  })

  it('removing an address that is not a favourite is a no-op that succeeds', () => {
    const original: FavouriteServerEntry = {
      address: '10.0.0.1:27910',
      addedAt: '2024-01-01T00:00:00.000Z',
    }
    const state = stateWith([original])

    const result = removeFavourite(state, '10.0.0.2:27910')

    expect(result).toEqual([original])
  })

  it('does not mutate the input state or its favourites array', () => {
    const original: FavouriteServerEntry = {
      address: '10.0.0.1:27910',
      addedAt: '2024-01-01T00:00:00.000Z',
    }
    const favourites = [original]
    const state = stateWith(favourites)

    addFavourite(state, '10.0.0.2:27910')
    removeFavourite(state, '10.0.0.1:27910')

    expect(state.favourites).toBe(favourites)
    expect(state.favourites).toEqual([original])
    expect(favourites[0]).toBe(original)
  })
})
