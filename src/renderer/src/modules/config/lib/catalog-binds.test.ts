import { describe, expect, it } from 'vitest'
import { DROPPABLES, MOVEMENT_ACTIONS, WEAPON_ACTIONS, WEAPON_EXTRA_ACTIONS } from '@shared/config/action-catalog'
import type { ConfigAction } from '@shared/modules/config'
import {
  applyAmmo,
  applyMessage,
  applySlot,
  buildDropGroups,
  buildMovementRows,
  buildWeaponRows,
  deriveRowState,
  type CatalogRow,
} from './catalog-binds'

function findAction(actions: ConfigAction[], row: CatalogRow): ConfigAction | undefined {
  return actions.find((action) => action.catalogId === row.catalogId)
}

describe('buildMovementRows', () => {
  it('yields exactly one row per MOVEMENT_ACTIONS entry', () => {
    const rows = buildMovementRows()

    expect(rows).toHaveLength(MOVEMENT_ACTIONS.length)
    expect(rows.every((row) => row.categoryId === 'movement')).toBe(true)
    expect(rows.every((row) => row.ammoCommand === undefined)).toBe(true)
    expect(rows.map((row) => row.catalogId)).toContain('movement:forward')
  })

  it('carries the `continuous` flag through from the catalogue', () => {
    const rows = buildMovementRows()
    const forward = rows.find((row) => row.catalogId === 'movement:forward')
    const centerview = rows.find((row) => row.catalogId === 'movement:centerview')

    expect(forward?.continuous).toBe(true)
    expect(centerview?.continuous).toBeUndefined()
  })
})

describe('buildWeaponRows', () => {
  it('splits into the use-weapon group and the cycling group', () => {
    const { useRows, extraRows } = buildWeaponRows()

    expect(useRows).toHaveLength(WEAPON_ACTIONS.length)
    expect(useRows).toHaveLength(11)
    expect(useRows.map((row) => row.catalogId)).toContain('weaponUse:use_blaster')
    expect(useRows.every((row) => row.categoryId === 'weapons' && row.ammoCommand === undefined)).toBe(true)

    expect(extraRows).toHaveLength(WEAPON_EXTRA_ACTIONS.length)
    expect(extraRows).toHaveLength(3)
    expect(extraRows.map((row) => row.catalogId)).toEqual([
      'weaponExtra:weapnext',
      'weaponExtra:weapprev',
      'weaponExtra:weaplast',
    ])
  })
})

describe('buildDropGroups', () => {
  it('groups DROPPABLES into weapon/ammo/misc, excluding the Blaster', () => {
    const { weapon, ammo, misc } = buildDropGroups()

    expect(weapon).toHaveLength(DROPPABLES.filter((d) => d.kind === 'weapon').length)
    expect(ammo).toHaveLength(DROPPABLES.filter((d) => d.kind === 'ammo').length)
    expect(misc).toHaveLength(DROPPABLES.filter((d) => d.kind === 'powerup' || d.kind === 'tech').length)

    expect(weapon.some((row) => row.catalogId === 'dropWeapon:blaster')).toBe(false)
  })

  it('gives ammo-having droppables an ammoCommand and the rest none', () => {
    const { weapon, ammo } = buildDropGroups()

    const rlauncher = weapon.find((row) => row.catalogId === 'dropWeapon:rlauncher')
    expect(rlauncher?.commands).toEqual(['drop rocket launcher'])
    expect(rlauncher?.ammoCommand).toBe('drop rockets')

    // Ammo rows (e.g. plain "rockets") have no ammo of their own to offer.
    const rockets = ammo.find((row) => row.catalogId === 'dropAmmo:rockets')
    expect(rockets?.ammoCommand).toBeUndefined()
  })
})

describe('deriveRowState', () => {
  const row = buildMovementRows()[0]!

  it('returns the "nothing bound" default for an undefined action', () => {
    expect(deriveRowState(undefined, row)).toEqual({
      primary: undefined,
      secondary: undefined,
      withAmmo: true,
      message: '',
    })
  })
})

describe('applySlot', () => {
  const row = buildMovementRows().find((r) => r.catalogId === 'movement:forward')!

  it('round-trips primary/secondary assignment, then clearing, then pruning', () => {
    let actions: ConfigAction[] = []

    actions = applySlot(actions, row, 'primary', 'w')
    expect(deriveRowState(findAction(actions, row), row).primary).toBe('w')
    expect(deriveRowState(findAction(actions, row), row).secondary).toBeUndefined()

    actions = applySlot(actions, row, 'secondary', 'UPARROW')
    expect(deriveRowState(findAction(actions, row), row)).toMatchObject({ primary: 'w', secondary: 'UPARROW' })

    actions = applySlot(actions, row, 'primary', undefined)
    const afterClearingPrimary = findAction(actions, row)
    expect(afterClearingPrimary).toBeDefined()
    expect(deriveRowState(afterClearingPrimary, row)).toMatchObject({ primary: undefined, secondary: 'UPARROW' })

    actions = applySlot(actions, row, 'secondary', undefined)
    expect(findAction(actions, row)).toBeUndefined()
  })

  it('never mutates the array it was given', () => {
    const original: ConfigAction[] = []
    const result = applySlot(original, row, 'primary', 'w')

    expect(original).toEqual([])
    expect(result).not.toBe(original)
  })

  it('materializes a lazily-created action with catalogId, categoryId and a plain name', () => {
    const actions = applySlot([], row, 'primary', 'w')
    const created = findAction(actions, row)!

    expect(created.catalogId).toBe('movement:forward')
    expect(created.categoryId).toBe('movement')
    expect(created.name).toBe('+forward')
  })
})

describe('applyAmmo', () => {
  const row = buildDropGroups().weapon.find((r) => r.catalogId === 'dropWeapon:rlauncher')!

  it('removes the ammo raw command but keeps the item command when turned off, and re-adds it when turned back on', () => {
    let actions = applySlot([], row, 'primary', 'f')
    expect(findAction(actions, row)!.commands).toEqual([
      { kind: 'raw', text: 'drop rocket launcher' },
      { kind: 'raw', text: 'drop rockets' },
    ])

    actions = applyAmmo(actions, row, false)
    expect(findAction(actions, row)!.commands).toEqual([{ kind: 'raw', text: 'drop rocket launcher' }])

    actions = applyAmmo(actions, row, true)
    expect(findAction(actions, row)!.commands).toEqual([
      { kind: 'raw', text: 'drop rocket launcher' },
      { kind: 'raw', text: 'drop rockets' },
    ])
  })

  it('is a no-op for a row with no ammoCommand', () => {
    const misc = buildDropGroups().misc.find((r) => r.catalogId === 'dropMisc:quad')!
    let actions = applySlot([], misc, 'primary', 'f')
    const before = actions

    actions = applyAmmo(actions, misc, false)

    expect(actions).toEqual(before)
  })

  it('an ammo toggle alone (no key, no message) does not keep an action alive', () => {
    const actions = applyAmmo([], row, false)
    expect(findAction(actions, row)).toBeUndefined()
  })
})

describe('applyMessage', () => {
  const row = buildDropGroups().weapon.find((r) => r.catalogId === 'dropWeapon:rlauncher')!

  it('creates a message-only action (no key) on a fresh row', () => {
    const actions = applyMessage([], row, 'HELP')
    const created = findAction(actions, row)!

    expect(created.key).toBeUndefined()
    expect(created.secondaryKey).toBeUndefined()
    expect(deriveRowState(created, row).message).toBe('HELP')
  })

  it('replaces rather than duplicates the message on a second call', () => {
    let actions = applyMessage([], row, 'HELP')
    actions = applyMessage(actions, row, 'INCOMING')

    const created = findAction(actions, row)!
    const messageCommands = created.commands.filter(
      (command) => command.kind === 'message' && command.channel === 'say_team',
    )
    expect(messageCommands).toHaveLength(1)
    expect(deriveRowState(created, row).message).toBe('INCOMING')
  })

  it('clearing the message to \'\' removes it and prunes the action when nothing else is set', () => {
    let actions = applyMessage([], row, 'HELP')
    actions = applyMessage(actions, row, '')

    expect(findAction(actions, row)).toBeUndefined()
  })

  it('clearing the message leaves the action in place when a key is still set', () => {
    let actions = applySlot([], row, 'primary', 'f')
    actions = applyMessage(actions, row, 'HELP')
    actions = applyMessage(actions, row, '')

    const remaining = findAction(actions, row)
    expect(remaining).toBeDefined()
    expect(deriveRowState(remaining, row).message).toBe('')
    expect(deriveRowState(remaining, row).primary).toBe('f')
  })
})

describe('command ordering', () => {
  it('orders commands as [drop <item>, drop <ammo>, message] after setting key + ammo + message', () => {
    const row = buildDropGroups().weapon.find((r) => r.catalogId === 'dropWeapon:rlauncher')!

    let actions = applySlot([], row, 'primary', 'f')
    actions = applyAmmo(actions, row, true)
    actions = applyMessage(actions, row, 'Rockets incoming!')

    const created = findAction(actions, row)!
    expect(created.commands).toEqual([
      { kind: 'raw', text: 'drop rocket launcher' },
      { kind: 'raw', text: 'drop rockets' },
      { kind: 'message', channel: 'say_team', text: 'Rockets incoming!' },
    ])
  })
})
