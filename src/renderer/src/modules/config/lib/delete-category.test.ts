import { describe, expect, it } from 'vitest'
import type { ConfigAction, ConfigActionCategory } from '@shared/modules/config'
import { applyCategoryDeletion } from './delete-category'

function category(id: string, name = id): ConfigActionCategory {
  return { id, name }
}

function action(id: string, categoryId: string): ConfigAction {
  return { id, categoryId, name: id, kind: 'bind', commands: [] }
}

describe('applyCategoryDeletion', () => {
  const categories = [category('movement'), category('weapons'), category('drops')]
  const actions = [
    action('a1', 'movement'),
    action('a2', 'movement'),
    action('a3', 'weapons'),
  ]

  it("removes the category and its entries for choice 'delete'", () => {
    const result = applyCategoryDeletion(categories, actions, 'movement', 'delete')
    expect(result.categories.map((c) => c.id)).toEqual(['weapons', 'drops'])
    expect(result.actions.map((a) => a.id)).toEqual(['a3'])
  })

  it("moves the category's entries to the target category for choice 'move'", () => {
    const result = applyCategoryDeletion(categories, actions, 'movement', 'move', 'weapons')
    expect(result.categories.map((c) => c.id)).toEqual(['weapons', 'drops'])
    // Both former-movement entries now live under weapons, alongside the pre-existing one.
    expect(result.actions).toEqual([
      { ...action('a1', 'weapons') },
      { ...action('a2', 'weapons') },
      { ...action('a3', 'weapons') },
    ])
  })

  it('leaves entries of other categories untouched by either choice', () => {
    const deleted = applyCategoryDeletion(categories, actions, 'movement', 'delete')
    const moved = applyCategoryDeletion(categories, actions, 'movement', 'move', 'weapons')
    expect(deleted.actions.find((a) => a.id === 'a3')).toEqual(action('a3', 'weapons'))
    expect(moved.actions.find((a) => a.id === 'a3')).toEqual(action('a3', 'weapons'))
  })

  it("falls back to delete when choice is 'move' but no target is given", () => {
    const result = applyCategoryDeletion(categories, actions, 'movement', 'move', undefined)
    expect(result.actions.map((a) => a.id)).toEqual(['a3'])
  })

  it('is a no-op on the entries of a category with none', () => {
    const result = applyCategoryDeletion(categories, actions, 'drops', 'move', 'weapons')
    expect(result.categories.map((c) => c.id)).toEqual(['movement', 'weapons'])
    expect(result.actions).toEqual(actions)
  })
})
