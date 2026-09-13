import { describe, expect, it } from 'vitest'
import { keySlotAt, keySlotCount } from '@shared/config/action-slots'
import { bindValueFor } from '@shared/config/action-mirror'
import type { AltLayer } from '@shared/config/alt-layers'
import type { BindCollision } from '@shared/config/bind-collision'
import { MODIFIER_LAYER_NAME } from '@shared/config/modifier-layers'
import type { ConfigAction, ConfigProfile } from '@shared/modules/config'
import { findBindConflicts } from './bind-conflicts'
import {
  applyModifierReplace,
  applyReplace,
  findModifierSlotCollision,
  findSlotCollision,
  layerNameForModifier,
  type ModifierSlotCollision,
} from './bind-slot-collision'
import { applySlot, buildDropGroups, buildMovementRows, type CatalogRow } from './catalog-binds'

const rows = buildMovementRows()
const forward = rows.find((row) => row.catalogId === 'movement:forward')!
const jump = rows.find((row) => row.catalogId === 'movement:moveup')!

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

function catalogAction(row: CatalogRow, overrides: Partial<ConfigAction> = {}): ConfigAction {
  return {
    id: `action-${row.catalogId}`,
    categoryId: row.categoryId,
    name: row.commands[0]!,
    kind: 'bind',
    catalogId: row.catalogId,
    commands: row.commands.map((text) => ({ kind: 'raw', text })),
    ...overrides,
  }
}

describe('findSlotCollision', () => {
  it('returns null when nothing owns the key', () => {
    expect(findSlotCollision(profile(), 'f')).toBeNull()
  })

  it('names a hand-written base bind by its command', () => {
    const found = findSlotCollision(profile({ binds: { f: 'weapnext' } }), 'f')

    expect(found?.collision.kind).toBe('baseBind')
    expect(found?.owner).toBe('weapnext')
  })

  it('review fix, Finding 4: ignores an alias-kind action even if it still carries stale key data', () => {
    const stale = catalogAction(forward, { kind: 'alias', keys: [{ key: 'f' }] })
    expect(findSlotCollision(profile({ actions: [stale] }), 'f')).toBeNull()
  })

  it("names another action by that action's name", () => {
    const owner = catalogAction(forward, { keys: [{ key: 'f' }] })
    const found = findSlotCollision(profile({ actions: [owner] }), 'f')

    expect(found?.collision.kind).toBe('action')
    expect(found?.owner).toBe('+forward')
  })

  it(
    "still names the owning action, not its bind mirror, once setActions has persisted it " +
      '(review finding: profile.binds always carries this mirror in real use)',
    () => {
      const owner = catalogAction(forward, { keys: [{ key: 'f' }] })
      const found = findSlotCollision(
        profile({ actions: [owner], binds: { f: bindValueFor(owner) } }),
        'f',
      )

      expect(found?.collision.kind).toBe('action')
      expect(found?.owner).toBe('+forward')
    },
  )

  it('names an alt layer by its name, not its id', () => {
    const found = findSlotCollision(
      profile({
        layers: [
          {
            id: 'layer-1',
            name: 'Weapon layer',
            mode: 'hold',
            triggerKey: 'ALT',
            overrides: { f: 'weapnext' },
          },
        ],
      }),
      'f',
    )

    expect(found?.collision.kind).toBe('layerOverride')
    expect(found?.owner).toBe('Weapon layer')
  })
})

function altLayer(overrides: Partial<AltLayer> = {}): AltLayer {
  return {
    id: 'alt-1',
    name: 'Alt',
    mode: 'hold',
    triggerKey: 'ALT',
    overrides: {},
    ...overrides,
  }
}

describe('findModifierSlotCollision', () => {
  it('returns null when the layer for the modifier does not exist yet', () => {
    expect(findModifierSlotCollision([], [], 'ALT', 'r')).toBeNull()
  })

  it('returns null when nothing occupies the key', () => {
    const layers = [altLayer()]
    expect(findModifierSlotCollision([], layers, 'ALT', 'r')).toBeNull()
  })

  it('review fix: still reports an occupying action even before its modifier layer exists', () => {
    // `actions` is authoritative for occupancy since D7's mirror - one save ahead of `layers`
    // catching up (the layer is only created by the next setActions/setLayers mirror pass). Two
    // rows independently capturing the same combo in that narrow window must still collide.
    const owner = catalogAction(forward, { keys: [{ key: 'r', modifier: 'ALT' }] })

    const found = findModifierSlotCollision([owner], [], 'ALT', 'r')

    expect(found).toEqual({
      modifier: 'ALT',
      key: 'r',
      layerId: '',
      layerName: 'Alt',
      owner: owner.name,
      actionId: owner.id,
      actionSlot: 0,
    })
  })

  it('review fix, Finding 4: ignores an alias-kind action even if it still carries a stale modifier slot', () => {
    const stale = catalogAction(forward, { kind: 'alias', keys: [{ key: 'r', modifier: 'ALT' }] })
    expect(findModifierSlotCollision([stale], [], 'ALT', 'r')).toBeNull()
  })

  it("names the occupying action by its name when slot 0's key/modifier matches", () => {
    const owner = catalogAction(forward, { keys: [{ key: 'r', modifier: 'ALT' }] })
    const layers = [altLayer({ id: 'alt-9', name: 'Alt' })]

    const found = findModifierSlotCollision([owner], layers, 'ALT', 'r')

    expect(found).toEqual({
      modifier: 'ALT',
      key: 'r',
      layerId: 'alt-9',
      layerName: 'Alt',
      owner: owner.name,
      actionId: owner.id,
      actionSlot: 0,
    })
  })

  it('names the occupying action via its slot 1 (secondary) key/modifier', () => {
    const owner = catalogAction(jump, { keys: [{ key: '' }, { key: 'r', modifier: 'ALT' }] })
    const layers = [altLayer({ id: 'alt-9', name: 'Alt' })]

    const found = findModifierSlotCollision([owner], layers, 'ALT', 'r')

    expect(found).toEqual({
      modifier: 'ALT',
      key: 'r',
      layerId: 'alt-9',
      layerName: 'Alt',
      owner: owner.name,
      actionId: owner.id,
      actionSlot: 1,
    })
  })

  /**
   * Story 050 (D5 acceptance criterion): a hand-added third slot (only reachable by editing the
   * `.cfg` directly) is found and named exactly like slot 0/1 would be, even though nothing in the
   * Controls tab UI can ever create one itself.
   */
  it('names the occupying action via a hand-added slot 2', () => {
    const owner = catalogAction(forward, {
      keys: [{ key: 'f' }, { key: 'g' }, { key: 'r', modifier: 'ALT' }],
    })
    const layers = [altLayer({ id: 'alt-9', name: 'Alt' })]

    const found = findModifierSlotCollision([owner], layers, 'ALT', 'r')

    expect(found).toEqual({
      modifier: 'ALT',
      key: 'r',
      layerId: 'alt-9',
      layerName: 'Alt',
      owner: owner.name,
      actionId: owner.id,
      actionSlot: 2,
    })
  })

  it('reports a hand-made override (not written by the actions mirror) by its raw command text', () => {
    const layers = [altLayer({ id: 'alt-9', name: 'Alt', overrides: { r: 'drop grenade launcher' } })]

    const found = findModifierSlotCollision([], layers, 'ALT', 'r')

    expect(found).toEqual({
      modifier: 'ALT',
      key: 'r',
      layerId: 'alt-9',
      layerName: 'Alt',
      owner: 'drop grenade launcher',
    })
  })

  it('does not report a mirrored override belonging to another (non-ignored) action a second time', () => {
    // The mirror writes `bindValueFor(action)` for a modifier-carrying slot (story 034: an alias
    // token for most rows, the row's own `+command` for a continuous catalogue row) - the
    // action-array check above already reports it, so this must not also fall through to the
    // hand-made-override branch.
    const owner = catalogAction(forward, { keys: [{ key: 'r', modifier: 'ALT' }] })
    const layers = [altLayer({ overrides: { r: bindValueFor(owner) } })]

    const found = findModifierSlotCollision([owner], layers, 'ALT', 'r')

    expect(found?.actionId).toBe(owner.id)
  })

  it("does not report re-capturing the same row's own current (modifier, key)", () => {
    const owner = catalogAction(forward, { keys: [{ key: 'r', modifier: 'ALT' }] })
    const layers = [altLayer({ overrides: { r: bindValueFor(owner) } })]

    expect(findModifierSlotCollision([owner], layers, 'ALT', 'r', owner.id)).toBeNull()
  })

  it('returns null for an empty override slot', () => {
    const layers = [altLayer({ overrides: {} })]
    expect(findModifierSlotCollision([], layers, 'ALT', 'r')).toBeNull()
  })

  it('does not collide across modifiers: a CTRL-bound action is irrelevant to an ALT check', () => {
    const owner = catalogAction(forward, { keys: [{ key: 'r', modifier: 'CTRL' }] })
    const layers = [altLayer()]
    expect(findModifierSlotCollision([owner], layers, 'ALT', 'r')).toBeNull()
  })
})

/** A custom category's own `bind` entry - no `catalogId`. Story 052 D8: the Replace paths treat it
 * exactly like a catalogue-backed one, which is why the two used to need two sets of functions and
 * now share one. */
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

describe('applyModifierReplace', () => {
  it('is a plain applySlot passthrough when there is nothing to release', () => {
    const next = applyModifierReplace({
      actions: [catalogAction(forward)],
      collision: null,
      actionId: `action-${forward.catalogId}`,
      slotIndex: 0,
      key: 'r',
      modifier: 'ALT',
    })

    expect(next).toHaveLength(1)
    expect(keySlotAt(next[0]!, 0)?.key).toBe('r')
    expect(keySlotAt(next[0]!, 0)?.modifier).toBe('ALT')
  })

  it('is the same passthrough for a free-form entry', () => {
    const next = applyModifierReplace({
      actions: [plainAction()],
      collision: null,
      actionId: 'plain-1',
      slotIndex: 0,
      key: 'r',
      modifier: 'ALT',
    })

    expect(keySlotAt(next[0]!, 0)).toEqual({ key: 'r', modifier: 'ALT' })
  })

  it("clears the previous occupant's slot and assigns the new one in a single array", () => {
    const occupant = catalogAction(forward, { keys: [{ key: 'r', modifier: 'ALT' }] })
    const target = catalogAction(jump)
    const collision: ModifierSlotCollision = {
      modifier: 'ALT',
      key: 'r',
      layerId: 'alt-1',
      layerName: 'Alt',
      owner: occupant.name,
      actionId: occupant.id,
      actionSlot: 0,
    }

    const next = applyModifierReplace({
      actions: [occupant, target],
      collision,
      actionId: target.id,
      slotIndex: 0,
      key: 'r',
      modifier: 'ALT',
    })

    const releasedOccupant = next.find((action) => action.catalogId === forward.catalogId)!
    const newOwner = next.find((action) => action.catalogId === jump.catalogId)!
    // Story 052 D8: the occupant had nothing else assigned and is *kept*, unbound - it used to be
    // pruned (decision 4), which now would delete its row from the Controls tab.
    expect(releasedOccupant).toBeDefined()
    expect(keySlotAt(releasedOccupant, 0)?.key).toBe('')
    expect(keySlotAt(newOwner, 0)?.key).toBe('r')
    expect(keySlotAt(newOwner, 0)?.modifier).toBe('ALT')
  })

  it("clears only the matching slot, keeping the previous occupant's other assignment", () => {
    const occupant = catalogAction(forward, {
      keys: [{ key: 'r', modifier: 'ALT' }, { key: 'UPARROW' }],
    })
    const target = catalogAction(jump)
    const collision: ModifierSlotCollision = {
      modifier: 'ALT',
      key: 'r',
      layerId: 'alt-1',
      layerName: 'Alt',
      owner: occupant.name,
      actionId: occupant.id,
      actionSlot: 0,
    }

    const next = applyModifierReplace({
      actions: [occupant, target],
      collision,
      actionId: target.id,
      slotIndex: 0,
      key: 'r',
      modifier: 'ALT',
    })

    const releasedOccupant = next.find((action) => action.catalogId === forward.catalogId)!
    expect(keySlotAt(releasedOccupant, 0)?.key).toBe('')
    expect(keySlotAt(releasedOccupant, 0)?.modifier).toBeUndefined()
    expect(keySlotAt(releasedOccupant, 1)?.key).toBe('UPARROW')
  })

  it('releases a secondary-slot occupant the same way', () => {
    const occupant = catalogAction(forward, {
      keys: [{ key: 'f' }, { key: 'r', modifier: 'ALT' }],
    })
    const target = catalogAction(jump)
    const collision: ModifierSlotCollision = {
      modifier: 'ALT',
      key: 'r',
      layerId: 'alt-1',
      layerName: 'Alt',
      owner: occupant.name,
      actionId: occupant.id,
      actionSlot: 1,
    }

    const next = applyModifierReplace({
      actions: [occupant, target],
      collision,
      actionId: target.id,
      slotIndex: 0,
      key: 'r',
      modifier: 'ALT',
    })

    const releasedOccupant = next.find((action) => action.catalogId === forward.catalogId)!
    expect(keySlotAt(releasedOccupant, 1)?.key).toBe('')
    expect(keySlotAt(releasedOccupant, 1)?.modifier).toBeUndefined()
    expect(keySlotAt(releasedOccupant, 0)?.key).toBe('f')
  })

  it('does nothing to release when the collision is a hand-made override (no actionId)', () => {
    const collision: ModifierSlotCollision = {
      modifier: 'ALT',
      key: 'r',
      layerId: 'alt-1',
      layerName: 'Alt',
      owner: 'drop grenade launcher',
    }

    const next = applyModifierReplace({
      actions: [catalogAction(forward)],
      collision,
      actionId: `action-${forward.catalogId}`,
      slotIndex: 0,
      key: 'r',
      modifier: 'ALT',
    })

    expect(next).toHaveLength(1)
    expect(keySlotAt(next[0]!, 0)?.key).toBe('r')
    expect(keySlotAt(next[0]!, 0)?.modifier).toBe('ALT')
  })
})

describe('applyReplace', () => {
  it('applies the new key without touching actions for a base-bind collision', () => {
    const binds = { f: 'weapnext' }
    const collision: BindCollision = { kind: 'baseBind', key: 'f', command: 'weapnext' }
    const target = catalogAction(forward)

    const next = applyReplace({
      actions: [target],
      binds,
      collision,
      actionId: target.id,
      slotIndex: 0,
      key: 'f',
    })

    expect(next).toHaveLength(1)
    expect(next[0]!.catalogId).toBe(forward.catalogId)
    expect(keySlotAt(next[0]!, 0)?.key).toBe('f')
    // The stale hand-written bind is not in `actions` at all - `setActions` drops it because the
    // action's own key now claims `f`, which is why this path needs no second, binds-only save.
    expect(binds).toEqual({ f: 'weapnext' })
  })

  it('applies it the same way for a free-form entry', () => {
    const collision: BindCollision = { kind: 'baseBind', key: 'f', command: 'weapnext' }

    const next = applyReplace({
      actions: [plainAction()],
      binds: { f: 'weapnext' },
      collision,
      actionId: 'plain-1',
      slotIndex: 0,
      key: 'f',
    })

    expect(keySlotAt(next[0]!, 0)?.key).toBe('f')
  })

  it("clears the previous action's slot and assigns the new one in a single array", () => {
    const owner = catalogAction(forward, { keys: [{ key: 'f' }, { key: 'UPARROW' }] })
    const target = catalogAction(jump)
    const actions = [owner, target]
    const collision: BindCollision = {
      kind: 'action',
      key: 'f',
      actionId: owner.id,
      name: owner.name,
      slot: 0,
    }

    const next = applyReplace({
      actions,
      binds: { f: 'q2l_a_1' },
      collision,
      actionId: target.id,
      slotIndex: 0,
      key: 'f',
    })

    const releasedOwner = next.find((action) => action.catalogId === forward.catalogId)!
    const newOwner = next.find((action) => action.catalogId === jump.catalogId)!
    // Release goes through the shared `releaseKey`, which blanks the named slot *at its own index*
    // (story-050 review, finding 5: `withKeySlot(…, { key: '' })`, never `clearKeySlot`) - it names
    // a raw `keys` index, so removing there could shift a slot out from under the scan that found
    // it. Story 056 leaves that as it is: `deriveRowState` filters the blank out, so the released
    // row shows one key fewer straight away, and the row's own next write drops the slot.
    expect(keySlotAt(releasedOwner, 0)?.key).toBe('')
    expect(keySlotAt(releasedOwner, 1)?.key).toBe('UPARROW')
    expect(keySlotAt(newOwner, 0)?.key).toBe('f')
    // Purity: the caller's array and its elements are untouched, so a failed save leaves the
    // draft exactly as it was.
    expect(actions).toEqual([owner, target])
    expect(keySlotAt(owner, 0)?.key).toBe('f')
  })

  /**
   * Story 052 D8: a released owner is kept whatever it is left holding - catalogue-backed or
   * free-form, with or without a message. Pruning a catalogue owner that lost its last key
   * (decision 4) was the mirror image of the lazy creation this story removes, and it would now
   * make the owner's row vanish from the Controls tab the moment another row took its key (AC 3).
   */
  it('keeps a catalogue owner that has nothing left after losing the key', () => {
    const owner = catalogAction(forward, { keys: [{ key: 'f' }] })
    const target = catalogAction(jump)
    const collision: BindCollision = {
      kind: 'action',
      key: 'f',
      actionId: owner.id,
      name: owner.name,
      slot: 0,
    }

    const next = applyReplace({
      actions: [owner, target],
      binds: { f: 'q2l_a_1' },
      collision,
      actionId: target.id,
      slotIndex: 0,
      key: 'f',
    })

    expect(next.map((action) => action.catalogId)).toEqual([forward.catalogId, jump.catalogId])
    const releasedOwner = next.find((action) => action.id === owner.id)!
    expect(keySlotAt(releasedOwner, 0)?.key).toBe('')
    // Its commands are untouched, so re-binding the row is one capture away.
    expect(releasedOwner.commands).toEqual(owner.commands)
  })

  it('keeps a catalogue owner that still has a team message', () => {
    const dropRow = buildDropGroups().weapon[0]!
    const owner = catalogAction(dropRow, {
      keys: [{ key: 'f' }],
      commands: [
        { kind: 'raw', text: dropRow.commands[0]! },
        { kind: 'message', channel: 'say_team', text: 'dropped' },
      ],
    })
    const target = catalogAction(forward)
    const collision: BindCollision = {
      kind: 'action',
      key: 'f',
      actionId: owner.id,
      name: owner.name,
      slot: 0,
    }

    const next = applyReplace({
      actions: [owner, target],
      binds: { f: 'q2l_a_1' },
      collision,
      actionId: target.id,
      slotIndex: 0,
      key: 'f',
    })

    const releasedOwner = next.find((action) => action.id === owner.id)!
    // The released slot stays at its index holding an empty key (see the note above); an empty
    // key is "nothing assigned" everywhere it is read, and the message is untouched either way.
    expect(keySlotAt(releasedOwner, 0)?.key).toBe('')
    expect(releasedOwner.commands).toHaveLength(2)
  })

  it('never prunes a free-form action, it only loses the key', () => {
    const legacy: ConfigAction = {
      id: 'legacy-1',
      categoryId: 'movement',
      name: 'My own action',
      kind: 'bind',
      commands: [{ kind: 'raw', text: 'echo hi' }],
      keys: [{ key: 'f' }],
    }
    const target = catalogAction(forward)
    const collision: BindCollision = {
      kind: 'action',
      key: 'f',
      actionId: legacy.id,
      name: legacy.name,
      slot: 0,
    }

    const next = applyReplace({
      actions: [legacy, target],
      binds: { f: 'q2l_a_1' },
      collision,
      actionId: target.id,
      slotIndex: 0,
      key: 'f',
    })

    const survivor = next.find((action) => action.id === legacy.id)
    expect(survivor).toBeDefined()
    expect(keySlotAt(survivor!, 0)?.key).toBe('')
  })

  it('moves a key between two slots of the very same row without dropping the action', () => {
    // The row carries a legacy empty slot 0 and its only key at slot 1 - the shape story 050's
    // in-place clear produced, and the one the user sees as a single key in the Key column.
    const owner = catalogAction(forward, { keys: [{ key: '' }, { key: 'g' }] })
    const collision: BindCollision = {
      kind: 'action',
      key: 'g',
      actionId: owner.id,
      name: owner.name,
      slot: 1,
    }

    const next = applyReplace({
      actions: [owner],
      binds: { g: 'q2l_a_1' },
      collision,
      actionId: owner.id,
      slotIndex: 0,
      key: 'g',
    })

    expect(next).toHaveLength(1)
    // `releaseKey` blanks slot 1 in place; the write that follows compacts the row it is writing
    // (story 056), so both empty slots go and the key ends up in the one slot the row still has.
    expect(keySlotAt(next[0]!, 0)?.key).toBe('g')
    expect(keySlotCount(next[0]!)).toBe(1)
  })

  /**
   * Story 050's D5 criterion, restated for story 056: a third key survives editing slot 1 and
   * survives clearing it - it is promoted to slot 1 now instead of staying at index 2 (a clear
   * removes the slot, AC 5), and either way it is still the same key and still participates in
   * conflict detection (`findBindConflicts`, `./bind-conflicts`) like any other. Exercised through
   * `applySlot` directly - the path an ordinary Controls-tab edit of a slot takes, as opposed to a
   * Replace-over-a-collision flow (`applyReplace`), which releases the *previous* claimant through
   * the shared `releaseKey` and is not what this criterion is about.
   */
  it('keeps a hand-added third key, and its conflict, through editing then clearing slot 1', () => {
    const owner: ConfigAction = {
      id: 'three-1',
      categoryId: 'movement',
      name: 'My action',
      kind: 'bind',
      commands: [],
      keys: [{ key: 'f' }, { key: 'g' }, { key: 'h' }],
    }
    const other: ConfigAction = {
      id: 'other-1',
      categoryId: 'movement',
      name: 'Other action',
      kind: 'bind',
      commands: [],
      keys: [{ key: 'h' }],
    }

    const edited = applySlot([owner, other], 'three-1', 1, 'x')
    const editedOwner = edited.find((action) => action.id === 'three-1')!
    expect(keySlotAt(editedOwner, 1)?.key).toBe('x')
    expect(keySlotAt(editedOwner, 2)?.key).toBe('h')

    const cleared = applySlot(edited, 'three-1', 1, undefined)
    const clearedOwner = cleared.find((action) => action.id === 'three-1')!
    expect(keySlotAt(clearedOwner, 0)?.key).toBe('f')
    // The hand-added third key ('h') survived both edits - promoted into slot 1 by the clear.
    expect(keySlotAt(clearedOwner, 1)?.key).toBe('h')
    expect(keySlotCount(clearedOwner)).toBe(2)

    const conflicts = findBindConflicts(profile({ actions: cleared }))
    expect(conflicts).toEqual([{ key: 'h', scope: 'base', owners: [clearedOwner.name, other.name] }])
  })
})


describe('layerNameForModifier', () => {
  it("resolves a real layer's custom name when one exists", () => {
    const layers: AltLayer[] = [
      { id: 'alt-1', name: 'My Combat Layer', mode: 'hold', triggerKey: 'ALT', overrides: {} },
    ]

    expect(layerNameForModifier(layers, 'ALT')).toBe('My Combat Layer')
  })

  it('falls back to the generic modifier layer name when no matching layer exists', () => {
    expect(layerNameForModifier([], 'SHIFT')).toBe(MODIFIER_LAYER_NAME.SHIFT)
  })
})
