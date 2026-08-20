import { describe, expect, it } from 'vitest'
import type { AltLayer } from '@shared/config/alt-layers'
import type { BindCollision } from '@shared/config/bind-collision'
import { MODIFIER_LAYER_NAME } from '@shared/config/modifier-layers'
import type { ConfigAction, ConfigProfile } from '@shared/modules/config'
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
import { buildDropGroups, buildMovementRows, type CatalogRow } from './catalog-binds'

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
    const stale = catalogAction(forward, { kind: 'alias', key: 'f' })
    expect(findSlotCollision(profile({ actions: [stale] }), 'f')).toBeNull()
  })

  it("names another action by that action's name", () => {
    const owner = catalogAction(forward, { key: 'f' })
    const found = findSlotCollision(profile({ actions: [owner] }), 'f')

    expect(found?.collision.kind).toBe('action')
    expect(found?.owner).toBe('+forward')
  })

  it(
    "still names the owning action, not its bind mirror, once setActions has persisted it " +
      '(review finding: profile.binds always carries this mirror in real use)',
    () => {
      const owner = catalogAction(forward, { key: 'f' })
      const found = findSlotCollision(
        profile({ actions: [owner], binds: { f: 'q2l_a_forward_0000' } }),
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
    const owner = catalogAction(forward, { key: 'r', keyModifier: 'ALT' })

    const found = findModifierSlotCollision([owner], [], 'ALT', 'r')

    expect(found).toEqual({
      modifier: 'ALT',
      key: 'r',
      layerId: '',
      layerName: 'Alt',
      owner: owner.name,
      actionId: owner.id,
      actionSlot: 'primary',
    })
  })

  it('review fix, Finding 4: ignores an alias-kind action even if it still carries a stale modifier slot', () => {
    const stale = catalogAction(forward, { kind: 'alias', key: 'r', keyModifier: 'ALT' })
    expect(findModifierSlotCollision([stale], [], 'ALT', 'r')).toBeNull()
  })

  it("names the occupying action by its name when its keyModifier/key slot matches", () => {
    const owner = catalogAction(forward, { key: 'r', keyModifier: 'ALT' })
    const layers = [altLayer({ id: 'alt-9', name: 'Alt' })]

    const found = findModifierSlotCollision([owner], layers, 'ALT', 'r')

    expect(found).toEqual({
      modifier: 'ALT',
      key: 'r',
      layerId: 'alt-9',
      layerName: 'Alt',
      owner: owner.name,
      actionId: owner.id,
      actionSlot: 'primary',
    })
  })

  it('names the occupying action via its secondaryKeyModifier/secondaryKey slot', () => {
    const owner = catalogAction(jump, { secondaryKey: 'r', secondaryKeyModifier: 'ALT' })
    const layers = [altLayer({ id: 'alt-9', name: 'Alt' })]

    const found = findModifierSlotCollision([owner], layers, 'ALT', 'r')

    expect(found).toEqual({
      modifier: 'ALT',
      key: 'r',
      layerId: 'alt-9',
      layerName: 'Alt',
      owner: owner.name,
      actionId: owner.id,
      actionSlot: 'secondary',
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
    // The mirror always writes an ACTION_ALIAS_PREFIX value for a modifier-carrying slot - the
    // action-array check above already reports it, so this must not also fall through to the
    // hand-made-override branch.
    const owner = catalogAction(forward, { key: 'r', keyModifier: 'ALT' })
    const layers = [altLayer({ overrides: { r: 'q2l_a_forward_0000' } })]

    const found = findModifierSlotCollision([owner], layers, 'ALT', 'r')

    expect(found?.actionId).toBe(owner.id)
  })

  it("does not report re-capturing the same row's own current (modifier, key)", () => {
    const owner = catalogAction(forward, { key: 'r', keyModifier: 'ALT' })
    const layers = [altLayer({ overrides: { r: 'q2l_a_forward_0000' } })]

    expect(findModifierSlotCollision([owner], layers, 'ALT', 'r', owner.id)).toBeNull()
  })

  it('returns null for an empty override slot', () => {
    const layers = [altLayer({ overrides: {} })]
    expect(findModifierSlotCollision([], layers, 'ALT', 'r')).toBeNull()
  })

  it('does not collide across modifiers: a CTRL-bound action is irrelevant to an ALT check', () => {
    const owner = catalogAction(forward, { key: 'r', keyModifier: 'CTRL' })
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
    expect(next[0]!.key).toBe('r')
    expect(next[0]!.keyModifier).toBe('ALT')
  })

  it("clears the previous occupant's slot and assigns the new one in a single array", () => {
    const occupant = catalogAction(forward, { key: 'r', keyModifier: 'ALT' })
    const collision: ModifierSlotCollision = {
      modifier: 'ALT',
      key: 'r',
      layerId: 'alt-1',
      layerName: 'Alt',
      owner: occupant.name,
      actionId: occupant.id,
      actionSlot: 'primary',
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
    expect(newOwner?.key).toBe('r')
    expect(newOwner?.keyModifier).toBe('ALT')
  })

  it("clears only the matching slot, keeping the previous occupant's other assignment", () => {
    const occupant = catalogAction(forward, { key: 'r', keyModifier: 'ALT', secondaryKey: 'UPARROW' })
    const collision: ModifierSlotCollision = {
      modifier: 'ALT',
      key: 'r',
      layerId: 'alt-1',
      layerName: 'Alt',
      owner: occupant.name,
      actionId: occupant.id,
      actionSlot: 'primary',
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
    expect(releasedOccupant?.key).toBeUndefined()
    expect(releasedOccupant?.keyModifier).toBeUndefined()
    expect(releasedOccupant?.secondaryKey).toBe('UPARROW')
  })

  it('releases a secondary-slot occupant the same way', () => {
    const occupant = catalogAction(forward, { secondaryKey: 'r', secondaryKeyModifier: 'ALT', key: 'f' })
    const collision: ModifierSlotCollision = {
      modifier: 'ALT',
      key: 'r',
      layerId: 'alt-1',
      layerName: 'Alt',
      owner: occupant.name,
      actionId: occupant.id,
      actionSlot: 'secondary',
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
    expect(releasedOccupant?.secondaryKey).toBeUndefined()
    expect(releasedOccupant?.secondaryKeyModifier).toBeUndefined()
    expect(releasedOccupant?.key).toBe('f')
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
    expect(next[0]!.key).toBe('r')
    expect(next[0]!.keyModifier).toBe('ALT')
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
    expect(next[0]!.key).toBe('f')
    // The stale hand-written bind is not in `actions` at all - `setActions` drops it because the
    // action's own key now claims `f`, which is why this path needs no second, binds-only save.
    expect(binds).toEqual({ f: 'weapnext' })
  })

  it("clears the previous action's slot and assigns the new one in a single array", () => {
    const owner = catalogAction(forward, { key: 'f', secondaryKey: 'UPARROW' })
    const actions = [owner]
    const collision: BindCollision = {
      kind: 'action',
      key: 'f',
      actionId: owner.id,
      name: owner.name,
      slot: 'primary',
    }

    const next = applyReplace({
      actions,
      binds: { f: 'q2l_a_1' },
      collision,
      row: jump,
      slot: 'primary',
      key: 'f',
    })

    const releasedOwner = next.find((action) => action.catalogId === forward.catalogId)
    const newOwner = next.find((action) => action.catalogId === jump.catalogId)
    expect(releasedOwner?.key).toBeUndefined()
    expect(releasedOwner?.secondaryKey).toBe('UPARROW')
    expect(newOwner?.key).toBe('f')
    // Purity: the caller's array and its elements are untouched, so a failed save leaves the
    // draft exactly as it was.
    expect(actions).toEqual([owner])
    expect(owner.key).toBe('f')
  })

  it('prunes a catalogue owner that has nothing left after losing the key (decision 4)', () => {
    const owner = catalogAction(forward, { key: 'f' })
    const collision: BindCollision = {
      kind: 'action',
      key: 'f',
      actionId: owner.id,
      name: owner.name,
      slot: 'primary',
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
      key: 'f',
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
      slot: 'primary',
    }

    const next = applyReplace({
      actions: [owner],
      binds: { f: 'q2l_a_1' },
      collision,
      row: forward,
      slot: 'primary',
      key: 'f',
    })

    const releasedOwner = next.find((action) => action.id === owner.id)
    expect(releasedOwner?.key).toBeUndefined()
    expect(releasedOwner?.commands).toHaveLength(2)
  })

  it('never prunes a legacy free-form action, it only loses the key', () => {
    const legacy: ConfigAction = {
      id: 'legacy-1',
      categoryId: 'movement',
      name: 'My own action',
      kind: 'bind',
      commands: [{ kind: 'raw', text: 'echo hi' }],
      key: 'f',
    }
    const collision: BindCollision = {
      kind: 'action',
      key: 'f',
      actionId: legacy.id,
      name: legacy.name,
      slot: 'primary',
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
    expect(survivor?.key).toBeUndefined()
  })

  it('moves a key between two slots of the very same row without dropping the action', () => {
    const owner = catalogAction(forward, { secondaryKey: 'g' })
    const collision: BindCollision = {
      kind: 'action',
      key: 'g',
      actionId: owner.id,
      name: owner.name,
      slot: 'secondary',
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
    expect(next[0]!.key).toBe('g')
    expect(next[0]!.secondaryKey).toBeUndefined()
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

    expect(next[0]!.key).toBe('f')
  })

  it("releases the previous owner and applies the new key in one pass", () => {
    const owner = catalogAction(forward, { key: 'f', secondaryKey: 'UPARROW' })
    const collision: BindCollision = {
      kind: 'action',
      key: 'f',
      actionId: owner.id,
      name: owner.name,
      slot: 'primary',
    }

    const next = applyPlainReplace({
      actions: [owner, plainAction()],
      binds: { f: 'q2l_a_1' },
      collision,
      actionId: 'plain-1',
      slot: 'primary',
      key: 'f',
    })

    const releasedOwner = next.find((action) => action.id === owner.id)
    const newOwner = next.find((action) => action.id === 'plain-1')
    expect(releasedOwner?.key).toBeUndefined()
    expect(releasedOwner?.secondaryKey).toBe('UPARROW')
    expect(newOwner?.key).toBe('f')
  })

  it('never prunes the plain action, unlike a catalogue owner that loses its last key', () => {
    const owner = catalogAction(forward, { key: 'f' })
    const collision: BindCollision = {
      kind: 'action',
      key: 'f',
      actionId: owner.id,
      name: owner.name,
      slot: 'primary',
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

    expect(next[0]!.key).toBe('r')
    expect(next[0]!.keyModifier).toBe('ALT')
  })

  it("releases the previous occupant's slot and assigns the new one in a single array", () => {
    const occupant = catalogAction(forward, { key: 'r', keyModifier: 'ALT' })
    const collision: ModifierSlotCollision = {
      modifier: 'ALT',
      key: 'r',
      layerId: 'alt-1',
      layerName: 'Alt',
      owner: occupant.name,
      actionId: occupant.id,
      actionSlot: 'primary',
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
    const newOwner = next.find((action) => action.id === 'plain-1')
    expect(releasedOccupant).toBeUndefined()
    expect(newOwner?.key).toBe('r')
    expect(newOwner?.keyModifier).toBe('ALT')
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
