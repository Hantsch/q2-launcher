import { describe, expect, it } from 'vitest'
import { bindValueFor } from '@shared/config/action-mirror'
import type { AltLayer } from '@shared/config/alt-layers'
import type { ModifierTrigger } from '@shared/config/modifier-layers'
import type { ActionKeySlot, ConfigAction, ConfigProfile } from '@shared/modules/config'
import { findBindConflicts, findSlotConflictOwner, indexBindConflicts } from './bind-conflicts'
import { buildMovementRows, type CatalogRow } from './catalog-binds'

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

/** Story 050: a single-slot `keys` array, for the tests below that only ever need one key. */
function oneKey(key: string, modifier?: ModifierTrigger): ActionKeySlot[] {
  return modifier ? [{ key, modifier }] : [{ key }]
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

describe('findBindConflicts', () => {
  it('returns [] for a profile with no conflicts', () => {
    expect(findBindConflicts(profile())).toEqual([])
  })

  it('does not conflict two base binds and their own actions on different keys', () => {
    const forwardAction = catalogAction(forward, { keys: oneKey('f') })
    const jumpAction = catalogAction(jump, { keys: oneKey('space') })
    const result = findBindConflicts(
      profile({
        actions: [forwardAction, jumpAction],
        binds: { f: bindValueFor(forwardAction), space: bindValueFor(jumpAction) },
      }),
    )
    expect(result).toEqual([])
  })

  it('reports two actions bound to the same key once, naming both owners', () => {
    const forwardAction = catalogAction(forward, { keys: oneKey('f') })
    const jumpAction = catalogAction(jump, { keys: oneKey('f') })
    const result = findBindConflicts(profile({ actions: [forwardAction, jumpAction] }))

    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ key: 'f', scope: 'base', owners: [forwardAction.name, jumpAction.name] })
  })

  it("does not double-count an action's own key against its profile.binds mirror", () => {
    const forwardAction = catalogAction(forward, { keys: oneKey('f') })
    const result = findBindConflicts(
      profile({ actions: [forwardAction], binds: { f: bindValueFor(forwardAction) } }),
    )
    expect(result).toEqual([])
  })

  it('reports a genuine base-bind-vs-action conflict on the same key', () => {
    const forwardAction = catalogAction(forward, { keys: oneKey('f') })
    const result = findBindConflicts(
      profile({ actions: [forwardAction], binds: { f: 'weapnext' } }),
    )

    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ key: 'f', scope: 'base', owners: [forwardAction.name, 'weapnext'] })
  })

  it('is case/spelling insensitive via normalizeBindKey', () => {
    const forwardAction = catalogAction(forward, { keys: oneKey('F9') })
    const result = findBindConflicts(
      profile({ actions: [forwardAction], binds: { f9: 'weapnext' } }),
    )
    expect(result).toHaveLength(1)
    expect(result[0]!.key).toBe('F9')
  })

  it('ignores an alias-kind action even if it still carries stale key data', () => {
    const stale = catalogAction(forward, { kind: 'alias', keys: oneKey('f') })
    const other = catalogAction(jump, { keys: oneKey('f') })
    expect(findBindConflicts(profile({ actions: [stale, other] }))).toEqual([])
  })

  it('never counts a modifier-carrying slot as a base-layer claim', () => {
    const altAction = catalogAction(forward, { keys: oneKey('r', 'ALT') })
    const plainAction = catalogAction(jump, { keys: oneKey('r') })
    // `r` is claimed on the base layer only by `plainAction` - `altAction`'s slot is invisible to
    // the base layer (it lives inside the ALT layer instead).
    const result = findBindConflicts(profile({ actions: [altAction, plainAction] }))
    expect(result).toEqual([])
  })

  it('reports two actions both claiming the same (modifier, key) inside that layer', () => {
    const first = catalogAction(forward, { keys: oneKey('r', 'ALT') })
    const second = catalogAction(jump, { keys: oneKey('r', 'ALT') })
    const layer = altLayer({ id: 'alt-9', overrides: { r: bindValueFor(second) } })
    const result = findBindConflicts(profile({ actions: [first, second], layers: [layer] }))

    expect(result).toEqual([{ key: 'r', scope: { layerId: 'alt-9' }, owners: [first.name, second.name] }])
  })

  it('reports an action vs. a hand-made override in the same layer', () => {
    const action = catalogAction(forward, { keys: oneKey('r', 'ALT') })
    const layer = altLayer({ id: 'alt-9', overrides: { r: 'drop grenade launcher' } })
    const result = findBindConflicts(profile({ actions: [action], layers: [layer] }))

    expect(result).toEqual([
      { key: 'r', scope: { layerId: 'alt-9' }, owners: [action.name, 'drop grenade launcher'] },
    ])
  })

  it("does not conflict an action's modifier slot with its own mirrored override", () => {
    const action = catalogAction(forward, { keys: oneKey('r', 'ALT') })
    const layer = altLayer({ id: 'alt-9', overrides: { r: bindValueFor(action) } })
    expect(findBindConflicts(profile({ actions: [action], layers: [layer] }))).toEqual([])
  })

  it('keeps a base conflict and a same-layer modifier conflict on the same physical key separate', () => {
    const baseOwnerA = catalogAction(forward, { keys: oneKey('r') })
    const baseOwnerB = catalogAction(jump, { keys: oneKey('r') })
    const modifierOwnerA = catalogAction(forward, { id: 'mod-a', name: 'Mod A', keys: oneKey('r', 'ALT') })
    const modifierOwnerB = catalogAction(jump, { id: 'mod-b', name: 'Mod B', keys: oneKey('r', 'ALT') })
    const layer = altLayer({ id: 'alt-9', overrides: { r: bindValueFor(modifierOwnerB) } })

    const result = findBindConflicts(
      profile({ actions: [baseOwnerA, baseOwnerB, modifierOwnerA, modifierOwnerB], layers: [layer] }),
    )

    expect(result).toHaveLength(2)
    expect(result).toContainEqual({ key: 'r', scope: 'base', owners: [baseOwnerA.name, baseOwnerB.name] })
    expect(result).toContainEqual({
      key: 'r',
      scope: { layerId: 'alt-9' },
      owners: ['Mod A', 'Mod B'],
    })
  })

  it('does not cross a modifier-layer claim into a different layer', () => {
    const altAction = catalogAction(forward, { keys: oneKey('r', 'ALT') })
    const ctrlAction = catalogAction(jump, { keys: oneKey('r', 'CTRL') })
    const layers: AltLayer[] = [
      altLayer({ id: 'alt-1', triggerKey: 'ALT', overrides: { r: bindValueFor(altAction) } }),
      altLayer({ id: 'ctrl-1', name: 'Ctrl', triggerKey: 'CTRL', overrides: { r: bindValueFor(ctrlAction) } }),
    ]
    expect(findBindConflicts(profile({ actions: [altAction, ctrlAction], layers }))).toEqual([])
  })
})

describe('findSlotConflictOwner', () => {
  it('names the other base-layer owner, excluding the caller itself', () => {
    const forwardAction = catalogAction(forward, { keys: oneKey('f') })
    const jumpAction = catalogAction(jump, { keys: oneKey('f') })
    const index = indexBindConflicts(findBindConflicts(profile({ actions: [forwardAction, jumpAction] })))

    expect(findSlotConflictOwner(index, [], 'f', undefined, forwardAction.name)).toBe(jumpAction.name)
    expect(findSlotConflictOwner(index, [], 'f', undefined, jumpAction.name)).toBe(forwardAction.name)
  })

  it('returns undefined for an unbound or unconflicted slot', () => {
    const index = indexBindConflicts([])
    expect(findSlotConflictOwner(index, [], undefined, undefined, 'anyone')).toBeUndefined()
    expect(findSlotConflictOwner(index, [], 'f', undefined, 'anyone')).toBeUndefined()
  })

  it('resolves a modifier slot through the layer matching its trigger', () => {
    const first = catalogAction(forward, { keys: oneKey('r', 'ALT') })
    const second = catalogAction(jump, { keys: oneKey('r', 'ALT') })
    const layer = altLayer({ id: 'alt-9' })
    const index = indexBindConflicts(findBindConflicts(profile({ actions: [first, second], layers: [layer] })))

    expect(findSlotConflictOwner(index, [layer], 'r', 'ALT', first.name)).toBe(second.name)
  })
})
