import { describe, expect, it } from 'vitest'
import { allCatalogRows } from '@shared/config/catalog-rows'
import { STANDARD_TEMPLATE } from '@shared/modules/config'
import type { ConfigAction } from '@shared/modules/config'
import { applyAmmo, applyMessage, applySlot, deriveRowState, withCatalogBody } from './catalog-binds'
import {
  buildControlsRowEntries,
  catalogRowInfo,
  controlsRowEntryFor,
} from './controls-row-entries'
import { groupControlsRowEntries } from './controls-row-groups'
import { buildMoveTargets, swapEntries } from './entry-order'

function action(overrides: Partial<ConfigAction> & { id: string }): ConfigAction {
  return {
    categoryId: 'movement',
    name: overrides.id,
    kind: 'bind',
    commands: [],
    ...overrides,
  }
}

/** A catalogue-backed entry as `STANDARD_TEMPLATE`/the D6 migration seed it: real entry, real
 * `catalogId`, nothing bound yet. */
function seeded(catalogId: string, categoryId: string, id = `entry-${catalogId}`): ConfigAction {
  return action({ id, categoryId, catalogId, name: catalogId })
}

describe('buildControlsRowEntries', () => {
  /**
   * Story 052 AC 3, the whole point of D8: the three former built-in categories used to render one
   * row per *catalogue* entry, so a profile that carried three drop entries still showed dozens of
   * "Empty" rows it did not have.
   */
  it('renders no row for a catalogue entry the profile does not have', () => {
    const actions = [seeded('dropWeapon:rlauncher', 'drops')]

    const rows = buildControlsRowEntries('drops', actions)

    expect(rows).toHaveLength(1)
    expect(rows[0]!.action.catalogId).toBe('dropWeapon:rlauncher')
    // Every other catalogue row exists in the catalogue and in no row of this profile's.
    expect(allCatalogRows().length).toBeGreaterThan(50)
  })

  it('renders one row per entry of the category, in the profile\'s own array order', () => {
    const actions = [
      seeded('movement:back', 'movement', 'b'),
      action({ id: 'free', categoryId: 'movement', name: 'My own bind' }),
      seeded('movement:forward', 'movement', 'f'),
      seeded('weaponUse:use_railgun', 'weapons', 'w'),
    ]

    const rows = buildControlsRowEntries('movement', actions)

    expect(rows.map((entry) => entry.action.id)).toEqual(['b', 'free', 'f'])
  })

  it('scopes rows to the selected category, and shows nothing for a category with no entries', () => {
    const actions = [seeded('movement:forward', 'movement', 'f')]

    expect(buildControlsRowEntries('weapons', actions)).toEqual([])
    expect(buildControlsRowEntries('imported', actions)).toEqual([])
  })

  it('renders a catalogue-backed entry as a catalogue row, with its label key and row', () => {
    const entry = seeded('movement:forward', 'movement')

    const [row] = buildControlsRowEntries('movement', [entry])

    expect(row).toMatchObject({
      kind: 'catalog',
      labelKey: 'config.actionCatalog.forward.label',
      action: entry,
    })
    expect(row!.kind === 'catalog' && row.row.commands).toEqual(['+forward'])
  })

  it('renders a free-form entry, and one naming a retired catalogue row, as a plain row', () => {
    const free = action({ id: 'free', categoryId: 'custom', name: 'My own bind' })
    const retired = action({ id: 'old', categoryId: 'custom', catalogId: 'movement:teleport' })

    expect(buildControlsRowEntries('custom', [free, retired])).toEqual([
      { kind: 'action', action: free },
      { kind: 'action', action: retired },
    ])
  })

  /** Every row is an entry, so every row has an id a move can reorder - which is what makes a move
   * usable on a catalogue row at all (AC 3, "every row can be moved"). Driven exactly as
   * `ControlsTab` drives it since the review's finding 4: the target comes from the rendered
   * groups, the swap is by the two ids. */
  it('follows a move within the category, and the moved array is what a save would carry', () => {
    const actions = [
      seeded('movement:forward', 'movement', 'f'),
      seeded('movement:back', 'movement', 'b'),
      seeded('weaponUse:use_railgun', 'weapons', 'w'),
    ]

    const targets = buildMoveTargets(
      groupControlsRowEntries(buildControlsRowEntries('movement', actions)),
    )
    const moved = swapEntries(actions, 'b', targets.get('b')!.up!)

    expect(buildControlsRowEntries('movement', moved).map((entry) => entry.action.id)).toEqual([
      'b',
      'f',
    ])
    // The foreign-category entry never moves - `setActions` gets one array for the whole profile.
    expect(moved.map((entry: ConfigAction) => entry.id)).toEqual(['b', 'f', 'w'])
  })

  it('builds a full template profile\'s rows out of its own actions, one per seeded entry', () => {
    const actions = STANDARD_TEMPLATE.actions.map((entry) => ({ ...entry }))

    const movement = buildControlsRowEntries('movement', actions)
    const weapons = buildControlsRowEntries('weapons', actions)
    const drops = buildControlsRowEntries('drops', actions)

    expect(movement.length + weapons.length + drops.length).toBe(STANDARD_TEMPLATE.actions.length)
    expect([...movement, ...weapons, ...drops].every((entry) => entry.kind === 'catalog')).toBe(true)
  })
})

/**
 * Story 052 D8's real risk: the four editing paths of a catalogue-backed row (dual bind, ammo,
 * message, clear) used to run through find-or-lazily-create-then-prune helpers. Driven here in the
 * exact order `ControlsTab` drives them - `withCatalogBody` first for an assignment, then the `id`-
 * keyed write - the row must stay a row throughout and end up with sane commands.
 */
describe('editing a catalogue-backed row, as ControlsTab drives it', () => {
  const rowInfo = catalogRowInfo('dropWeapon:rlauncher')!
  const id = 'entry-rlauncher'
  const seedProfile = (): ConfigAction[] => [
    seeded('dropWeapon:rlauncher', 'drops', id),
    action({ id: 'other', categoryId: 'drops', name: 'Other drop' }),
  ]
  const rowOf = (actions: ConfigAction[]): ConfigAction | undefined =>
    buildControlsRowEntries('drops', actions).find((entry) => entry.action.id === id)?.action

  it('binds, toggles ammo, writes and clears a message, and clears the binds - the row survives all of it', () => {
    let actions = seedProfile()

    // 1. Primary bind: the assignment materialises the row's catalogue body, so the key runs
    //    something rather than pointing at an empty alias.
    actions = applySlot(withCatalogBody(actions, id, rowInfo.row), id, 'primary', 'f')
    expect(rowOf(actions)!.commands).toEqual([
      { kind: 'raw', text: 'drop rocket launcher' },
      { kind: 'raw', text: 'drop rockets' },
    ])
    expect(deriveRowState(rowOf(actions)!, rowInfo.row)).toMatchObject({
      primary: 'f',
      withAmmo: true,
    })

    // 2. Secondary bind, with a modifier.
    actions = applySlot(withCatalogBody(actions, id, rowInfo.row), id, 'secondary', 'r', 'ALT')
    expect(deriveRowState(rowOf(actions)!, rowInfo.row)).toMatchObject({
      secondary: 'r',
      secondaryModifier: 'ALT',
    })

    // 3. "With ammo" off.
    actions = applyAmmo(actions, id, rowInfo.row, false)
    expect(rowOf(actions)!.commands).toEqual([{ kind: 'raw', text: 'drop rocket launcher' }])

    // 4. "With message" on, then edited through the message editor.
    actions = applyMessage(withCatalogBody(actions, id, rowInfo.row), id, 'rockets!', 'say_team')
    expect(deriveRowState(rowOf(actions)!, rowInfo.row)).toMatchObject({
      message: 'rockets!',
      messageChannel: 'say_team',
      withAmmo: false,
      primary: 'f',
    })

    // 5. "With message" off again: the message goes, the drop command and the binds stay.
    actions = applyMessage(actions, id, '')
    expect(rowOf(actions)!.commands).toEqual([{ kind: 'raw', text: 'drop rocket launcher' }])

    // 6. Row reset: both slots cleared. Before D8 this pruned the entry - which would now delete
    //    the row from the grid (AC 3: a row is an entry, and the profile still has this entry).
    actions = applySlot(applySlot(actions, id, 'primary', undefined), id, 'secondary', undefined)
    const row = rowOf(actions)
    expect(row).toBeDefined()
    expect(deriveRowState(row!, rowInfo.row)).toMatchObject({
      primary: undefined,
      secondary: undefined,
    })
    expect(buildControlsRowEntries('drops', actions)).toHaveLength(2)
  })

  it('leaves a free-form neighbour in the same category untouched throughout', () => {
    const actions = applySlot(
      withCatalogBody(seedProfile(), id, rowInfo.row),
      id,
      'primary',
      'f',
    )

    expect(actions.find((entry) => entry.id === 'other')).toEqual(
      seedProfile().find((entry) => entry.id === 'other'),
    )
  })
})

describe('catalogRowInfo / controlsRowEntryFor', () => {
  it('resolves a known catalogId to its row and label key, and nothing for anything else', () => {
    expect(catalogRowInfo('dropWeapon:rlauncher')?.row.ammoCommand).toBe('drop rockets')
    expect(catalogRowInfo('nope:nope')).toBeUndefined()
    expect(catalogRowInfo(undefined)).toBeUndefined()
  })

  it('knows every row the catalogue itself lists', () => {
    expect(allCatalogRows().every((row) => catalogRowInfo(row.catalogId) !== undefined)).toBe(true)
  })

  it('classifies one entry the same way `buildControlsRowEntries` does', () => {
    const entry = seeded('weaponExtra:weapnext', 'weapons')

    expect(controlsRowEntryFor(entry)).toEqual(buildControlsRowEntries('weapons', [entry])[0])
  })
})

/**
 * Story 053 D5: grouping is now real sub-categories (`ConfigActionCategory.subcategories`) plus
 * each entry's `subcategoryId`, not the catalogue-id-prefix rule story 052 D8 still described here.
 * Every subcategory the category has gets its own group, in the category's own order, even one
 * with no rows yet (so it stays visible for D6's CRUD) - the ungrouped run is always first.
 */
describe('groupControlsRowEntries over the profile\'s own rows', () => {
  const dropsCategory = STANDARD_TEMPLATE.categories.find((category) => category.id === 'drops')!
  const subcategories = dropsCategory.subcategories ?? []
  const weaponsSubId = subcategories.find((sub) => sub.name === 'Weapons')!.id
  const ammoSubId = subcategories.find((sub) => sub.name === 'Ammunition')!.id

  it('emits a group per subcategory, in the category\'s own order, including an empty one', () => {
    const actions = [
      action({ id: 'a', categoryId: 'drops', name: 'Rockets', subcategoryId: ammoSubId }),
      action({ id: 'w', categoryId: 'drops', name: 'Launcher', subcategoryId: weaponsSubId }),
    ]

    const groups = groupControlsRowEntries(buildControlsRowEntries('drops', actions), subcategories)

    expect(groups.map((group) => group.subcategory?.name ?? null)).toEqual([
      null,
      'Weapons',
      'Ammunition',
      'Misc',
    ])
    expect(groups.map((group) => group.entries.length)).toEqual([0, 1, 1, 0])
  })

  it('puts a free-form entry, and one whose subcategoryId matches nothing, in the ungrouped run first', () => {
    const actions = [
      action({ id: 'free', categoryId: 'drops', name: 'My own drop' }),
      action({ id: 'stale', categoryId: 'drops', name: 'Orphaned', subcategoryId: 'no-such-id' }),
      action({ id: 'w', categoryId: 'drops', name: 'Launcher', subcategoryId: weaponsSubId }),
    ]

    const groups = groupControlsRowEntries(buildControlsRowEntries('drops', actions), subcategories)

    expect(groups.map((group) => group.subcategory?.name ?? null)).toEqual([
      null,
      'Weapons',
      'Ammunition',
      'Misc',
    ])
    expect(groups[0]!.entries.map((entry) => entry.action.id)).toEqual(['free', 'stale'])
  })
})
