import { describe, expect, it } from 'vitest'
import { categoryDisplayName } from './category-display'

const resolver = {
  t: (key: string) => (key === 'config.controls.categories.movement' ? 'Movement' : key),
  exists: (key: string) => key === 'config.controls.categories.movement',
}

describe('categoryDisplayName', () => {
  it('prefers a nameKey the renderer knows over the stored prose', () => {
    expect(
      categoryDisplayName(
        { id: 'movement', name: 'Movement', nameKey: 'config.controls.categories.movement' },
        resolver,
      ),
    ).toBe('Movement')
  })

  it('shows the stored prose for a category with no nameKey (renamed or user-authored)', () => {
    expect(categoryDisplayName({ id: 'c1', name: 'My own category' }, resolver)).toBe(
      'My own category',
    )
  })

  it('falls back to the stored prose for a nameKey this build does not have', () => {
    // Story 052 review (finding 9): a hint from an older build or a hand-edited state.json - `t`
    // would return the key itself, which must never reach the rail.
    expect(
      categoryDisplayName(
        { id: 'movement', name: 'Movement', nameKey: 'config.controls.categories.retired' },
        resolver,
      ),
    ).toBe('Movement')
  })

  it('falls back to the stored prose for an empty nameKey', () => {
    expect(categoryDisplayName({ id: 'c1', name: 'Imported', nameKey: '' }, resolver)).toBe(
      'Imported',
    )
  })
})
