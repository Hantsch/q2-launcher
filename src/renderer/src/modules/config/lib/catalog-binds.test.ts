import { describe, expect, it } from 'vitest'
import { DROPPABLES, MOVEMENT_ACTIONS, WEAPON_ACTIONS, WEAPON_EXTRA_ACTIONS } from '@shared/config/action-catalog'
import { renderActionAlias } from '@shared/config/alias-render'
import type { AltLayer } from '@shared/config/alt-layers'
import type { ConfigAction, ConfigCommand, ConfigProfile } from '@shared/modules/config'
import {
  applyAmmo,
  applyMessage,
  applySlot,
  buildDropGroups,
  buildMovementRows,
  buildRowCommandString,
  buildWeaponRows,
  deriveRowState,
  findRowLayerOverride,
  parseRowCommandState,
  type CatalogRow,
} from './catalog-binds'

function findAction(actions: ConfigAction[], row: CatalogRow): ConfigAction | undefined {
  return actions.find((action) => action.catalogId === row.catalogId)
}

function altLayer(overrides: Partial<AltLayer> = {}): AltLayer {
  return {
    id: 'layer-1',
    name: 'Alt',
    mode: 'hold',
    triggerKey: 'ALT',
    overrides: {},
    ...overrides,
  }
}

function profile(overrides: Partial<ConfigProfile> = {}): ConfigProfile {
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

/**
 * Story 016 D3: the single command builder shared by the base-bind path and the
 * modifier-layer path (decision 12). Every case is asserted twice - once
 * against the literal expected string, and once against the alias body
 * `renderActionAlias` produces for a `ConfigAction` carrying the same commands.
 * The second assertion is the concrete proof of AC 5: the string this function
 * hands to `upsertModifierLayerOverride` is byte-identical to what the base
 * path executes, so the two can never render differently. (D2's own tests
 * already covered the other half - that such a string renders identically as a
 * layer override.)
 */
describe('buildRowCommandString', () => {
  /** The body `renderActionAlias` joins these commands into - the base path's rendering. */
  function aliasBodyFor(commands: ConfigCommand[]): string {
    const action: ConfigAction = {
      id: 'aaaa1111-2222-3333-4444-555555555555',
      categoryId: 'drops',
      name: 'probe',
      commands,
    }
    const { aliases } = renderActionAlias(action)
    expect(aliases).toHaveLength(1)
    return aliases[0]!.body
  }

  it('yields just the row command for a movement row (no ammo, no message)', () => {
    const row = buildMovementRows().find((r) => r.catalogId === 'movement:forward')!
    const state = deriveRowState(undefined, row)

    expect(buildRowCommandString(row, state)).toBe('+forward')
    expect(buildRowCommandString(row, state)).toBe(
      aliasBodyFor([{ kind: 'raw', text: '+forward' }]),
    )
  })

  it('appends the ammo command for a drop row with ammo on', () => {
    const row = buildDropGroups().weapon.find((r) => r.catalogId === 'dropWeapon:rlauncher')!
    const actions = applySlot([], row, 'primary', 'r')
    const state = deriveRowState(findAction(actions, row), row)

    expect(state.withAmmo).toBe(true)
    expect(buildRowCommandString(row, state)).toBe('drop rocket launcher; drop rockets')
    expect(buildRowCommandString(row, state)).toBe(
      aliasBodyFor([
        { kind: 'raw', text: 'drop rocket launcher' },
        { kind: 'raw', text: 'drop rockets' },
      ]),
    )
  })

  it('omits the ammo command once ammo is switched off', () => {
    const row = buildDropGroups().weapon.find((r) => r.catalogId === 'dropWeapon:rlauncher')!
    let actions = applySlot([], row, 'primary', 'r')
    actions = applyAmmo(actions, row, false)
    const state = deriveRowState(findAction(actions, row), row)

    expect(buildRowCommandString(row, state)).toBe('drop rocket launcher')
  })

  it('appends the team message last, after the ammo command', () => {
    const row = buildDropGroups().weapon.find((r) => r.catalogId === 'dropWeapon:rlauncher')!
    let actions = applySlot([], row, 'primary', 'r')
    actions = applyMessage(actions, row, 'Rockets incoming!')
    const state = deriveRowState(findAction(actions, row), row)

    expect(buildRowCommandString(row, state)).toBe(
      'drop rocket launcher; drop rockets; say_team Rockets incoming!',
    )
    expect(buildRowCommandString(row, state)).toBe(
      aliasBodyFor([
        { kind: 'raw', text: 'drop rocket launcher' },
        { kind: 'raw', text: 'drop rockets' },
        { kind: 'message', channel: 'say_team', text: 'Rockets incoming!' },
      ]),
    )
  })

  it('ignores a whitespace-only message rather than emitting an empty say_team', () => {
    const row = buildDropGroups().weapon.find((r) => r.catalogId === 'dropWeapon:rlauncher')!
    const state = { ...deriveRowState(undefined, row), message: '   ' }

    expect(buildRowCommandString(row, state)).toBe('drop rocket launcher; drop rockets')
  })
})

/**
 * Review-fix (AC 5): the reverse of `buildRowCommandString` - what lets a
 * layer-only-bound row (no `ConfigAction` at all) read its *actual* current
 * ammo/message state back out of the override's own command text, instead of
 * always reporting `deriveRowState(undefined, row)`'s "nothing bound yet"
 * default regardless of what is really stored (the bug this test file exists
 * to catch: a stale default silently overwriting a real value).
 */
describe('parseRowCommandState', () => {
  const dropRow = buildDropGroups().weapon.find((r) => r.catalogId === 'dropWeapon:rlauncher')!
  const movementRow = buildMovementRows().find((r) => r.catalogId === 'movement:forward')!

  it('round-trips every buildRowCommandString case exactly', () => {
    for (const state of [
      { withAmmo: true, message: '' },
      { withAmmo: false, message: '' },
      { withAmmo: true, message: 'incoming' },
      { withAmmo: false, message: 'incoming' },
    ]) {
      const command = buildRowCommandString(dropRow, { primary: undefined, secondary: undefined, ...state })
      expect(parseRowCommandState(dropRow, command)).toEqual(state)
    }
  })

  it('preserves a message containing its own "; " separator verbatim', () => {
    const command = buildRowCommandString(dropRow, {
      primary: undefined,
      secondary: undefined,
      withAmmo: true,
      message: 'taking rl; watch out',
    })

    expect(parseRowCommandState(dropRow, command)).toEqual({
      withAmmo: true,
      message: 'taking rl; watch out',
    })
  })

  it('reports withAmmo: true for a row with no ammo command at all (movement)', () => {
    expect(parseRowCommandState(movementRow, '+forward')).toEqual({ withAmmo: true, message: '' })
  })

  it('returns null for a command belonging to a different row entirely', () => {
    expect(parseRowCommandState(dropRow, '+forward')).toBeNull()
  })

  it('returns null for trailing content that is not a say_team message', () => {
    expect(parseRowCommandState(dropRow, 'drop rocket launcher; drop rockets; wave 1')).toBeNull()
  })

  it('returns null for an empty string', () => {
    expect(parseRowCommandState(dropRow, '')).toBeNull()
  })
})

describe('findRowLayerOverride', () => {
  const dropRow = buildDropGroups().weapon.find((r) => r.catalogId === 'dropWeapon:rlauncher')!

  it('returns null when no layer holds this row at all', () => {
    expect(findRowLayerOverride(profile(), dropRow)).toBeNull()
  })

  it('finds the row by structural match and reports its actual stored state', () => {
    const layer = altLayer({ id: 'alt-9', overrides: { r: 'drop rocket launcher; say_team incoming' } })

    const found = findRowLayerOverride(profile({ layers: [layer] }), dropRow)

    expect(found).toEqual({
      modifier: 'ALT',
      key: 'r',
      command: 'drop rocket launcher; say_team incoming',
      withAmmo: false,
      message: 'incoming',
    })
  })

  it('matches by triggerKey (a hand-made layer with any name still counts)', () => {
    const layer = altLayer({ name: 'Rocketjump', triggerKey: 'ALT', overrides: { r: 'drop rocket launcher' } })

    expect(findRowLayerOverride(profile({ layers: [layer] }), dropRow)?.modifier).toBe('ALT')
  })

  it('skips a non-modifier layer even if its override structurally matches', () => {
    const layer = altLayer({ triggerKey: 'v', overrides: { '1': 'drop rocket launcher' } })

    expect(findRowLayerOverride(profile({ layers: [layer] }), dropRow)).toBeNull()
  })

  it('skips overrides belonging to a different row', () => {
    const layer = altLayer({ overrides: { r: 'drop grenade launcher' } })

    expect(findRowLayerOverride(profile({ layers: [layer] }), dropRow)).toBeNull()
  })

  it('finds the row regardless of which layer/modifier currently holds it', () => {
    const ctrlLayer = altLayer({ id: 'ctrl-1', name: 'Ctrl', triggerKey: 'CTRL', overrides: { f: 'drop rocket launcher' } })

    const found = findRowLayerOverride(profile({ layers: [ctrlLayer] }), dropRow)

    expect(found?.modifier).toBe('CTRL')
    expect(found?.key).toBe('f')
  })
})
