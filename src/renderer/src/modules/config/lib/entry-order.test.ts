import { describe, expect, it } from 'vitest'
import type { ConfigAction } from '@shared/modules/config'
import { moveEntryWithinCategory } from './entry-order'

function action(id: string, categoryId: string): ConfigAction {
  return { id, categoryId, name: id, kind: 'bind', commands: [] }
}

describe('moveEntryWithinCategory', () => {
  it('swaps up with the immediate same-category neighbour', () => {
    const actions = [action('a1', 'c1'), action('a2', 'c1'), action('a3', 'c1')]

    const result = moveEntryWithinCategory(actions, 'a2', 'up')

    expect(result.map((a) => a.id)).toEqual(['a2', 'a1', 'a3'])
  })

  it('swaps down with the immediate same-category neighbour', () => {
    const actions = [action('a1', 'c1'), action('a2', 'c1'), action('a3', 'c1')]

    const result = moveEntryWithinCategory(actions, 'a2', 'down')

    expect(result.map((a) => a.id)).toEqual(['a1', 'a3', 'a2'])
  })

  it('is a no-op moving up the first entry of its category', () => {
    const actions = [action('a1', 'c1'), action('a2', 'c1')]

    const result = moveEntryWithinCategory(actions, 'a1', 'up')

    expect(result).toEqual(actions)
  })

  it('is a no-op moving down the last entry of its category', () => {
    const actions = [action('a1', 'c1'), action('a2', 'c1')]

    const result = moveEntryWithinCategory(actions, 'a2', 'down')

    expect(result).toEqual(actions)
  })

  it('is a no-op when the id is not found', () => {
    const actions = [action('a1', 'c1'), action('a2', 'c1')]

    const result = moveEntryWithinCategory(actions, 'missing', 'up')

    expect(result).toEqual(actions)
  })

  it('reaches past a foreign-category entry to swap with the correct same-category neighbour, never moving the foreign entry', () => {
    // c1, c2, c1 - moving the second c1 item ("a2") up must swap with "a1"
    // (index 0), leaving the c2 item ("b1") exactly where it was, at index 1.
    const actions = [action('a1', 'c1'), action('b1', 'c2'), action('a2', 'c1')]

    const result = moveEntryWithinCategory(actions, 'a2', 'up')

    expect(result.map((a) => a.id)).toEqual(['a2', 'b1', 'a1'])
    expect(result.find((a) => a.id === 'b1')).toEqual(actions[1])
  })

  it('never crosses a foreign category to find a same-category neighbour that does not exist on that side', () => {
    // c1, c2 - moving the c1 item down has no same-category neighbour below it,
    // even though a foreign-category entry sits right there.
    const actions = [action('a1', 'c1'), action('b1', 'c2')]

    const result = moveEntryWithinCategory(actions, 'a1', 'down')

    expect(result).toEqual(actions)
  })

  it('returns a new array instance without mutating the input', () => {
    const actions = [action('a1', 'c1'), action('a2', 'c1')]
    const original = [...actions]

    const result = moveEntryWithinCategory(actions, 'a1', 'down')

    expect(actions).toEqual(original)
    expect(result).not.toBe(actions)
  })
})
