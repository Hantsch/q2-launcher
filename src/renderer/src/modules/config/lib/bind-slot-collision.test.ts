import { describe, expect, it } from 'vitest'
import { keySlotAt } from '@shared/config/action-slots'
import { bindValueFor } from '@shared/config/action-mirror'
import type { AltLayer } from '@shared/config/alt-layers'
import type { BindCollision } from '@shared/config/bind-collision'
import { MODIFIER_LAYER_NAME } from '@shared/config/modifier-layers'
import type { ConfigAction, ConfigProfile } from '@shared/modules/config'
import { findBindConflicts } from './bind-conflicts'
import {
  applyModifierReplace,
  applyPlainModifierReplace,
  applyPlainReplace,
  applyReplace,
  findModifierSlotCollision,
  findSlotCollision,
  layerNameForModifier,
  type ModifierSlotCollision,
} from './bind-slot-collision'
import { applyPlainSlot, buildDropGroups, buildMovementRows, type CatalogRow } from './catalog-binds'

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

describe('applyModifierReplace', () => {
  it('is a plain applySlot passthrough when there is nothing to release', () => {
    const next = applyModifierReplace({
      actions: [],
      collision: null,
      row: forward,
      slot: 'primary',
      key: 'r',
      modifier: 'ALT',
    })

    expect(next).toHaveLength(1)
    expect(keySlotAt(next[0]!, 0)?.key).toBe('r')
    expect(keySlotAt(next[0]!, 0)?.modifier).toBe('ALT')
  })

  it("clears the previous occupant's slot and assigns the new one in a single array", () => {
    const occupant = catalogAction(forward, { keys: [{ key: 'r', modifier: 'ALT' }] })
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
      actions: [occupant],
      collision,
      row: jump,
      slot: 'primary',
      key: 'r',
      modifier: 'ALT',
    })

    const releasedOccupant = next.find((action) => action.catalogId === forward.catalogId)
    const newOwner = next.find((action) => action.catalogId === jump.catalogId)
    // The occupant had nothing else assigned, so releasing its only slot prunes it (decision 4).
    expect(releasedOccupant).toBeUndefined()
    expect(keySlotAt(newOwner!, 0)?.key).toBe('r')
    expect(keySlotAt(newOwner!, 0)?.modifier).toBe('ALT')
  })

  it("clears only the matching slot, keeping the previous occupant's other assignment", () => {
    const occupant = catalogAction(forward, {
      keys: [{ key: 'r', modifier: 'ALT' }, { key: 'UPARROW' }],
    })
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
      actions: [occupant],
      collision,
      row: jump,
      slot: 'primary',
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
      actions: [occupant],
      collision,
      row: jump,
      slot: 'primary',
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
      actions: [],
      collision,
      row: forward,
      slot: 'primary',
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

    const next = applyReplace({
      actions: [],
      binds,
      collision,
      row: forward,
      slot: 'primary',
      key: 'f',
    })

    expect(next).toHaveLength(1)
    expect(next[0]!.catalogId).toBe(forward.catalogId)
    expect(keySlotAt(next[0]!, 0)?.key).toBe('f')
    // The stale hand-written bind is not in `actions` at all - `setActions` drops it because the
    // action's own key now claims `f`, which is why this path needs no second, binds-only save.
    expect(binds).toEqual({ f: 'weapnext' })
  })

  it("clears the previous action's slot and assigns the new one in a single array", () => {
    const owner = catalogAction(forward, { keys: [{ key: 'f' }, { key: 'UPARROW' }] })
    const actions = [owner]
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
      row: jump,
      slot: 'primary',
      key: 'f',
    })

    const releasedOwner = next.find((action) => action.catalogId === forward.catalogId)!
    const newOwner = next.find((action) => action.catalogId === jump.catalogId)!
    // Release goes through the shared `releaseKey`, which blanks the named slot *at its own index*
    // (story-050 review, finding 5: `withKeySlot(…, { key: '' })`, never `clearKeySlot`) - exactly
    // what `applySlot`'s direct-edit path does, so no later slot changes column.
    expect(keySlotAt(releasedOwner, 0)?.key).toBe('')
    expect(keySlotAt(releasedOwner, 1)?.key).toBe('UPARROW')
    expect(keySlotAt(newOwner, 0)?.key).toBe('f')
    // Purity: the caller's array and its elements are untouched, so a failed save leaves the
    // draft exactly as it was.
    expect(actions).toEqual([owner])
    expect(keySlotAt(owner, 0)?.key).toBe('f')
  })

  it('prunes a catalogue owner that has nothing left after losing the key (decision 4)', () => {
    const owner = catalogAction(forward, { keys: [{ key: 'f' }] })
    const collision: BindCollision = {
      kind: 'action',
      key: 'f',
      actionId: owner.id,
      name: owner.name,
      slot: 0,
    }

    const next = applyReplace({
      actions: [owner],
      binds: { f: 'q2l_a_1' },
      collision,
      row: jump,
      slot: 'primary',
      key: 'f',
    })

    expect(next.map((action) => action.catalogId)).toEqual([jump.catalogId])
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
    const collision: BindCollision = {
      kind: 'action',
      key: 'f',
      actionId: owner.id,
      name: owner.name,
      slot: 0,
    }

    const next = applyReplace({
      actions: [owner],
      binds: { f: 'q2l_a_1' },
      collision,
      row: forward,
      slot: 'primary',
      key: 'f',
    })

    const releasedOwner = next.find((action) => action.id === owner.id)!
    // The released slot stays at its index holding an empty key (see the note above); an empty
    // key is "nothing assigned" everywhere it is read, which is why the owner is only kept here
    // because of its team message.
    expect(keySlotAt(releasedOwner, 0)?.key).toBe('')
    expect(releasedOwner.commands).toHaveLength(2)
  })

  it('never prunes a legacy free-form action, it only loses the key', () => {
    const legacy: ConfigAction = {
      id: 'legacy-1',
      categoryId: 'movement',
      name: 'My own action',
      kind: 'bind',
      commands: [{ kind: 'raw', text: 'echo hi' }],
      keys: [{ key: 'f' }],
    }
    const collision: BindCollision = {
      kind: 'action',
      key: 'f',
      actionId: legacy.id,
      name: legacy.name,
      slot: 0,
    }

    const next = applyReplace({
      actions: [legacy],
      binds: { f: 'q2l_a_1' },
      collision,
      row: forward,
      slot: 'primary',
      key: 'f',
    })

    const survivor = next.find((action) => action.id === legacy.id)
    expect(survivor).toBeDefined()
    expect(keySlotAt(survivor!, 0)?.key).toBe('')
  })

  it('moves a key between two slots of the very same row without dropping the action', () => {
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
      row: forward,
      slot: 'primary',
      key: 'g',
    })

    expect(next).toHaveLength(1)
    expect(keySlotAt(next[0]!, 0)?.key).toBe('g')
    // Slot 1 is released in place rather than removed, so it stays as an empty slot.
    expect(keySlotAt(next[0]!, 1)?.key).toBe('')
  })

  /**
   * Story 050 (D5 acceptance criterion): editing/clearing slot 1 of an entry that carries a
   * hand-added third key leaves that third key intact, at its own array position, and it still
   * participates in conflict detection (`findBindConflicts`, `./bind-conflicts`) exactly like a
   * slot 0/1 key would. Exercised through `applyPlainSlot` directly (`applySlot`'s and
   * `applyPlainSlot`'s own `withKeySlot`-based write path, per their doc comments) - the path an
   * ordinary Controls-tab edit of slot 1 actually takes, as opposed to a Replace-over-a-collision
   * flow (`applyReplace`), which releases the *previous* claimant through the shared `releaseKey`
   * and is not what this criterion is about.
   */
  it('leaves a hand-added third slot intact, and it still conflicts, after editing then clearing slot 1', () => {
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

    const edited = applyPlainSlot([owner, other], 'three-1', 'secondary', 'x')
    const editedOwner = edited.find((action) => action.id === 'three-1')!
    expect(keySlotAt(editedOwner, 1)?.key).toBe('x')
    expect(keySlotAt(editedOwner, 2)?.key).toBe('h')

    const cleared = applyPlainSlot(edited, 'three-1', 'secondary', undefined)
    const clearedOwner = cleared.find((action) => action.id === 'three-1')!
    expect(keySlotAt(clearedOwner, 0)?.key).toBe('f')
    expect(keySlotAt(clearedOwner, 1)?.key).toBe('')
    // The hand-added third key ('h') survived intact, at its own slot, through both edits.
    expect(keySlotAt(clearedOwner, 2)?.key).toBe('h')

    const conflicts = findBindConflicts(profile({ actions: cleared }))
    expect(conflicts).toEqual([{ key: 'h', scope: 'base', owners: [clearedOwner.name, other.name] }])
  })
})

/** A custom category's own `bind` entry - no `catalogId`, unlike everything `applyReplace` touches. */
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

describe('applyPlainReplace', () => {
  it('applies the new key without touching actions for a base-bind collision', () => {
    const binds = { f: 'weapnext' }
    const collision: BindCollision = { kind: 'baseBind', key: 'f', command: 'weapnext' }

    const next = applyPlainReplace({
      actions: [plainAction()],
      binds,
      collision,
      actionId: 'plain-1',
      slot: 'primary',
      key: 'f',
    })

    expect(keySlotAt(next[0]!, 0)?.key).toBe('f')
  })

  it("releases the previous owner and applies the new key in one pass", () => {
    const owner = catalogAction(forward, { keys: [{ key: 'f' }, { key: 'UPARROW' }] })
    const collision: BindCollision = {
      kind: 'action',
      key: 'f',
      actionId: owner.id,
      name: owner.name,
      slot: 0,
    }

    const next = applyPlainReplace({
      actions: [owner, plainAction()],
      binds: { f: 'q2l_a_1' },
      collision,
      actionId: 'plain-1',
      slot: 'primary',
      key: 'f',
    })

    const releasedOwner = next.find((action) => action.id === owner.id)!
    const newOwner = next.find((action) => action.id === 'plain-1')!
    expect(keySlotAt(releasedOwner, 0)?.key).toBe('')
    expect(keySlotAt(releasedOwner, 1)?.key).toBe('UPARROW')
    expect(keySlotAt(newOwner, 0)?.key).toBe('f')
  })

  it('never prunes the plain action, unlike a catalogue owner that loses its last key', () => {
    const owner = catalogAction(forward, { keys: [{ key: 'f' }] })
    const collision: BindCollision = {
      kind: 'action',
      key: 'f',
      actionId: owner.id,
      name: owner.name,
      slot: 0,
    }

    const next = applyPlainReplace({
      actions: [owner, plainAction()],
      binds: { f: 'q2l_a_1' },
      collision,
      actionId: 'plain-1',
      slot: 'primary',
      key: 'f',
    })

    // The catalogue owner had nothing else assigned, so it is pruned (decision 4); the plain
    // action is never pruned by this path, whatever it ends up holding.
    expect(next.find((action) => action.id === owner.id)).toBeUndefined()
    expect(next.find((action) => action.id === 'plain-1')).toBeDefined()
  })
})

describe('applyPlainModifierReplace', () => {
  it('is a plain applyPlainSlot passthrough when there is nothing to release', () => {
    const next = applyPlainModifierReplace({
      actions: [plainAction()],
      collision: null,
      actionId: 'plain-1',
      slot: 'primary',
      key: 'r',
      modifier: 'ALT',
    })

    expect(keySlotAt(next[0]!, 0)?.key).toBe('r')
    expect(keySlotAt(next[0]!, 0)?.modifier).toBe('ALT')
  })

  it("releases the previous occupant's slot and assigns the new one in a single array", () => {
    const occupant = catalogAction(forward, { keys: [{ key: 'r', modifier: 'ALT' }] })
    const collision: ModifierSlotCollision = {
      modifier: 'ALT',
      key: 'r',
      layerId: 'alt-1',
      layerName: 'Alt',
      owner: occupant.name,
      actionId: occupant.id,
      actionSlot: 0,
    }

    const next = applyPlainModifierReplace({
      actions: [occupant, plainAction()],
      collision,
      actionId: 'plain-1',
      slot: 'primary',
      key: 'r',
      modifier: 'ALT',
    })

    const releasedOccupant = next.find((action) => action.id === occupant.id)
    const newOwner = next.find((action) => action.id === 'plain-1')!
    expect(releasedOccupant).toBeUndefined()
    expect(keySlotAt(newOwner, 0)?.key).toBe('r')
    expect(keySlotAt(newOwner, 0)?.modifier).toBe('ALT')
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
