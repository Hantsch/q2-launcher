import { describe, expect, it } from 'vitest'
import type { ConfigAction, ConfigActionCategory, ConfigProfile } from '@shared/modules/config'
import { renderProfileFile } from '@shared/config/render'
import {
  buildMoveTargets,
  entryPlacementOptions,
  moveCategory,
  moveEntryToCategory,
  moveEntryToDropTarget,
  moveEntryToPosition,
  moveEntryToSubcategory,
  moveSubcategory,
  swapEntries,
} from './entry-order'
import { groupControlsRowEntries } from './controls-row-groups'
import type { ControlsRowEntry } from './controls-row-entries'

function action(id: string, categoryId: string, subcategoryId?: string): ConfigAction {
  return {
    id,
    categoryId,
    name: id,
    kind: 'bind',
    commands: [],
    ...(subcategoryId ? { subcategoryId } : {}),
  }
}

/** A plain (non-catalogue) row entry - grouping reads `action.subcategoryId` for these (story 053
 * D5), so a `subcategoryId` given here still lands the row in that sub-category's group. */
function entry(action: ConfigAction): ControlsRowEntry {
  return { kind: 'action', action }
}

const WEAPON_USE_SUBCATEGORIES = [
  { id: 'weaponUse', name: 'Use weapon' },
  { id: 'weaponExtra', name: 'Cycling' },
]

describe('swapEntries', () => {
  it('swaps the two named entries, wherever they sit in the array', () => {
    const actions = [action('a1', 'c1'), action('a2', 'c1'), action('a3', 'c1')]

    expect(swapEntries(actions, 'a2', 'a1').map((a) => a.id)).toEqual(['a2', 'a1', 'a3'])
    expect(swapEntries(actions, 'a2', 'a3').map((a) => a.id)).toEqual(['a1', 'a3', 'a2'])
  })

  it('leaves every entry between the two exactly where it was', () => {
    // Story 052 review (finding 4): the two swapped rows share a catalogue group, the entries
    // between them do not - they must not shift, in the array or on screen.
    const actions = [action('a1', 'c1'), action('b1', 'c2'), action('a2', 'c1')]

    const result = swapEntries(actions, 'a2', 'a1')

    expect(result.map((a) => a.id)).toEqual(['a2', 'b1', 'a1'])
    expect(result[1]).toBe(actions[1])
  })

  it('is a no-op when either id is missing, or both name the same entry', () => {
    const actions = [action('a1', 'c1'), action('a2', 'c1')]

    expect(swapEntries(actions, 'missing', 'a1')).toBe(actions)
    expect(swapEntries(actions, 'a1', 'missing')).toBe(actions)
    expect(swapEntries(actions, 'a1', 'a1')).toBe(actions)
  })

  it('returns a new array instance without mutating the input', () => {
    const actions = [action('a1', 'c1'), action('a2', 'c1')]
    const original = [...actions]

    const result = swapEntries(actions, 'a1', 'a2')

    expect(actions).toEqual(original)
    expect(result).not.toBe(actions)
  })
})

describe('buildMoveTargets', () => {
  it('names the previous/next row of the same group, and nothing at either end', () => {
    const groups = groupControlsRowEntries(
      [
        entry(action('a1', 'weapons', 'weaponUse')),
        entry(action('a2', 'weapons', 'weaponUse')),
        entry(action('a3', 'weapons', 'weaponUse')),
      ],
      WEAPON_USE_SUBCATEGORIES,
    )

    const targets = buildMoveTargets(groups)

    expect(targets.get('a1')).toEqual({ up: undefined, down: 'a2' })
    expect(targets.get('a2')).toEqual({ up: 'a1', down: 'a3' })
    expect(targets.get('a3')).toEqual({ up: 'a2', down: undefined })
  })

  it('never names a row of another catalogue group across a group boundary', () => {
    // The bug this exists to prevent: "Use weapon" ends and "Cycling" begins, so the last
    // `weaponUse` row's move-down used to swap with the first `weaponExtra` row - a real mutation
    // with no visible effect, because each row stayed inside its own group's contiguous run.
    const groups = groupControlsRowEntries(
      [
        entry(action('a1', 'weapons', 'weaponUse')),
        entry(action('a2', 'weapons', 'weaponUse')),
        entry(action('b1', 'weapons', 'weaponExtra')),
        entry(action('b2', 'weapons', 'weaponExtra')),
      ],
      WEAPON_USE_SUBCATEGORIES,
    )

    const targets = buildMoveTargets(groups)

    expect(targets.get('a2')?.down).toBeUndefined()
    expect(targets.get('b1')?.up).toBeUndefined()
    expect(targets.get('b1')?.down).toBe('b2')
  })

  it('pairs rows of one group across an interleaved row of another', () => {
    // Grouping keeps each group's entries in array order but not contiguous in the array itself,
    // so a group's neighbour can sit two array positions away - the swap is still visible, because
    // both rows render inside the same group.
    const groups = groupControlsRowEntries(
      [
        entry(action('a1', 'weapons', 'weaponUse')),
        entry(action('b1', 'weapons', 'weaponExtra')),
        entry(action('a2', 'weapons', 'weaponUse')),
      ],
      WEAPON_USE_SUBCATEGORIES,
    )

    const targets = buildMoveTargets(groups)

    expect(targets.get('a2')?.up).toBe('a1')
    expect(targets.get('b1')).toEqual({ up: undefined, down: undefined })
  })

  it('treats every ungrouped row as one run', () => {
    // Entries with no `subcategoryId` (movement never has sub-categories) and one whose
    // `subcategoryId` matches nothing all collapse into the single `subcategory: null` bucket, so
    // they move against each other.
    const groups = groupControlsRowEntries([
      entry(action('m1', 'movement', 'no-such-subcategory')),
      entry(action('f1', 'movement')),
    ])

    const targets = buildMoveTargets(groups)

    expect(targets.get('m1')?.down).toBe('f1')
    expect(targets.get('f1')?.up).toBe('m1')
  })

  it('gives a row that is alone in its group no target on either side', () => {
    const groups = groupControlsRowEntries(
      [entry(action('a1', 'weapons', 'weaponUse'))],
      WEAPON_USE_SUBCATEGORIES,
    )

    expect(buildMoveTargets(groups).get('a1')).toEqual({ up: undefined, down: undefined })
  })
})

describe('moveEntryToPosition', () => {
  it('moves an entry immediately before a named target, wherever it sits', () => {
    const actions = [action('a1', 'c1'), action('a2', 'c1'), action('a3', 'c1')]

    expect(moveEntryToPosition(actions, 'a3', 'a1').map((a) => a.id)).toEqual(['a3', 'a1', 'a2'])
    expect(moveEntryToPosition(actions, 'a1', 'a3').map((a) => a.id)).toEqual(['a2', 'a1', 'a3'])
  })

  it('moves an entry to the end of the array on "end"', () => {
    const actions = [action('a1', 'c1'), action('a2', 'c1'), action('a3', 'c1')]

    expect(moveEntryToPosition(actions, 'a1', 'end').map((a) => a.id)).toEqual(['a2', 'a3', 'a1'])
  })

  it('is a no-op when the moved id is unknown', () => {
    const actions = [action('a1', 'c1'), action('a2', 'c1')]

    expect(moveEntryToPosition(actions, 'missing', 'a1')).toBe(actions)
  })

  it('is a no-op when the target id is unknown, including "the entry before itself"', () => {
    const actions = [action('a1', 'c1'), action('a2', 'c1')]

    expect(moveEntryToPosition(actions, 'a1', 'missing')).toBe(actions)
    expect(moveEntryToPosition(actions, 'a1', 'a1')).toBe(actions)
  })
})

describe('moveEntryToSubcategory', () => {
  it('moves an entry into a different sub-category at a specific position', () => {
    const actions = [
      action('a1', 'weapons', 'weaponUse'),
      action('a2', 'weapons', 'weaponUse'),
      action('b1', 'weapons', 'weaponExtra'),
      action('b2', 'weapons', 'weaponExtra'),
    ]

    const result = moveEntryToSubcategory(actions, 'a1', 'weaponExtra', 'b2')

    expect(result.map((a) => a.id)).toEqual(['a2', 'b1', 'a1', 'b2'])
    expect(result.find((a) => a.id === 'a1')?.subcategoryId).toBe('weaponExtra')
  })

  it('appends to the end of the target sub-category\'s run on "end"', () => {
    const actions = [
      action('a1', 'weapons', 'weaponUse'),
      action('b1', 'weapons', 'weaponExtra'),
      action('a2', 'weapons', 'weaponUse'),
    ]

    const result = moveEntryToSubcategory(actions, 'a1', 'weaponExtra', 'end')

    expect(result.map((a) => a.id)).toEqual(['b1', 'a2', 'a1'])
    expect(result.find((a) => a.id === 'a1')?.subcategoryId).toBe('weaponExtra')
  })

  it('is a no-op when the moved id is unknown', () => {
    const actions = [action('a1', 'weapons', 'weaponUse'), action('b1', 'weapons', 'weaponExtra')]

    expect(moveEntryToSubcategory(actions, 'missing', 'weaponExtra', 'end')).toBe(actions)
  })

  it('is a no-op when the target position is unknown', () => {
    const actions = [action('a1', 'weapons', 'weaponUse'), action('b1', 'weapons', 'weaponExtra')]

    expect(moveEntryToSubcategory(actions, 'a1', 'weaponExtra', 'missing')).toBe(actions)
  })
})

describe('moveEntryToCategory', () => {
  it("moves an entry to a different category, appended at the end of that category's run", () => {
    const actions = [
      action('a1', 'weapons'),
      action('b1', 'movement'),
      action('a2', 'weapons'),
      action('b2', 'movement'),
    ]

    const result = moveEntryToCategory(actions, 'a1', 'movement')

    expect(result.map((a) => a.id)).toEqual(['b1', 'a2', 'b2', 'a1'])
    expect(result.find((a) => a.id === 'a1')?.categoryId).toBe('movement')
  })

  it('appends to a fresh (previously empty) category at the end of the array', () => {
    const actions = [action('a1', 'weapons'), action('a2', 'weapons')]

    const result = moveEntryToCategory(actions, 'a1', 'drops')

    expect(result.map((a) => a.id)).toEqual(['a2', 'a1'])
    expect(result.find((a) => a.id === 'a1')?.categoryId).toBe('drops')
  })

  it('drops the old subcategoryId, since it belonged to the old category', () => {
    const actions = [action('a1', 'weapons', 'weaponUse'), action('b1', 'movement')]

    const result = moveEntryToCategory(actions, 'a1', 'movement')

    expect(result.find((a) => a.id === 'a1')?.subcategoryId).toBeUndefined()
    expect('subcategoryId' in result.find((a) => a.id === 'a1')!).toBe(false)
  })

  it('is a no-op when the moved id is unknown', () => {
    const actions = [action('a1', 'weapons'), action('b1', 'movement')]

    expect(moveEntryToCategory(actions, 'missing', 'movement')).toBe(actions)
  })
})

function category(
  id: string,
  subcategories?: ConfigActionCategory['subcategories'],
): ConfigActionCategory {
  return { id, name: id, ...(subcategories ? { subcategories } : {}) }
}

describe('moveCategory', () => {
  it('reorders the categories array by index', () => {
    const categories = [category('c1'), category('c2'), category('c3')]

    expect(moveCategory(categories, 'c3', 0).map((c) => c.id)).toEqual(['c3', 'c1', 'c2'])
    expect(moveCategory(categories, 'c1', 1).map((c) => c.id)).toEqual(['c2', 'c1', 'c3'])
  })

  it('is a no-op when the id is unknown', () => {
    const categories = [category('c1'), category('c2')]

    expect(moveCategory(categories, 'missing', 0)).toBe(categories)
  })
})

describe('moveSubcategory', () => {
  it("reorders a category's sub-categories array by index", () => {
    const cat = category('weapons', [
      { id: 'weaponUse', name: 'Use weapon' },
      { id: 'weaponExtra', name: 'Cycling' },
      { id: 'weaponAlt', name: 'Alt fire' },
    ])

    const result = moveSubcategory(cat, 'weaponAlt', 0)

    expect(result.subcategories?.map((s) => s.id)).toEqual([
      'weaponAlt',
      'weaponUse',
      'weaponExtra',
    ])
    expect(result).not.toBe(cat)
  })

  it('is a no-op when the id is unknown', () => {
    const cat = category('weapons', [
      { id: 'weaponUse', name: 'Use weapon' },
      { id: 'weaponExtra', name: 'Cycling' },
    ])

    expect(moveSubcategory(cat, 'missing', 0)).toBe(cat)
  })

  it('is a no-op when the category has no sub-categories', () => {
    const cat = category('weapons')

    expect(moveSubcategory(cat, 'anything', 0)).toBe(cat)
  })
})

describe('moveEntryToDropTarget', () => {
  const actions = [
    action('a1', 'weapons', 'weaponUse'),
    action('b1', 'weapons', 'weaponExtra'),
    action('u1', 'weapons'),
    action('a2', 'weapons', 'weaponUse'),
  ]

  it('keeps the sub-category when the drop stayed inside it', () => {
    const result = moveEntryToDropTarget(actions, {
      id: 'a1',
      fromSubcategoryId: 'weaponUse',
      toSubcategoryId: 'weaponUse',
      before: 'end',
    })

    expect(result.map((a) => a.id)).toEqual(['b1', 'u1', 'a2', 'a1'])
    expect(result.find((a) => a.id === 'a1')?.subcategoryId).toBe('weaponUse')
  })

  it('re-homes the entry when the drop landed in a sibling sub-category', () => {
    const result = moveEntryToDropTarget(actions, {
      id: 'b1',
      fromSubcategoryId: 'weaponExtra',
      toSubcategoryId: 'weaponUse',
      before: 'a1',
    })

    expect(result.map((a) => a.id)).toEqual(['b1', 'a1', 'u1', 'a2'])
    expect(result.find((a) => a.id === 'b1')?.subcategoryId).toBe('weaponUse')
  })

  it('removes the sub-category entirely when the drop landed in the ungrouped run', () => {
    const result = moveEntryToDropTarget(actions, {
      id: 'a1',
      fromSubcategoryId: 'weaponUse',
      toSubcategoryId: undefined,
      before: 'u1',
    })

    expect(result.map((a) => a.id)).toEqual(['b1', 'a1', 'u1', 'a2'])
    // Not stored as `''` or a dangling id that merely renders as ungrouped - the key is gone, the
    // way `moveEntryToCategory` drops it when an entry leaves its category.
    expect('subcategoryId' in result.find((a) => a.id === 'a1')!).toBe(false)
  })

  it('is a no-op (same array reference) when the drop names an id the array does not have', () => {
    expect(
      moveEntryToDropTarget(actions, {
        id: 'missing',
        fromSubcategoryId: undefined,
        toSubcategoryId: 'weaponUse',
        before: 'a1',
      }),
    ).toBe(actions)
    expect(
      moveEntryToDropTarget(actions, {
        id: 'a1',
        fromSubcategoryId: 'weaponUse',
        toSubcategoryId: 'weaponUse',
        before: 'gone',
      }),
    ).toBe(actions)
  })
})

describe('entryPlacementOptions', () => {
  it("flattens every category's own run, then each of its sub-categories, in order", () => {
    const categories = [
      category('movement'),
      category('weapons', [
        { id: 'weaponUse', name: 'Use weapon' },
        { id: 'weaponExtra', name: 'Cycling' },
      ]),
    ]

    const options = entryPlacementOptions(categories, (c) => c.name)

    expect(options).toEqual([
      { categoryId: 'movement', label: 'movement' },
      { categoryId: 'weapons', label: 'weapons' },
      { categoryId: 'weapons', subcategoryId: 'weaponUse', label: 'weapons / Use weapon' },
      { categoryId: 'weapons', subcategoryId: 'weaponExtra', label: 'weapons / Cycling' },
    ])
  })

  it('returns an empty list for an empty categories array', () => {
    expect(entryPlacementOptions([], (c) => c.name)).toEqual([])
  })
})

/**
 * Story 054 D11: the render half of "order survives save, discard and render" - `moveCategory`,
 * `moveSubcategory` and `moveEntryToPosition` are pure array-position helpers (tested against their
 * own return values above), but the acceptance line is about the *file* a reorder produces. This
 * pins that a profile built from one of those helpers' output renders its categories/sub-categories/
 * rows in the NEW order - the full render(parse(render)) round trip over the same reordered shape
 * lives in `round-trip.test.ts` (a main-process test, since the real file parser is main-only), so
 * this only needs to show the write side: `renderProfileFile` follows the reordered arrays.
 */
describe('story 054 D11: a reorder renders in its new order', () => {
  function profile(overrides: Partial<ConfigProfile>): ConfigProfile {
    return {
      id: 'p1',
      name: 'Profile',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      cvars: {},
      binds: {},
      assignments: [],
      ...overrides,
    }
  }

  /** A bound entry with a real command and key, so it renders both an `alias` and a `bind` line -
   * `entry-order.test.ts`'s own `action()` helper above builds keyless, commandless rows (fine for
   * pure array-position assertions), but this describe block needs a real rendered line to key its
   * order assertions off. */
  function boundAction(id: string, categoryId: string, subcategoryId: string | undefined, key: string): ConfigAction {
    return {
      id,
      categoryId,
      name: id,
      kind: 'bind',
      commands: [{ kind: 'raw', text: `echo ${id}` }],
      keys: [{ key }],
      ...(subcategoryId ? { subcategoryId } : {}),
    }
  }

  it('moveCategory: the rendered file emits the category sections in the new order', () => {
    const categories = [category('alpha'), category('bravo'), category('charlie')]
    const actions = [
      boundAction('a1', 'alpha', undefined, '1'),
      boundAction('b1', 'bravo', undefined, '2'),
      boundAction('c1', 'charlie', undefined, '3'),
    ]
    const reordered = moveCategory(categories, 'charlie', 0)

    const text = renderProfileFile(profile({ categories: reordered, actions }))
    const sectionOrder = [...text.matchAll(/^\/\/ --- Aliases: (\S+) /gm)].map((m) => m[1])
    expect(sectionOrder).toEqual(['charlie', 'alpha', 'bravo'])
  })

  it('moveSubcategory: the rendered file emits the sub-category banners in the new order', () => {
    const cat = category('weapons', [
      { id: 'weaponUse', name: 'Use' },
      { id: 'weaponExtra', name: 'Cycling' },
      { id: 'weaponAlt', name: 'Alt' },
    ])
    const actions = [
      boundAction('a1', 'weapons', 'weaponUse', '1'),
      boundAction('a2', 'weapons', 'weaponExtra', '2'),
      boundAction('a3', 'weapons', 'weaponAlt', '3'),
    ]
    const reordered = moveSubcategory(cat, 'weaponAlt', 0)

    const text = renderProfileFile(profile({ categories: [reordered], actions }))
    const banners = [...new Set([...text.matchAll(/^\/\/ --- (\S+) \[q2l sub=/gm)].map((m) => m[1]))]
    expect(banners).toEqual(['Alt', 'Use', 'Cycling'])
  })

  it('moveEntryToPosition: the rendered file lists the entry lines in the new order', () => {
    const actions = [
      boundAction('first', 'c1', undefined, '1'),
      boundAction('second', 'c1', undefined, '2'),
      boundAction('third', 'c1', undefined, '3'),
    ]
    const reordered = moveEntryToPosition(actions, 'third', 'first')

    const text = renderProfileFile(profile({ categories: [category('c1')], actions: reordered }))
    const aliasOrder = [...text.matchAll(/^alias (\S+) /gm)].map((m) => m[1])
    expect(aliasOrder).toEqual(['third', 'first', 'second'])
  })
})
