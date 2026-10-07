import { describe, expect, it } from 'vitest'
import { all, clear, only, prune, range, single, toggle } from './selection'

const ORDER = ['a', 'b', 'c', 'd', 'e']

describe('selection', () => {
  it('toggle adds and removes one demo and moves the anchor to it', () => {
    const added = toggle(only('a'), 'c')
    expect(added).toEqual({ ids: ['a', 'c'], anchor: 'c' })
    expect(toggle(added, 'a')).toEqual({ ids: ['c'], anchor: 'a' })
  })

  it('range selects the visible order between anchor and target', () => {
    expect(range(only('b'), 'd', ORDER).ids).toEqual(['b', 'c', 'd'])
    expect(range(only('d'), 'b', ORDER).ids).toEqual(['b', 'c', 'd'])
  })

  it('range keeps the anchor so a second range re-grows from the same row', () => {
    const first = range(only('b'), 'e', ORDER)
    expect(range(first, 'c', ORDER)).toEqual({ ids: ['b', 'c'], anchor: 'b' })
  })

  it('range without an anchor in view selects just the target', () => {
    expect(range(clear(), 'c', ORDER)).toEqual({ ids: ['c'], anchor: 'c' })
    expect(range(only('x'), 'c', ORDER)).toEqual({ ids: ['c'], anchor: 'c' })
  })

  it('all selects every visible row', () => {
    expect(all(ORDER).ids).toEqual(ORDER)
    expect(all([]).anchor).toBeNull()
  })

  it('clear selects nothing', () => {
    expect(clear()).toEqual({ ids: [], anchor: null })
  })

  it('prune drops rows that are no longer visible and keeps the object when nothing changed', () => {
    const selection = { ids: ['a', 'b', 'c'], anchor: 'b' }
    expect(prune(selection, ['a', 'c'])).toEqual({ ids: ['a', 'c'], anchor: null })
    expect(prune(selection, ORDER)).toBe(selection)
  })

  it('single names a demo only when exactly one is selected', () => {
    expect(single(only('a'))).toBe('a')
    expect(single(toggle(only('a'), 'b'))).toBeNull()
    expect(single(clear())).toBeNull()
  })
})
