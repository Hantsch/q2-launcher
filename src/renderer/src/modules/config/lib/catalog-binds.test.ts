import { describe, expect, it } from 'vitest'
import { DROPPABLES, MOVEMENT_ACTIONS, WEAPON_ACTIONS, WEAPON_EXTRA_ACTIONS } from '@shared/config/action-catalog'
import { keySlotAt } from '@shared/config/action-slots'
import type { ConfigAction } from '@shared/modules/config'
import {
  applyAmmo,
  applyMessage,
  applyPlainSlot,
  applySlot,
  buildDropGroups,
  buildMovementRows,
  buildWeaponRows,
  deriveRowState,
  editorKeySlot,
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
      primaryModifier: undefined,
      secondaryModifier: undefined,
      withAmmo: true,
      message: '',
    })
  })

  /**
   * Story 016 D9: a slot's modifier is read straight off the action, the same
   * way its key is. The point of these three cases together is that there is
   * exactly one source for it - no lookup in `layers`, and nothing derived from
   * command text, which is what made the previous design unable to tell two
   * identically-rendering rows apart.
   */
  it('surfaces each slot\'s modifier straight from the action', () => {
    const action: ConfigAction = {
      id: 'a1',
      categoryId: 'movement',
      name: '+forward',
      kind: 'bind',
      catalogId: row.catalogId,
      commands: [{ kind: 'raw', text: '+forward' }],
      keys: [
        { key: 'r', modifier: 'ALT' },
        { key: 'f', modifier: 'CTRL' },
      ],
    }

    expect(deriveRowState(action, row)).toMatchObject({
      primary: 'r',
      primaryModifier: 'ALT',
      secondary: 'f',
      secondaryModifier: 'CTRL',
    })
  })

  it('reports no modifier for a pre-016 action that carries neither field', () => {
    const action: ConfigAction = {
      id: 'a1',
      categoryId: 'movement',
      name: '+forward',
      kind: 'bind',
      catalogId: row.catalogId,
      commands: [{ kind: 'raw', text: '+forward' }],
      keys: [{ key: 'w' }, { key: 'UPARROW' }],
    }

    const state = deriveRowState(action, row)
    expect(state.primaryModifier).toBeUndefined()
    expect(state.secondaryModifier).toBeUndefined()
  })

  it('reports no modifier when there is no action at all', () => {
    const state = deriveRowState(undefined, row)
    expect(state.primaryModifier).toBeUndefined()
    expect(state.secondaryModifier).toBeUndefined()
  })

  it('picks up a `say`-channel message and reports its channel', () => {
    const action: ConfigAction = {
      id: 'a1',
      categoryId: 'movement',
      name: '+forward',
      kind: 'bind',
      catalogId: row.catalogId,
      commands: [
        { kind: 'raw', text: '+forward' },
        { kind: 'message', channel: 'say', text: 'GG' },
      ],
    }

    const state = deriveRowState(action, row)
    expect(state.message).toBe('GG')
    expect(state.messageChannel).toBe('say')
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

  /**
   * Story 016 D9: the modifier is stored on the action next to its slot's key,
   * and it is bound to that key in both directions - it never outlives the key
   * it was captured with, and it never leaks into the other slot. Those two
   * invariants are what let main mirror a slot as a base bind or as a layer
   * override from the action alone (`applyActionLayerMirror`), with no
   * half-filled slot to interpret.
   */
  it('stores the modifier alongside the key it was captured with', () => {
    const actions = applySlot([], row, 'primary', 'r', 'ALT')
    const created = findAction(actions, row)!

    expect(keySlotAt(created, 0)?.key).toBe('r')
    expect(keySlotAt(created, 0)?.modifier).toBe('ALT')
  })

  it('keeps the two slots\' keys and modifiers independent', () => {
    let actions = applySlot([], row, 'primary', 'r', 'ALT')
    actions = applySlot(actions, row, 'secondary', 'f', 'CTRL')

    let created = findAction(actions, row)!
    expect(keySlotAt(created, 0)).toEqual({ key: 'r', modifier: 'ALT' })
    expect(keySlotAt(created, 1)).toEqual({ key: 'f', modifier: 'CTRL' })

    // Rewriting one slot leaves the other's key *and* modifier untouched.
    actions = applySlot(actions, row, 'primary', 'w')
    created = findAction(actions, row)!
    expect(keySlotAt(created, 0)).toEqual({ key: 'w' })
    expect(keySlotAt(created, 1)).toEqual({ key: 'f', modifier: 'CTRL' })
  })

  it('clears a slot\'s modifier along with its key', () => {
    let actions = applySlot([], row, 'primary', 'r', 'ALT')
    // A second slot keeps the action alive past the prune, so there is something
    // left to assert on.
    actions = applySlot(actions, row, 'secondary', 'f', 'SHIFT')
    actions = applySlot(actions, row, 'primary', undefined)

    const created = findAction(actions, row)!
    expect(keySlotAt(created, 0)?.key).toBe('')
    expect(keySlotAt(created, 0)?.modifier).toBeUndefined()
    expect(keySlotAt(created, 1)?.modifier).toBe('SHIFT')
  })

  it('drops a previous modifier when the slot is re-captured as a plain key', () => {
    let actions = applySlot([], row, 'secondary', 'r', 'ALT')
    expect(keySlotAt(findAction(actions, row)!, 1)?.modifier).toBe('ALT')

    actions = applySlot(actions, row, 'secondary', 'r')

    const created = findAction(actions, row)!
    expect(keySlotAt(created, 1)?.key).toBe('r')
    expect(keySlotAt(created, 1)?.modifier).toBeUndefined()
  })

  /**
   * Story 050 (D5 acceptance criterion): a hand-added third slot (only reachable by editing the
   * `.cfg` directly - `applySlot`/`applyPlainSlot` never write index 2+ themselves) survives
   * editing or clearing either editable slot, because `applySlot` writes through `withKeySlot`
   * rather than `clearKeySlot` and so never shifts a later slot's array position.
   */
  it('leaves a hand-added third slot untouched when editing or clearing slot 1', () => {
    let actions = applySlot([], row, 'primary', 'w')
    actions = applySlot(actions, row, 'secondary', 'UPARROW')
    let created = findAction(actions, row)!
    // Simulate a hand-edited `.cfg` that added a third bind for this alias.
    actions = actions.map((action) =>
      action.id === created.id ? { ...action, keys: [...(action.keys ?? []), { key: 'g' }] } : action,
    )

    actions = applySlot(actions, row, 'secondary', 'f')
    created = findAction(actions, row)!
    expect(keySlotAt(created, 1)?.key).toBe('f')
    expect(keySlotAt(created, 2)?.key).toBe('g')

    actions = applySlot(actions, row, 'secondary', undefined)
    created = findAction(actions, row)!
    expect(keySlotAt(created, 1)?.key).toBe('')
    expect(keySlotAt(created, 2)?.key).toBe('g')
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

  it('turning ammo off alone (no key, no message) still materialises and keeps the action - story 015 decision 3', () => {
    let actions = applyAmmo([], row, false)
    const created = findAction(actions, row)
    expect(created).toBeDefined()
    expect(deriveRowState(created, row).withAmmo).toBe(false)

    // Turning it back on (the row's default) with nothing else set prunes it away again.
    actions = applyAmmo(actions, row, true)
    expect(findAction(actions, row)).toBeUndefined()
  })
})

describe('applyMessage', () => {
  const row = buildDropGroups().weapon.find((r) => r.catalogId === 'dropWeapon:rlauncher')!

  it('creates a message-only action (no key) on a fresh row', () => {
    const actions = applyMessage([], row, 'HELP')
    const created = findAction(actions, row)!

    expect(keySlotAt(created, 0)).toBeUndefined()
    expect(keySlotAt(created, 1)).toBeUndefined()
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

  it('writes a `say` channel message when passed', () => {
    const actions = applyMessage([], row, 'HELP', 'say')
    const created = findAction(actions, row)!

    const messageCommand = created.commands.find((command) => command.kind === 'message')
    expect(messageCommand).toMatchObject({ kind: 'message', channel: 'say', text: 'HELP' })
    expect(deriveRowState(created, row)).toMatchObject({ message: 'HELP', messageChannel: 'say' })
  })

  it('defaults to `say_team` when no channel is passed', () => {
    const actions = applyMessage([], row, 'HELP')
    const created = findAction(actions, row)!

    const messageCommand = created.commands.find((command) => command.kind === 'message')
    expect(messageCommand).toMatchObject({ kind: 'message', channel: 'say_team', text: 'HELP' })
  })

  it('does not prune an action whose only content is a `say` message', () => {
    const actions = applyMessage([], row, 'HELP', 'say')

    expect(findAction(actions, row)).toBeDefined()
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

/** A custom category's own `bind` entry - no `catalogId`, unlike everything `applySlot` touches. */
function plainAction(overrides: Partial<ConfigAction> = {}): ConfigAction {
  return {
    id: 'plain-1',
    categoryId: 'custom-1',
    name: 'My action',
    kind: 'bind',
    commands: [],
    ...overrides,
  }
}

describe('applyPlainSlot', () => {
  it('sets a slot by actionId', () => {
    const actions = applyPlainSlot([plainAction()], 'plain-1', 'primary', 'f')

    expect(keySlotAt(actions[0]!, 0)?.key).toBe('f')
    expect(keySlotAt(actions[0]!, 1)).toBeUndefined()
  })

  it('stores the modifier alongside the key it was captured with', () => {
    const actions = applyPlainSlot([plainAction()], 'plain-1', 'secondary', 'r', 'ALT')

    expect(keySlotAt(actions[0]!, 1)?.key).toBe('r')
    expect(keySlotAt(actions[0]!, 1)?.modifier).toBe('ALT')
  })

  it('clears a slot (and its modifier) without pruning the action, unlike applySlot', () => {
    const withKey = applyPlainSlot([plainAction()], 'plain-1', 'primary', 'r', 'ALT')
    const cleared = applyPlainSlot(withKey, 'plain-1', 'primary', undefined)

    // Both slots are now empty, but a plain action survives - it was created by hand and the
    // user can re-bind it (unlike a catalogue-materialised row, which `applySlot` would prune).
    expect(cleared).toHaveLength(1)
    expect(keySlotAt(cleared[0]!, 0)?.key).toBe('')
    expect(keySlotAt(cleared[0]!, 0)?.modifier).toBeUndefined()
  })

  it('leaves the other slot untouched', () => {
    let actions = applyPlainSlot([plainAction()], 'plain-1', 'primary', 'r', 'ALT')
    actions = applyPlainSlot(actions, 'plain-1', 'secondary', 'f', 'CTRL')
    actions = applyPlainSlot(actions, 'plain-1', 'primary', 'w')

    expect(keySlotAt(actions[0]!, 0)).toEqual({ key: 'w' })
    expect(keySlotAt(actions[0]!, 1)).toEqual({ key: 'f', modifier: 'CTRL' })
  })

  it('never mutates the array or action it was given', () => {
    const original = [plainAction()]
    const result = applyPlainSlot(original, 'plain-1', 'primary', 'f')

    expect(keySlotAt(original[0]!, 0)).toBeUndefined()
    expect(result).not.toBe(original)
    expect(result[0]).not.toBe(original[0])
  })

  it('returns the array unchanged when actionId does not exist', () => {
    const original = [plainAction()]
    const result = applyPlainSlot(original, 'missing', 'primary', 'f')

    expect(result).toEqual(original)
    expect(result).not.toBe(original)
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
