import { describe, expect, it } from 'vitest'
import type { ConfigAction } from '@shared/modules/config'
import { introducesOrphanCategory } from './orphan-category'

const act = (id: string, categoryId: string): ConfigAction => ({
  id,
  categoryId,
  name: id,
  kind: 'bind',
  commands: [{ kind: 'raw', text: 'drop rl' }],
})
const cats = [{ id: 'weapons', name: 'Weapons' }]

describe('introducesOrphanCategory', () => {
  it('accepts actions whose categories exist', () => {
    expect(introducesOrphanCategory([], [act('a', 'weapons')], cats)).toBe(false)
  })

  it('refuses a new action in a missing category', () => {
    expect(introducesOrphanCategory([], [act('a', 'gone')], cats)).toBe(true)
  })

  it('refuses an existing action moved into a missing category', () => {
    expect(introducesOrphanCategory([act('a', 'weapons')], [act('a', 'gone')], cats)).toBe(true)
  })

  it('grandfathers an action already stored under the same missing category', () => {
    expect(introducesOrphanCategory([act('a', 'gone')], [act('a', 'gone')], [])).toBe(false)
  })
})
