import { describe, expect, it } from 'vitest'
import type { AltLayer } from '@shared/config/alt-layers'
import type { BindCollision } from '@shared/config/bind-collision'
import type { ConfigAction, ConfigProfile } from '@shared/modules/config'
import { applyReplace, findModifierSlotCollision, findSlotCollision } from './bind-slot-collision'
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
    expect(findModifierSlotCollision([], 'ALT', 'r', 'drop rocket launcher')).toBeNull()
  })

  it('returns null when the override key is free', () => {
    const layers = [altLayer({ overrides: {} })]
    expect(findModifierSlotCollision(layers, 'ALT', 'r', 'drop rocket launcher')).toBeNull()
  })

  it('returns null when the override already holds this exact command (re-capturing the same combo)', () => {
    const layers = [altLayer({ overrides: { r: 'drop rocket launcher' } })]
    expect(findModifierSlotCollision(layers, 'ALT', 'r', 'drop rocket launcher')).toBeNull()
  })

  it('reports the layer and the occupying command when a different command is already there', () => {
    const layers = [altLayer({ id: 'alt-9', name: 'Alt', overrides: { r: 'drop grenade launcher' } })]
    const found = findModifierSlotCollision(layers, 'ALT', 'r', 'drop rocket launcher')

    expect(found).toEqual({
      modifier: 'ALT',
      key: 'r',
      layerId: 'alt-9',
      layerName: 'Alt',
      owner: 'drop grenade launcher',
    })
  })

  it('does not collide across modifiers: a CTRL override at the same key is irrelevant to an ALT check', () => {
    const layers = [altLayer({ triggerKey: 'CTRL', name: 'Ctrl', overrides: { r: 'wave 1' } })]
    expect(findModifierSlotCollision(layers, 'ALT', 'r', 'drop rocket launcher')).toBeNull()
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
