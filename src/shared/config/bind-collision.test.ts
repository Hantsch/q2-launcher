import { describe, expect, it } from 'vitest'
import type { AltLayer } from '@shared/config/alt-layers'
import { aliasNameFor } from '@shared/config/alias-render'
import type { ActionKeySlot, ConfigAction, ConfigProfile } from '@shared/modules/config'
import { findBindCollision, releaseKey, type BindCollision } from './bind-collision'

function action(overrides: Partial<ConfigAction> = {}): ConfigAction {
  return {
    id: 'action-1',
    categoryId: 'movement',
    name: 'Jump',
    kind: 'bind',
    commands: [{ kind: 'raw', text: '+moveup' }],
    ...overrides,
  }
}

/** An action whose `keys` array is exactly the given slots, in order. */
function withKeys(base: ConfigAction, ...keys: ActionKeySlot[]): ConfigAction {
  return { ...base, keys }
}

function layer(overrides: Partial<AltLayer> = {}): AltLayer {
  return {
    id: 'layer-1',
    name: 'Drops',
    mode: 'hold',
    triggerKey: 'ALT',
    overrides: {},
    ...overrides,
  }
}

function profile(overrides: Partial<ConfigProfile> = {}): ConfigProfile {
  return {
    id: 'profile-1',
    name: 'Default',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    cvars: {},
    binds: {},
    assignments: [],
    ...overrides,
  }
}

describe('findBindCollision', () => {
  it('returns null when nothing owns the key', () => {
    const result = findBindCollision(profile({ binds: { w: '+forward' } }), 'e')
    expect(result).toBeNull()
  })

  it('reports a base bind collision', () => {
    const result = findBindCollision(profile({ binds: { w: '+forward' } }), 'w')
    expect(result).toEqual({ kind: 'baseBind', key: 'w', command: '+forward' })
  })

  it('normalizes the key before comparing against base binds', () => {
    const result = findBindCollision(profile({ binds: { f9: 'quit' } }), 'F9')
    expect(result).toEqual({ kind: 'baseBind', key: 'F9', command: 'quit' })
  })

  it('review fix, Finding 4: ignores an alias-kind action even if it still carries stale key data', () => {
    const stale = withKeys(action({ id: 'a1', kind: 'alias', name: '+test' }), { key: 'q' })
    const result = findBindCollision(profile({ actions: [stale] }), 'q')
    expect(result).toBeNull()
  })

  it('reports an action collision on the first slot', () => {
    const owner = withKeys(action({ id: 'a1', name: 'Drop RL' }), { key: 'q' })
    const result = findBindCollision(profile({ actions: [owner] }), 'q')
    expect(result).toEqual({ kind: 'action', key: 'q', actionId: 'a1', name: 'Drop RL', slot: 0 })
  })

  it('reports an action collision on the second slot', () => {
    const owner = withKeys(action({ id: 'a1', name: 'Drop RL' }), { key: 'w' }, { key: 'MOUSE4' })
    const result = findBindCollision(profile({ actions: [owner] }), 'mouse4')
    expect(result).toEqual({
      kind: 'action',
      key: 'MOUSE4',
      actionId: 'a1',
      name: 'Drop RL',
      slot: 1,
    })
  })

  it('reports an action collision on a third slot (story 050: not capped at two)', () => {
    const owner = withKeys(
      action({ id: 'a1', name: 'Drop RL' }),
      { key: 'w' },
      { key: 'e' },
      { key: 'MOUSE4' },
    )
    const result = findBindCollision(profile({ actions: [owner] }), 'mouse4')
    expect(result).toEqual({
      kind: 'action',
      key: 'MOUSE4',
      actionId: 'a1',
      name: 'Drop RL',
      slot: 2,
    })
  })

  it('reports a layer-override collision when nothing at the base level matches', () => {
    const result = findBindCollision(
      profile({ layers: [layer({ overrides: { '1': 'drop rl' } })] }),
      '1',
    )
    expect(result).toEqual({ kind: 'layerOverride', key: '1', layerId: 'layer-1', command: 'drop rl' })
  })

  it('prefers a base-level collision over a layer-level one for the same key', () => {
    const result = findBindCollision(
      profile({
        binds: { '1': 'weapnext' },
        layers: [layer({ overrides: { '1': 'drop rl' } })],
      }),
      '1',
    )
    expect(result).toEqual({ kind: 'baseBind', key: '1', command: 'weapnext' })
  })

  it('reports an action collision rather than the action’s own bind mirror (review finding)', () => {
    // `setActions` mirrors every action key into `profile.binds`, so once a
    // key has been assigned, that assignment's own bind entry sits right next
    // to genuinely hand-written ones. A second action capturing the same key
    // must still be told "another action has this", not "this is a base
    // bind" (whose `command` would be an opaque alias token, and whose
    // `releaseKey` case does not clear the actual owning action's slot).
    const owner = withKeys(action({ id: 'a1', name: 'Drop RL' }), { key: 'q' })
    const binds = { q: aliasNameFor(owner) }
    const result = findBindCollision(profile({ actions: [owner], binds }), 'q')
    expect(result).toEqual({ kind: 'action', key: 'q', actionId: 'a1', name: 'Drop RL', slot: 0 })
  })

  it('self-ignore: re-capturing a slot to its own current key is not a collision', () => {
    const owner = withKeys(action({ id: 'a1', name: 'Drop RL' }), { key: 'q' })
    const result = findBindCollision(profile({ actions: [owner] }), 'q', {
      actionId: 'a1',
      slot: 0,
    })
    expect(result).toBeNull()
  })

  it('self-ignore: the mirrored base bind for the ignored action’s own key is not a collision either', () => {
    const owner = withKeys(action({ id: 'a1', name: 'Drop RL' }), { key: 'q' })
    const mirroredBinds = { q: aliasNameFor(owner) }
    const result = findBindCollision(
      profile({ actions: [owner], binds: mirroredBinds }),
      'q',
      { actionId: 'a1', slot: 0 },
    )
    expect(result).toBeNull()
  })

  it('self-ignore only excludes the named slot: the other slot on the same action still collides', () => {
    const owner = withKeys(action({ id: 'a1', name: 'Drop RL' }), { key: 'q' }, { key: 'q' })
    const result = findBindCollision(profile({ actions: [owner] }), 'q', {
      actionId: 'a1',
      slot: 0,
    })
    expect(result).toEqual({ kind: 'action', key: 'q', actionId: 'a1', name: 'Drop RL', slot: 1 })
  })

  it('a foreign base bind still collides even when an ignore is given for an unrelated action', () => {
    const owner = withKeys(action({ id: 'a1', name: 'Drop RL' }), { key: 'e' })
    const result = findBindCollision(profile({ binds: { w: '+forward' }, actions: [owner] }), 'w', {
      actionId: 'a1',
      slot: 0,
    })
    expect(result).toEqual({ kind: 'baseBind', key: 'w', command: '+forward' })
  })

  it('story 016 review fix: a modifier-bound slot does not falsely claim the plain base key', () => {
    // An action on Alt+R (`modifier: 'ALT'`) is never mirrored onto the base `binds` map at
    // all (AC 4) - so it must not appear to "own" the plain key `r` either. Before this fix,
    // `slotValue` read the slot's key regardless of its modifier, so a plain-`r` capture on a
    // different action would falsely block on - and, via `releaseKey`, destroy - this one.
    const modifierBound = withKeys(action({ id: 'a1', name: 'Drop RL' }), { key: 'r', modifier: 'ALT' })
    const result = findBindCollision(profile({ actions: [modifierBound] }), 'r')
    expect(result).toBeNull()
  })

  it('story 016 review fix: same, for a modifier-bound second slot', () => {
    const modifierBound = withKeys(
      action({ id: 'a1', name: 'Drop RL' }),
      { key: 'w' },
      { key: 'r', modifier: 'CTRL' },
    )
    const result = findBindCollision(profile({ actions: [modifierBound] }), 'r')
    expect(result).toBeNull()
  })
})

describe('releaseKey', () => {
  it('baseBind: removes the key from binds, leaves actions untouched', () => {
    const actions = [withKeys(action({ id: 'a1' }), { key: 'e' })]
    const binds = { w: '+forward', e: 'q2l_a_jump_0000' }
    const collision = findBindCollision(profile({ binds }), 'w')!

    const result = releaseKey(actions, binds, collision)

    expect(result.binds).toEqual({ e: 'q2l_a_jump_0000' })
    expect(result.actions).toEqual(actions)
    // purity
    expect(binds).toEqual({ w: '+forward', e: 'q2l_a_jump_0000' })
  })

  // These three tests build the `action` collision directly rather than via
  // `findBindCollision`, to exercise `releaseKey`'s stale-mirror cleanup as a
  // unit in its own right, decoupled from which check produced the collision
  // (the "reports an action collision rather than the action's own bind
  // mirror" test above already proves `findBindCollision` itself reaches this
  // case for a real cross-action capture).

  it('action: clears the offending slot and drops its stale bind mirror', () => {
    const owner = withKeys(action({ id: 'a1', name: 'Drop RL' }), { key: 'q' })
    const binds = { q: aliasNameFor(owner) }
    const collision: BindCollision = { kind: 'action', key: 'q', actionId: 'a1', name: 'Drop RL', slot: 0 }

    const result = releaseKey([owner], binds, collision)

    // Blanked *in place*, not removed (story-050 review, finding 5): a release is what every other
    // release path does - `withKeySlot(…, { key: '' })` - so no later slot ever changes position.
    expect(result.actions).toEqual([{ ...owner, keys: [{ key: '' }] }])
    expect(result.binds).toEqual({})
    // purity
    expect(owner.keys).toEqual([{ key: 'q' }])
    expect(binds).toEqual({ q: aliasNameFor(owner) })
  })

  it('action: clears only the second slot, keeping the first key intact', () => {
    const owner = withKeys(action({ id: 'a1', name: 'Drop RL' }), { key: 'q' }, { key: 'MOUSE4' })
    const binds = { mouse4: aliasNameFor(owner) }
    const collision: BindCollision = {
      kind: 'action',
      key: 'MOUSE4',
      actionId: 'a1',
      name: 'Drop RL',
      slot: 1,
    }

    const result = releaseKey([owner], binds, collision)

    expect(result.actions).toEqual([{ ...owner, keys: [{ key: 'q' }, { key: '' }] }])
    expect(result.binds).toEqual({})
  })

  it('action: clears a third slot without disturbing the first two (story 050)', () => {
    const owner = withKeys(
      action({ id: 'a1', name: 'Drop RL' }),
      { key: 'q' },
      { key: 'MOUSE4' },
      { key: 'e' },
    )
    const binds = { e: aliasNameFor(owner) }
    const collision: BindCollision = { kind: 'action', key: 'e', actionId: 'a1', name: 'Drop RL', slot: 2 }

    const result = releaseKey([owner], binds, collision)

    expect(result.actions).toEqual([
      { ...owner, keys: [{ key: 'q' }, { key: 'MOUSE4' }, { key: '' }] },
    ])
    expect(result.binds).toEqual({})
  })

  it('action: releasing slot 0 never promotes a hand-added slot 2 into the editable columns', () => {
    // Story-050 review, finding 5: with `clearKeySlot` here, releasing slot 0 shifted `h` from
    // index 2 to index 1 - straight into the Controls tab's editable "secondary" column, which the
    // position-preserving write in `applySlot`/`applyModifierReplace` exists precisely to prevent.
    // Which column a key ends up in must not depend on which release path ran.
    const owner = withKeys(
      action({ id: 'a1', name: 'Drop RL' }),
      { key: 'f' },
      { key: 'g' },
      { key: 'h' },
    )
    const collision: BindCollision = { kind: 'action', key: 'f', actionId: 'a1', name: 'Drop RL', slot: 0 }

    const result = releaseKey([owner], {}, collision)

    expect(result.actions[0]!.keys).toEqual([{ key: '' }, { key: 'g' }, { key: 'h' }])
  })

  it('action: does not touch a bind entry that does not point at the released action’s own alias', () => {
    const owner = withKeys(action({ id: 'a1', name: 'Drop RL' }), { key: 'q' })
    // 'q' in binds points at something else entirely (e.g. stale data) - not this action's alias.
    const binds = { q: 'weapnext' }
    const collision: BindCollision = { kind: 'action', key: 'q', actionId: 'a1', name: 'Drop RL', slot: 0 }

    const result = releaseKey([owner], binds, collision)

    expect(result.actions).toEqual([{ ...owner, keys: [{ key: '' }] }])
    expect(result.binds).toEqual({ q: 'weapnext' })
  })

  it('action: clearing a modifier-bound slot also clears its modifier field (review fix)', () => {
    // Defense in depth: `findBindCollision` can no longer produce an `action` collision whose
    // slot carries a modifier (see the test above), but `releaseKey` clears the whole slot
    // regardless of how it is reached, so a half-filled slot (a modifier with no key) can never
    // exist - the invariant `catalog-binds.ts`'s `applySlot` documents.
    const owner = withKeys(action({ id: 'a1', name: 'Drop RL' }), { key: 'r', modifier: 'ALT' })
    const collision: BindCollision = { kind: 'action', key: 'r', actionId: 'a1', name: 'Drop RL', slot: 0 }

    const result = releaseKey([owner], {}, collision)

    // The whole slot is written, so the `ALT` goes with the key rather than being left stranded.
    expect(result.actions).toEqual([{ ...owner, keys: [{ key: '' }] }])
  })

  it('layerOverride: returns actions and binds unchanged', () => {
    const actions = [action({ id: 'a1' })]
    const binds = { w: '+forward' }
    const collision = findBindCollision(
      profile({ layers: [layer({ overrides: { '1': 'drop rl' } })] }),
      '1',
    )!

    const result = releaseKey(actions, binds, collision)

    expect(result.actions).toBe(actions)
    expect(result.binds).toBe(binds)
  })
})
