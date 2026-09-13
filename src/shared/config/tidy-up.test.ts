import { describe, expect, it } from 'vitest'
import type { AltLayer } from './alt-layers'
import type { ActionKeySlot, ConfigAction, ConfigProfile } from '../modules/config'
import { aliasNameFor } from './alias-render'
import { applyTidyUpOps, type TidyUpOp } from './tidy-up'

/**
 * Story 025 D3's acceptance: each of the five op kinds applies on a matching
 * profile, a stale op comes back in `rejected` having mutated nothing, a
 * re-classify writes `unrecognized` *and* its target field in one result, and a
 * whole batch produces one profile - with `updatedAt` untouched, since bumping
 * it exactly once per batch is the main handler's job (covered in
 * `main/modules/config/index.test.ts`), not this pure function's.
 */

const FIXED_UPDATED_AT = '2026-01-01T00:00:00.000Z'

function profile(overrides: Partial<ConfigProfile> = {}): ConfigProfile {
  return {
    id: 'p1',
    name: 'Profile',
    createdAt: FIXED_UPDATED_AT,
    updatedAt: FIXED_UPDATED_AT,
    cvars: {},
    binds: {},
    assignments: [],
    ...overrides,
  }
}

function action(overrides: Partial<ConfigAction> = {}): ConfigAction {
  return {
    id: 'a1',
    categoryId: 'movement',
    name: 'Action',
    kind: 'bind',
    commands: [{ kind: 'raw', text: 'weapnext' }],
    ...overrides,
  }
}

function layer(overrides: Partial<AltLayer> = {}): AltLayer {
  return { id: 'l1', name: 'Drops', mode: 'hold', triggerKey: 'ALT', overrides: {}, ...overrides }
}

/** An action whose `keys` array is exactly the given slots, in order. */
function withKeys(base: ConfigAction, ...keys: ActionKeySlot[]): ConfigAction {
  return { ...base, keys }
}

describe('applyTidyUpOps - removeShadowedBind', () => {
  /**
   * The real duplicate-bind shape an import produces: two differently spelled
   * entries for one key (`normalizeBindKey` folds both onto `MOUSE1`). The
   * analyzer decided the later one wins; this removes the shadowed one only -
   * the key must stay bound, which is the whole reason this op names a specific
   * claim rather than a key.
   */
  it('removes only the named base-bind claim and leaves the winner bound', () => {
    const before = profile({ binds: { MOUSE1: '+attack', mouse1: 'weapnext', w: '+forward' } })
    const op: TidyUpOp = {
      kind: 'removeShadowedBind',
      scope: 'base',
      key: 'MOUSE1',
      claim: { source: 'baseBind', command: '+attack' },
    }

    const result = applyTidyUpOps(before, [op])

    expect(result.applied).toEqual([op])
    expect(result.rejected).toEqual([])
    expect(result.profile.binds).toEqual({ mouse1: 'weapnext', w: '+forward' })
    // The input is never mutated.
    expect(before.binds).toEqual({ MOUSE1: '+attack', mouse1: 'weapnext', w: '+forward' })
  })

  it('clears the named action slot and drops that slot own binds mirror, keeping the other claimant', () => {
    const shadowed = withKeys(action({ id: 'a1', name: 'Shadowed' }), { key: 'w' })
    const winner = withKeys(action({ id: 'a2', name: 'Winner' }), { key: 'w' })
    const before = profile({
      actions: [shadowed, winner],
      // `setActions`' later-wins mirror: the winner owns the key, and the
      // shadowed row's own stale mirror sits on a second spelling of it.
      binds: { w: aliasNameFor(winner), W: aliasNameFor(shadowed) },
    })
    const op: TidyUpOp = {
      kind: 'removeShadowedBind',
      scope: 'base',
      key: 'w',
      claim: { source: 'action', actionId: 'a1', slot: 0 },
    }

    const result = applyTidyUpOps(before, [op])

    expect(result.applied).toEqual([op])
    // Cleared *in place* (story-050 review finding 2): the slot stays at its index carrying an
    // empty key rather than being spliced out, so no later slot is renumbered. Every reader skips
    // an empty key, so the row is unbound all the same.
    expect(result.profile.actions![0]!.keys).toEqual([{ key: '' }])
    expect(result.profile.actions![1]!.keys).toEqual([{ key: 'w' }])
    expect(result.profile.binds).toEqual({ w: aliasNameFor(winner) })
  })

  it('story 050: clears a claim on a third key slot (index 2), keeping the first two intact', () => {
    const shadowed = withKeys(
      action({ id: 'a1', name: 'Shadowed' }),
      { key: 'q' },
      { key: 'e' },
      { key: 'w' },
    )
    const winner = withKeys(action({ id: 'a2', name: 'Winner' }), { key: 'w' })
    const before = profile({
      actions: [shadowed, winner],
      binds: { w: aliasNameFor(winner), W: aliasNameFor(shadowed) },
    })
    const op: TidyUpOp = {
      kind: 'removeShadowedBind',
      scope: 'base',
      key: 'w',
      claim: { source: 'action', actionId: 'a1', slot: 2 },
    }

    const result = applyTidyUpOps(before, [op])

    expect(result.applied).toEqual([op])
    expect(result.profile.actions![0]!.keys).toEqual([{ key: 'q' }, { key: 'e' }, { key: '' }])
    expect(result.profile.actions![1]!.keys).toEqual([{ key: 'w' }])
    expect(result.profile.binds).toEqual({ w: aliasNameFor(winner) })
  })

  it('clears a modifier-carrying slot and its layer override, never a base bind', () => {
    const shadowed = withKeys(action({ id: 'a1', name: 'Shadowed' }), { key: 'r', modifier: 'ALT' })
    const winner = withKeys(action({ id: 'a2', name: 'Winner' }), { key: 'r', modifier: 'ALT' })
    const before = profile({
      actions: [shadowed, winner],
      binds: { r: 'weapnext' },
      layers: [
        layer({ overrides: { r: aliasNameFor(winner), R: aliasNameFor(shadowed) } }),
      ],
    })
    const op: TidyUpOp = {
      kind: 'removeShadowedBind',
      scope: { layerId: 'l1' },
      key: 'r',
      claim: { source: 'action', actionId: 'a1', slot: 0 },
    }

    const result = applyTidyUpOps(before, [op])

    expect(result.applied).toEqual([op])
    // In place again, and the whole slot goes: the `ALT` modifier is not left stranded on an
    // empty key.
    expect(result.profile.actions![0]!.keys).toEqual([{ key: '' }])
    expect(result.profile.layers![0]!.overrides).toEqual({ r: aliasNameFor(winner) })
    // A plain `bind r` is a different, legitimate claim (decision 14) and the
    // modifier slot never mirrored into `binds` in the first place.
    expect(result.profile.binds).toEqual({ r: 'weapnext' })
  })

  it('rejects a layer-override claim on a key nothing else claims in that layer', () => {
    const before = profile({
      layers: [layer({ overrides: { '1': 'drop rl', F1: 'drop rg' } })],
    })
    const op: TidyUpOp = {
      kind: 'removeShadowedBind',
      scope: { layerId: 'l1' },
      key: '1',
      claim: { source: 'layerOverride', command: 'drop rl' },
    }

    const result = applyTidyUpOps(before, [op])

    expect(result.rejected).toEqual([op])
    expect(result.profile).toBe(before)
  })

  it('removes a hand-made layer override that an action slot also claims', () => {
    const claimant = withKeys(action({ id: 'a1', name: 'Alt drop' }), { key: '1', modifier: 'ALT' })
    const before = profile({
      actions: [claimant],
      layers: [layer({ overrides: { '1': 'drop rl' } })],
    })
    const op: TidyUpOp = {
      kind: 'removeShadowedBind',
      scope: { layerId: 'l1' },
      key: '1',
      claim: { source: 'layerOverride', command: 'drop rl' },
    }

    const result = applyTidyUpOps(before, [op])

    expect(result.applied).toEqual([op])
    expect(result.profile.layers![0]!.overrides).toEqual({})
    expect(result.profile.actions).toEqual([claimant])
  })

  it('rejects a claim whose key is no longer contested, mutating nothing', () => {
    const before = profile({ binds: { MOUSE1: '+attack' } })
    const op: TidyUpOp = {
      kind: 'removeShadowedBind',
      scope: 'base',
      key: 'MOUSE1',
      claim: { source: 'baseBind', command: '+attack' },
    }

    const result = applyTidyUpOps(before, [op])

    expect(result.applied).toEqual([])
    expect(result.rejected).toEqual([op])
    expect(result.profile).toBe(before)
  })

  it('rejects a base-bind claim whose command changed since the scan', () => {
    const before = profile({ binds: { MOUSE1: 'weapprev', mouse1: 'weapnext' } })
    const op: TidyUpOp = {
      kind: 'removeShadowedBind',
      scope: 'base',
      key: 'MOUSE1',
      claim: { source: 'baseBind', command: '+attack' },
    }

    const result = applyTidyUpOps(before, [op])

    expect(result.rejected).toEqual([op])
    expect(result.profile).toBe(before)
  })

  /** The slot moved to `Alt+w` after the scan: same key, different scope. */
  it('rejects an action claim whose slot changed scope since the scan', () => {
    const moved = withKeys(action({ id: 'a1' }), { key: 'w', modifier: 'ALT' })
    const other = withKeys(action({ id: 'a2', name: 'Other' }), { key: 'w' })
    const before = profile({ actions: [moved, other], binds: { w: aliasNameFor(other) } })
    const op: TidyUpOp = {
      kind: 'removeShadowedBind',
      scope: 'base',
      key: 'w',
      claim: { source: 'action', actionId: 'a1', slot: 0 },
    }

    const result = applyTidyUpOps(before, [op])

    expect(result.rejected).toEqual([op])
    expect(result.profile).toBe(before)
  })

  /**
   * Sequential-against-an-accumulating-draft, the decision this module
   * documents: three claimants, two removals. The second op is checked against
   * the profile the first one produced, so it still sees a contested key - and a
   * third removal would have to be rejected, because by then nothing shadows
   * anything.
   */
  it('applies two removals on one key in order and rejects a third that would unbind it', () => {
    const before = profile({ binds: { MOUSE1: '+attack', mouse1: 'weapnext', Mouse1: 'weapprev' } })
    const ops: TidyUpOp[] = [
      { kind: 'removeShadowedBind', scope: 'base', key: 'MOUSE1', claim: { source: 'baseBind', command: '+attack' } },
      { kind: 'removeShadowedBind', scope: 'base', key: 'MOUSE1', claim: { source: 'baseBind', command: 'weapprev' } },
      { kind: 'removeShadowedBind', scope: 'base', key: 'MOUSE1', claim: { source: 'baseBind', command: 'weapnext' } },
    ]

    const result = applyTidyUpOps(before, ops)

    expect(result.applied).toEqual([ops[0], ops[1]])
    expect(result.rejected).toEqual([ops[2]])
    expect(result.profile.binds).toEqual({ mouse1: 'weapnext' })
  })
})

describe('applyTidyUpOps - removeEmptyLayer', () => {
  it('removes a layer whose every override is blank', () => {
    const before = profile({
      layers: [layer({ id: 'l1', overrides: { '1': '', '2': '   ' } }), layer({ id: 'l2' })],
    })
    const op: TidyUpOp = { kind: 'removeEmptyLayer', layerId: 'l1' }

    const result = applyTidyUpOps(before, [op])

    expect(result.applied).toEqual([op])
    expect(result.profile.layers!.map((l) => l.id)).toEqual(['l2'])
    expect(before.layers).toHaveLength(2)
  })

  it('rejects a layer that has real content again, and one that is already gone', () => {
    const filled = profile({ layers: [layer({ id: 'l1', overrides: { '1': 'drop rl' } })] })
    const gone = profile({ layers: [] })
    const op: TidyUpOp = { kind: 'removeEmptyLayer', layerId: 'l1' }

    expect(applyTidyUpOps(filled, [op])).toMatchObject({ applied: [], rejected: [op] })
    expect(applyTidyUpOps(filled, [op]).profile).toBe(filled)
    expect(applyTidyUpOps(gone, [op]).profile).toBe(gone)
  })
})

describe('applyTidyUpOps - removeUnreferencedAlias', () => {
  const alias = action({ id: 'x1', name: '+test', kind: 'alias', commands: [{ kind: 'raw', text: 'echo hi' }] })

  it('removes an alias action nothing calls', () => {
    const keeper = withKeys(action({ id: 'a1', name: 'Keeper' }), { key: 'w' })
    const before = profile({ actions: [alias, keeper] })
    const op: TidyUpOp = { kind: 'removeUnreferencedAlias', actionId: 'x1' }

    const result = applyTidyUpOps(before, [op])

    expect(result.applied).toEqual([op])
    expect(result.profile.actions!.map((a) => a.id)).toEqual(['a1'])
  })

  it('rejects an alias something references again, mutating nothing', () => {
    const caller = action({ id: 'a1', name: 'Caller', commands: [{ kind: 'raw', text: '+test' }] })
    const before = profile({ actions: [alias, caller] })
    const op: TidyUpOp = { kind: 'removeUnreferencedAlias', actionId: 'x1' }

    const result = applyTidyUpOps(before, [op])

    expect(result.rejected).toEqual([op])
    expect(result.profile).toBe(before)
  })

  it('rejects an id that is not an alias entry', () => {
    const before = profile({ actions: [action({ id: 'a1' })] })
    const op: TidyUpOp = { kind: 'removeUnreferencedAlias', actionId: 'a1' }

    expect(applyTidyUpOps(before, [op]).rejected).toEqual([op])
  })
})

describe('applyTidyUpOps - dropPreservedLine', () => {
  const lines = [
    { file: 'config.cfg', line: 12, text: 'alias foo "bar"' },
    { file: 'autoexec.cfg', line: 12, text: 'alias foo "bar"' },
  ]

  it('drops exactly the line identified by file, line and text', () => {
    const before = profile({ unrecognized: [...lines] })
    const op: TidyUpOp = { kind: 'dropPreservedLine', ...lines[0]! }

    const result = applyTidyUpOps(before, [op])

    expect(result.applied).toEqual([op])
    expect(result.profile.unrecognized).toEqual([lines[1]])
    expect(before.unrecognized).toHaveLength(2)
  })

  it('rejects a line whose number shifted since the scan', () => {
    const before = profile({ unrecognized: [{ ...lines[0]!, line: 14 }] })
    const op: TidyUpOp = { kind: 'dropPreservedLine', ...lines[0]! }

    const result = applyTidyUpOps(before, [op])

    expect(result.rejected).toEqual([op])
    expect(result.profile).toBe(before)
  })
})

describe('applyTidyUpOps - reclassifyPreservedLine', () => {
  const line = { file: 'config.cfg', line: 12, text: 'set sensitivity 5' }

  it('writes cvars and removes the line in the same result', () => {
    const before = profile({ cvars: { cl_run: '1' }, unrecognized: [line] })
    const op: TidyUpOp = {
      kind: 'reclassifyPreservedLine',
      ...line,
      target: { field: 'cvars', name: 'sensitivity', value: '5' },
    }

    const result = applyTidyUpOps(before, [op])

    expect(result.applied).toEqual([op])
    expect(result.profile.cvars).toEqual({ cl_run: '1', sensitivity: '5' })
    expect(result.profile.unrecognized).toEqual([])
  })

  it('writes binds (normalized) and removes the line in the same result', () => {
    const before = profile({ unrecognized: [line] })
    const op: TidyUpOp = {
      kind: 'reclassifyPreservedLine',
      ...line,
      target: { field: 'binds', key: 'F9', command: 'weapnext' },
    }

    const result = applyTidyUpOps(before, [op])

    expect(result.applied).toEqual([op])
    expect(result.profile.binds).toEqual({ F9: 'weapnext' })
    expect(result.profile.unrecognized).toEqual([])
  })

  it('appends the action, mirrors its key into binds, and removes the line in the same result', () => {
    const promoted = withKeys(action({ id: 'n1', name: 'Zoom' }), { key: 'z' })
    // Story 052 D4: `movement` is an ordinary category now, so the profile has to carry it for the
    // promotion to have somewhere visible to go - `categoryExists` no longer assumes the three
    // former built-ins are always there.
    const before = profile({
      actions: [],
      categories: [{ id: 'movement', name: 'Movement' }],
      unrecognized: [line],
    })
    const op: TidyUpOp = {
      kind: 'reclassifyPreservedLine',
      ...line,
      target: { field: 'actions', action: promoted },
    }

    const result = applyTidyUpOps(before, [op])

    expect(result.applied).toEqual([op])
    expect(result.profile.actions).toEqual([promoted])
    expect(result.profile.binds).toEqual({ z: aliasNameFor(promoted) })
    expect(result.profile.unrecognized).toEqual([])
  })

  it('rejects a cvar target whose cvar now holds a different value, and accepts an identical one', () => {
    const op: TidyUpOp = {
      kind: 'reclassifyPreservedLine',
      ...line,
      target: { field: 'cvars', name: 'sensitivity', value: '5' },
    }
    const changed = profile({ cvars: { sensitivity: '3' }, unrecognized: [line] })
    const identical = profile({ cvars: { sensitivity: '5' }, unrecognized: [line] })

    expect(applyTidyUpOps(changed, [op]).rejected).toEqual([op])
    expect(applyTidyUpOps(changed, [op]).profile).toBe(changed)
    // Idempotent: the value is already right, so only the line is dropped.
    const again = applyTidyUpOps(identical, [op])
    expect(again.applied).toEqual([op])
    expect(again.profile.unrecognized).toEqual([])
  })

  it('rejects a bind target whose key an action already claims', () => {
    const owner = withKeys(action({ id: 'a1' }), { key: 'F9' })
    const before = profile({ actions: [owner], binds: { F9: aliasNameFor(owner) }, unrecognized: [line] })
    const op: TidyUpOp = {
      kind: 'reclassifyPreservedLine',
      ...line,
      target: { field: 'binds', key: 'F9', command: 'weapnext' },
    }

    expect(applyTidyUpOps(before, [op]).rejected).toEqual([op])
    expect(applyTidyUpOps(before, [op]).profile).toBe(before)
  })

  it('rejects an action target filed under a former built-in the profile no longer carries', () => {
    // Story 052 D4 ("a deleted former built-in leaves its entries un-flagged" otherwise): `movement`
    // used to be valid by fiat. A profile whose user deleted it has nowhere to show the row, so the
    // promotion is refused exactly like one naming a category that never existed.
    const before = profile({ actions: [], categories: [], unrecognized: [line] })
    const op: TidyUpOp = {
      kind: 'reclassifyPreservedLine',
      ...line,
      target: { field: 'actions', action: action({ id: 'n1', categoryId: 'movement' }) },
    }

    const result = applyTidyUpOps(before, [op])

    expect(result.rejected).toEqual([op])
    expect(result.profile).toBe(before)
  })

  it('rejects an action target with an unknown category, a duplicate id or a modifier slot', () => {
    const before = profile({
      actions: [action({ id: 'a1' })],
      categories: [{ id: 'movement', name: 'Movement' }],
      unrecognized: [line],
    })
    const target = (candidate: ConfigAction): TidyUpOp => ({
      kind: 'reclassifyPreservedLine',
      ...line,
      target: { field: 'actions', action: candidate },
    })

    const unknownCategory = target(action({ id: 'n1', categoryId: 'nope' }))
    const duplicateId = target(action({ id: 'a1' }))
    const withModifier = target(withKeys(action({ id: 'n2' }), { key: 'r', modifier: 'ALT' }))

    for (const op of [unknownCategory, duplicateId, withModifier]) {
      const result = applyTidyUpOps(before, [op])
      expect(result.rejected).toEqual([op])
      expect(result.profile).toBe(before)
    }
  })

  it('rejects a line that is no longer preserved and writes nothing to the target field', () => {
    const before = profile({ cvars: {}, unrecognized: [] })
    const op: TidyUpOp = {
      kind: 'reclassifyPreservedLine',
      ...line,
      target: { field: 'cvars', name: 'sensitivity', value: '5' },
    }

    const result = applyTidyUpOps(before, [op])

    expect(result.rejected).toEqual([op])
    expect(result.profile.cvars).toEqual({})
    expect(result.profile).toBe(before)
  })
})

describe('applyTidyUpOps - batches', () => {
  it('produces every mutation in one returned profile and never touches updatedAt', () => {
    const alias = action({ id: 'x1', name: '+test', kind: 'alias' })
    const preserved = { file: 'config.cfg', line: 3, text: 'alias +test "echo hi"' }
    const before = profile({
      actions: [alias],
      layers: [layer({ id: 'l1', overrides: { '1': '  ' } })],
      binds: { MOUSE1: '+attack', mouse1: 'weapnext' },
      unrecognized: [preserved],
    })
    const ops: TidyUpOp[] = [
      { kind: 'removeShadowedBind', scope: 'base', key: 'MOUSE1', claim: { source: 'baseBind', command: '+attack' } },
      { kind: 'removeEmptyLayer', layerId: 'l1' },
      { kind: 'removeUnreferencedAlias', actionId: 'x1' },
      {
        kind: 'reclassifyPreservedLine',
        ...preserved,
        target: { field: 'cvars', name: 'sensitivity', value: '5' },
      },
    ]

    const result = applyTidyUpOps(before, ops)

    expect(result.applied).toEqual(ops)
    expect(result.rejected).toEqual([])
    expect(result.profile.binds).toEqual({ mouse1: 'weapnext' })
    expect(result.profile.layers).toEqual([])
    expect(result.profile.actions).toEqual([])
    expect(result.profile.cvars).toEqual({ sensitivity: '5' })
    expect(result.profile.unrecognized).toEqual([])
    // The pure applier never bumps the timestamp - the handler does, once.
    expect(result.profile.updatedAt).toBe(FIXED_UPDATED_AT)
  })

  it('keeps applying the good ops around a stale one', () => {
    const before = profile({
      cvars: {},
      unrecognized: [{ file: 'config.cfg', line: 1, text: 'one' }],
      layers: [],
    })
    const good: TidyUpOp = { kind: 'dropPreservedLine', file: 'config.cfg', line: 1, text: 'one' }
    const stale: TidyUpOp = { kind: 'removeEmptyLayer', layerId: 'gone' }

    const result = applyTidyUpOps(before, [stale, good, stale])

    expect(result.applied).toEqual([good])
    expect(result.rejected).toEqual([stale, stale])
    expect(result.profile.unrecognized).toEqual([])
  })

  it('returns the input profile by reference when nothing applies', () => {
    const before = profile()
    const result = applyTidyUpOps(before, [{ kind: 'removeEmptyLayer', layerId: 'gone' }])
    expect(result.profile).toBe(before)
    expect(result.applied).toEqual([])
  })
})
