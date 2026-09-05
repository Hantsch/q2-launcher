import { describe, expect, it } from 'vitest'
import { DROPPABLES, MOVEMENT_ACTIONS, WEAPON_ACTIONS, WEAPON_EXTRA_ACTIONS } from '@shared/config/action-catalog'
import { keySlotAt } from '@shared/config/action-slots'
import type { ConfigAction } from '@shared/modules/config'
import {
  applyAmmo,
  applyMessage,
  applySlot,
  buildDropGroups,
  buildMovementRows,
  buildWeaponRows,
  deriveRowState,
  editorKeySlot,
  withCatalogBody,
  type CatalogRow,
} from './catalog-binds'

function findAction(actions: ConfigAction[], row: CatalogRow): ConfigAction | undefined {
  return actions.find((action) => action.catalogId === row.catalogId)
}

/**
 * A catalogue row's entry as the profile actually carries it since story 052: the template seed
 * (`STANDARD_TEMPLATE`) and D6's migration both materialise every catalogue row as an entry with
 * `commands: []` - present as a row, running nothing until something binds it. `commands` is
 * overridable for the bound/imported case.
 */
function catalogAction(row: CatalogRow, overrides: Partial<ConfigAction> = {}): ConfigAction {
  return {
    id: `entry-${row.catalogId}`,
    categoryId: row.categoryId,
    name: row.commands[0] ?? row.catalogId,
    kind: 'bind',
    catalogId: row.catalogId,
    commands: [],
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
  const dropRow = buildDropGroups().weapon.find((r) => r.catalogId === 'dropWeapon:rlauncher')!

  it('returns the "nothing bound" default for a seeded entry that carries nothing yet', () => {
    expect(deriveRowState(catalogAction(row), row)).toEqual({
      primary: undefined,
      secondary: undefined,
      primaryModifier: undefined,
      secondaryModifier: undefined,
      withAmmo: true,
      message: '',
      messageChannel: undefined,
    })
  })

  /**
   * Story 052 D8: the seeded/migrated shape of a drop row is an entry with `commands: []`, and
   * before D8 that same row had no entry at all and took decision 7's ON default. Reading "no
   * `drop <ammo>` command" off a body-less entry as "the user turned ammo off" would silently flip
   * every migrated drop row's checkbox on the first render after the update.
   */
  it('keeps ammo at its ON default for an entry with no commands yet, and reads it off the body once there is one', () => {
    expect(deriveRowState(catalogAction(dropRow), dropRow).withAmmo).toBe(true)

    const withAmmoCommands = catalogAction(dropRow, {
      commands: [
        { kind: 'raw', text: 'drop rocket launcher' },
        { kind: 'raw', text: 'drop rockets' },
      ],
    })
    expect(deriveRowState(withAmmoCommands, dropRow).withAmmo).toBe(true)

    const withoutAmmoCommand = catalogAction(dropRow, {
      commands: [{ kind: 'raw', text: 'drop rocket launcher' }],
    })
    expect(deriveRowState(withoutAmmoCommand, dropRow).withAmmo).toBe(false)
  })

  /**
   * Story 016 D9: a slot's modifier is read straight off the action, the same
   * way its key is. The point of these cases together is that there is
   * exactly one source for it - no lookup in `layers`, and nothing derived from
   * command text, which is what made the previous design unable to tell two
   * identically-rendering rows apart.
   */
  it('surfaces each slot\'s modifier straight from the action', () => {
    const action = catalogAction(row, {
      commands: [{ kind: 'raw', text: '+forward' }],
      keys: [
        { key: 'r', modifier: 'ALT' },
        { key: 'f', modifier: 'CTRL' },
      ],
    })

    expect(deriveRowState(action, row)).toMatchObject({
      primary: 'r',
      primaryModifier: 'ALT',
      secondary: 'f',
      secondaryModifier: 'CTRL',
    })
  })

  it('reports no modifier for a pre-016 action that carries neither field', () => {
    const action = catalogAction(row, {
      commands: [{ kind: 'raw', text: '+forward' }],
      keys: [{ key: 'w' }, { key: 'UPARROW' }],
    })

    const state = deriveRowState(action, row)
    expect(state.primaryModifier).toBeUndefined()
    expect(state.secondaryModifier).toBeUndefined()
  })

  it('picks up a `say`-channel message and reports its channel', () => {
    const action = catalogAction(row, {
      commands: [
        { kind: 'raw', text: '+forward' },
        { kind: 'message', channel: 'say', text: 'GG' },
      ],
    })

    const state = deriveRowState(action, row)
    expect(state.message).toBe('GG')
    expect(state.messageChannel).toBe('say')
  })
})

/**
 * Story 052 D8: a catalogue row is an ordinary entry, so binding one is `applySlot` keyed by its
 * `id` - the function that used to be `applyPlainSlot`. Nothing here creates an entry and nothing
 * prunes one; the invariants that survive are the modifier/key pairing and slot-position
 * stability.
 */
describe('applySlot', () => {
  const row = buildMovementRows().find((r) => r.catalogId === 'movement:forward')!
  const entry = (): ConfigAction[] => [catalogAction(row)]
  const id = `entry-${row.catalogId}`

  it('round-trips primary/secondary assignment and clearing, keeping the entry throughout', () => {
    let actions = entry()

    actions = applySlot(actions, id, 'primary', 'w')
    expect(deriveRowState(findAction(actions, row)!, row).primary).toBe('w')
    expect(deriveRowState(findAction(actions, row)!, row).secondary).toBeUndefined()

    actions = applySlot(actions, id, 'secondary', 'UPARROW')
    expect(deriveRowState(findAction(actions, row)!, row)).toMatchObject({
      primary: 'w',
      secondary: 'UPARROW',
    })

    actions = applySlot(actions, id, 'primary', undefined)
    expect(deriveRowState(findAction(actions, row)!, row)).toMatchObject({
      primary: undefined,
      secondary: 'UPARROW',
    })

    // Story 052 D8: clearing the last key leaves an unbound *row*, it does not delete the entry -
    // a pruned entry is a row that disappears from the Controls tab (AC 3).
    actions = applySlot(actions, id, 'secondary', undefined)
    expect(findAction(actions, row)).toBeDefined()
    expect(deriveRowState(findAction(actions, row)!, row)).toMatchObject({
      primary: undefined,
      secondary: undefined,
    })
  })

  it('never creates an entry for an id the array does not have', () => {
    const result = applySlot(entry(), 'missing', 'primary', 'w')

    expect(result).toHaveLength(1)
    expect(keySlotAt(result[0]!, 0)).toBeUndefined()
  })

  it('never mutates the array or action it was given', () => {
    const original = entry()
    const result = applySlot(original, id, 'primary', 'w')

    expect(keySlotAt(original[0]!, 0)).toBeUndefined()
    expect(result).not.toBe(original)
    expect(result[0]).not.toBe(original[0])
  })

  /**
   * Story 016 D9: the modifier is stored on the action next to its slot's key,
   * and it is bound to that key in both directions - it never outlives the key
   * it was captured with, and it never leaks into the other slot. Those two
   * invariants are what let main mirror a slot as a base bind or as a layer
   * override from the action alone (`applyActionLayerMirror`), with no
   * half-filled slot to interpret.
   */
  it('stores the modifier alongside the key it was captured with', () => {
    const actions = applySlot(entry(), id, 'primary', 'r', 'ALT')

    expect(keySlotAt(actions[0]!, 0)).toEqual({ key: 'r', modifier: 'ALT' })
  })

  it('keeps the two slots\' keys and modifiers independent', () => {
    let actions = applySlot(entry(), id, 'primary', 'r', 'ALT')
    actions = applySlot(actions, id, 'secondary', 'f', 'CTRL')

    expect(keySlotAt(actions[0]!, 0)).toEqual({ key: 'r', modifier: 'ALT' })
    expect(keySlotAt(actions[0]!, 1)).toEqual({ key: 'f', modifier: 'CTRL' })

    // Rewriting one slot leaves the other's key *and* modifier untouched.
    actions = applySlot(actions, id, 'primary', 'w')
    expect(keySlotAt(actions[0]!, 0)).toEqual({ key: 'w' })
    expect(keySlotAt(actions[0]!, 1)).toEqual({ key: 'f', modifier: 'CTRL' })
  })

  it('clears a slot\'s modifier along with its key', () => {
    let actions = applySlot(entry(), id, 'primary', 'r', 'ALT')
    actions = applySlot(actions, id, 'secondary', 'f', 'SHIFT')
    actions = applySlot(actions, id, 'primary', undefined)

    expect(keySlotAt(actions[0]!, 0)?.key).toBe('')
    expect(keySlotAt(actions[0]!, 0)?.modifier).toBeUndefined()
    expect(keySlotAt(actions[0]!, 1)?.modifier).toBe('SHIFT')
  })

  it('drops a previous modifier when the slot is re-captured as a plain key', () => {
    let actions = applySlot(entry(), id, 'secondary', 'r', 'ALT')
    expect(keySlotAt(actions[0]!, 1)?.modifier).toBe('ALT')

    actions = applySlot(actions, id, 'secondary', 'r')

    expect(keySlotAt(actions[0]!, 1)).toEqual({ key: 'r' })
  })

  /**
   * Story 050 (D5 acceptance criterion): a hand-added third slot (only reachable by editing the
   * `.cfg` directly - `applySlot` never writes index 2+ itself) survives editing or clearing
   * either editable slot, because `applySlot` writes through `withKeySlot` rather than
   * `clearKeySlot` and so never shifts a later slot's array position.
   */
  it('leaves a hand-added third slot untouched when editing or clearing slot 1', () => {
    let actions = applySlot(entry(), id, 'primary', 'w')
    actions = applySlot(actions, id, 'secondary', 'UPARROW')
    // Simulate a hand-edited `.cfg` that added a third bind for this alias.
    actions = actions.map((action) =>
      action.id === id ? { ...action, keys: [...(action.keys ?? []), { key: 'g' }] } : action,
    )

    actions = applySlot(actions, id, 'secondary', 'f')
    expect(keySlotAt(actions[0]!, 1)?.key).toBe('f')
    expect(keySlotAt(actions[0]!, 2)?.key).toBe('g')

    actions = applySlot(actions, id, 'secondary', undefined)
    expect(keySlotAt(actions[0]!, 1)?.key).toBe('')
    expect(keySlotAt(actions[0]!, 2)?.key).toBe('g')
  })

  /** A free-form entry (no `catalogId`) is written by the exact same function - that is the point
   * of story 052 D8: there is no catalogue write path and plain write path any more. */
  it('writes a free-form entry the same way', () => {
    const plain: ConfigAction = {
      id: 'plain-1',
      categoryId: 'custom-1',
      name: 'My action',
      kind: 'bind',
      commands: [],
    }
    const actions = applySlot([plain], 'plain-1', 'primary', 'f')

    expect(keySlotAt(actions[0]!, 0)?.key).toBe('f')
    expect(actions).toHaveLength(1)
  })
})

describe('withCatalogBody', () => {
  const row = buildDropGroups().weapon.find((r) => r.catalogId === 'dropWeapon:rlauncher')!
  const id = `entry-${row.catalogId}`

  it('gives a seeded, body-less entry the row\'s commands, ammo included (decision 7)', () => {
    const actions = withCatalogBody([catalogAction(row)], id, row)

    expect(actions[0]!.commands).toEqual([
      { kind: 'raw', text: 'drop rocket launcher' },
      { kind: 'raw', text: 'drop rockets' },
    ])
  })

  it('leaves an entry that already has commands exactly as it is', () => {
    const existing = catalogAction(row, {
      commands: [{ kind: 'raw', text: 'drop rocket launcher' }],
    })
    const actions = withCatalogBody([existing], id, row)

    expect(actions[0]).toBe(existing)
  })

  it('touches nothing for an unknown id', () => {
    const actions = withCatalogBody([catalogAction(row)], 'missing', row)

    expect(actions[0]!.commands).toEqual([])
  })
})

describe('applyAmmo', () => {
  const row = buildDropGroups().weapon.find((r) => r.catalogId === 'dropWeapon:rlauncher')!
  const id = `entry-${row.catalogId}`

  it('removes the ammo raw command but keeps the item command when turned off, and re-adds it when turned back on', () => {
    let actions = withCatalogBody([catalogAction(row)], id, row)
    expect(findAction(actions, row)!.commands).toEqual([
      { kind: 'raw', text: 'drop rocket launcher' },
      { kind: 'raw', text: 'drop rockets' },
    ])

    actions = applyAmmo(actions, id, row, false)
    expect(findAction(actions, row)!.commands).toEqual([{ kind: 'raw', text: 'drop rocket launcher' }])

    actions = applyAmmo(actions, id, row, true)
    expect(findAction(actions, row)!.commands).toEqual([
      { kind: 'raw', text: 'drop rocket launcher' },
      { kind: 'raw', text: 'drop rockets' },
    ])
  })

  it('is a no-op for a row with no ammoCommand', () => {
    const misc = buildDropGroups().misc.find((r) => r.catalogId === 'dropMisc:quad')!
    const before = [catalogAction(misc)]

    expect(applyAmmo(before, `entry-${misc.catalogId}`, misc, false)).toEqual(before)
  })

  it('is a no-op for an id the array does not have', () => {
    const before = [catalogAction(row)]

    expect(applyAmmo(before, 'missing', row, false)).toEqual(before)
  })

  /** Turning ammo off on a still-unbound row is a real choice the user made about that row
   * (decision 3), so it is written - and the entry keeps its item command, ready for a key. */
  it('turning ammo off on a body-less entry writes the row body without the ammo command', () => {
    const actions = applyAmmo([catalogAction(row)], id, row, false)

    expect(findAction(actions, row)!.commands).toEqual([{ kind: 'raw', text: 'drop rocket launcher' }])
    expect(deriveRowState(findAction(actions, row)!, row).withAmmo).toBe(false)
  })

  it('keeps the row\'s message across an ammo toggle', () => {
    const withMessage = catalogAction(row, {
      commands: [
        { kind: 'raw', text: 'drop rocket launcher' },
        { kind: 'raw', text: 'drop rockets' },
        { kind: 'message', channel: 'say_team', text: 'Rockets!' },
      ],
    })

    const actions = applyAmmo([withMessage], id, row, false)

    expect(findAction(actions, row)!.commands).toEqual([
      { kind: 'raw', text: 'drop rocket launcher' },
      { kind: 'message', channel: 'say_team', text: 'Rockets!' },
    ])
  })
})

describe('applyMessage', () => {
  const row = buildDropGroups().weapon.find((r) => r.catalogId === 'dropWeapon:rlauncher')!
  const id = `entry-${row.catalogId}`
  const bodied = (): ConfigAction[] => withCatalogBody([catalogAction(row)], id, row)

  it('adds the message after the row\'s raw commands', () => {
    const actions = applyMessage(bodied(), id, 'HELP')

    expect(findAction(actions, row)!.commands).toEqual([
      { kind: 'raw', text: 'drop rocket launcher' },
      { kind: 'raw', text: 'drop rockets' },
      { kind: 'message', channel: 'say_team', text: 'HELP' },
    ])
  })

  it('replaces rather than duplicates the message on a second call', () => {
    let actions = applyMessage(bodied(), id, 'HELP')
    actions = applyMessage(actions, id, 'INCOMING')

    const entry = findAction(actions, row)!
    expect(entry.commands.filter((command) => command.kind === 'message')).toHaveLength(1)
    expect(deriveRowState(entry, row).message).toBe('INCOMING')
  })

  /** Story 052 D8: clearing the message removes the command, never the entry - the row stays,
   * unbound and message-less, exactly like any other entry the user emptied out. */
  it('clearing the message to \'\' removes it and keeps the entry and its raw commands', () => {
    let actions = applyMessage(bodied(), id, 'HELP')
    actions = applyMessage(actions, id, '')

    const entry = findAction(actions, row)!
    expect(entry).toBeDefined()
    expect(entry.commands).toEqual([
      { kind: 'raw', text: 'drop rocket launcher' },
      { kind: 'raw', text: 'drop rockets' },
    ])
  })

  it('leaves the entry\'s keys alone', () => {
    let actions = applySlot(bodied(), id, 'primary', 'f')
    actions = applyMessage(actions, id, 'HELP')
    actions = applyMessage(actions, id, '')

    const entry = findAction(actions, row)!
    expect(deriveRowState(entry, row).message).toBe('')
    expect(deriveRowState(entry, row).primary).toBe('f')
  })

  it('writes a `say` channel message when passed, and defaults to `say_team`', () => {
    expect(
      findAction(applyMessage(bodied(), id, 'HELP', 'say'), row)!.commands.find(
        (command) => command.kind === 'message',
      ),
    ).toMatchObject({ kind: 'message', channel: 'say', text: 'HELP' })

    expect(
      findAction(applyMessage(bodied(), id, 'HELP'), row)!.commands.find(
        (command) => command.kind === 'message',
      ),
    ).toMatchObject({ kind: 'message', channel: 'say_team', text: 'HELP' })
  })

  it('is a no-op for an id the array does not have', () => {
    const before = bodied()

    expect(applyMessage(before, 'missing', 'HELP')).toEqual(before)
  })
})

describe('command ordering', () => {
  it('orders commands as [drop <item>, drop <ammo>, message] after binding, ammo and a message', () => {
    const row = buildDropGroups().weapon.find((r) => r.catalogId === 'dropWeapon:rlauncher')!
    const id = `entry-${row.catalogId}`

    // The order the UI drives it in: the first assignment materialises the row's body
    // (`withCatalogBody`, what `freshAction` used to do lazily), then key, ammo and message.
    let actions = applySlot(withCatalogBody([catalogAction(row)], id, row), id, 'primary', 'f')
    actions = applyAmmo(actions, id, row, true)
    actions = applyMessage(actions, id, 'Rockets incoming!')

    expect(findAction(actions, row)!.commands).toEqual([
      { kind: 'raw', text: 'drop rocket launcher' },
      { kind: 'raw', text: 'drop rockets' },
      { kind: 'message', channel: 'say_team', text: 'Rockets incoming!' },
    ])
  })
})

describe('editorKeySlot', () => {
  /** The shape `ActionEditor`/`MessageEditor` are handed: an entry whose slot 0 carries a modifier
   * neither editor has any control for. */
  const altBound = (): ConfigAction => ({
    id: 'msg-1',
    categoryId: 'movement',
    name: 'Taunt',
    kind: 'message',
    commands: [{ kind: 'message', channel: 'say_team', text: 'incoming' }],
    keys: [{ key: 'F1', modifier: 'ALT' }, { key: 'F2' }],
  })

  it('keeps slot 0`s modifier when the editor saves the same key (review finding 2)', () => {
    // `ControlsTab`'s `MessageEditor` save wrote a fresh `{ key: draft.key }` here, so editing a
    // message text turned `Alt+F1` into plain `F1` - and that plain `F1` then took the key away
    // from whatever else held it. The modifier is not the editor's to drop: it has no control for
    // it and cannot even display it.
    expect(editorKeySlot(altBound(), 'F1')).toEqual({ key: 'F1', modifier: 'ALT' })
  })

  it('keeps the modifier when the editor saves a different key', () => {
    expect(editorKeySlot(altBound(), 'F5')).toEqual({ key: 'F5', modifier: 'ALT' })
  })

  it('drops the modifier with the key when the editor clears it', () => {
    // A modifier with no key is not a binding - the same invariant `applySlot` documents - and the
    // slot is blanked in place rather than removed, so slot 1 keeps its position.
    expect(editorKeySlot(altBound(), undefined)).toEqual({ key: '' })
    expect(editorKeySlot(altBound(), '   ')).toEqual({ key: '' })
  })

  it('writes a plain slot for an entry that has no slots at all yet', () => {
    const bare: ConfigAction = {
      id: 'msg-2',
      categoryId: 'movement',
      name: 'Taunt',
      kind: 'message',
      commands: [],
    }

    expect(editorKeySlot(bare, 'F1')).toEqual({ key: 'F1' })
  })
})
