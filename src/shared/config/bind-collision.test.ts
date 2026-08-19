import { describe, expect, it } from 'vitest'
import type { AltLayer } from '@shared/config/alt-layers'
import { aliasNameFor } from '@shared/config/alias-render'
import type { ConfigAction, ConfigProfile } from '@shared/modules/config'
import { findBindCollision, releaseKey, type BindCollision } from './bind-collision'

function action(overrides: Partial<ConfigAction> = {}): ConfigAction {
  return {
    id: 'action-1',
    categoryId: 'movement',
    name: 'Jump',
    commands: [{ kind: 'raw', text: '+moveup' }],
    ...overrides,
  }
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

  it('reports an action collision on the primary slot', () => {
    const owner = action({ id: 'a1', name: 'Drop RL', key: 'q' })
    const result = findBindCollision(profile({ actions: [owner] }), 'q')
    expect(result).toEqual({ kind: 'action', key: 'q', actionId: 'a1', name: 'Drop RL', slot: 'primary' })
  })

  it('reports an action collision on the secondary slot', () => {
    const owner = action({ id: 'a1', name: 'Drop RL', secondaryKey: 'MOUSE4' })
    const result = findBindCollision(profile({ actions: [owner] }), 'mouse4')
    expect(result).toEqual({
      kind: 'action',
      key: 'MOUSE4',
      actionId: 'a1',
      name: 'Drop RL',
      slot: 'secondary',
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
    const owner = action({ id: 'a1', name: 'Drop RL', key: 'q' })
    const binds = { q: aliasNameFor(owner) }
    const result = findBindCollision(profile({ actions: [owner], binds }), 'q')
    expect(result).toEqual({ kind: 'action', key: 'q', actionId: 'a1', name: 'Drop RL', slot: 'primary' })
  })

  it('self-ignore: re-capturing a slot to its own current key is not a collision', () => {
    const owner = action({ id: 'a1', name: 'Drop RL', key: 'q' })
    const result = findBindCollision(profile({ actions: [owner] }), 'q', {
      actionId: 'a1',
      slot: 'primary',
    })
    expect(result).toBeNull()
  })

  it('self-ignore: the mirrored base bind for the ignored action’s own key is not a collision either', () => {
    const owner = action({ id: 'a1', name: 'Drop RL', key: 'q' })
    const mirroredBinds = { q: aliasNameFor(owner) }
    const result = findBindCollision(
      profile({ actions: [owner], binds: mirroredBinds }),
      'q',
      { actionId: 'a1', slot: 'primary' },
    )
    expect(result).toBeNull()
  })

  it('self-ignore only excludes the named slot: the other slot on the same action still collides', () => {
    const owner = action({ id: 'a1', name: 'Drop RL', key: 'q', secondaryKey: 'q' })
    const result = findBindCollision(profile({ actions: [owner] }), 'q', {
      actionId: 'a1',
      slot: 'primary',
    })
    expect(result).toEqual({ kind: 'action', key: 'q', actionId: 'a1', name: 'Drop RL', slot: 'secondary' })
  })

  it('a foreign base bind still collides even when an ignore is given for an unrelated action', () => {
    const owner = action({ id: 'a1', name: 'Drop RL', key: 'e' })
    const result = findBindCollision(profile({ binds: { w: '+forward' }, actions: [owner] }), 'w', {
      actionId: 'a1',
      slot: 'primary',
    })
    expect(result).toEqual({ kind: 'baseBind', key: 'w', command: '+forward' })
  })
})

describe('releaseKey', () => {
  it('baseBind: removes the key from binds, leaves actions untouched', () => {
    const actions = [action({ id: 'a1', key: 'e' })]
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
    const owner = action({ id: 'a1', name: 'Drop RL', key: 'q' })
    const binds = { q: aliasNameFor(owner) }
    const collision: BindCollision = { kind: 'action', key: 'q', actionId: 'a1', name: 'Drop RL', slot: 'primary' }

    const result = releaseKey([owner], binds, collision)

    expect(result.actions).toEqual([{ ...owner, key: undefined }])
    expect(result.binds).toEqual({})
    // purity
    expect(owner.key).toBe('q')
    expect(binds).toEqual({ q: aliasNameFor(owner) })
  })

  it('action: clears only the secondary slot, keeping the primary key intact', () => {
    const owner = action({ id: 'a1', name: 'Drop RL', key: 'q', secondaryKey: 'MOUSE4' })
    const binds = { mouse4: aliasNameFor(owner) }
    const collision: BindCollision = {
      kind: 'action',
      key: 'MOUSE4',
      actionId: 'a1',
      name: 'Drop RL',
      slot: 'secondary',
    }

    const result = releaseKey([owner], binds, collision)

    expect(result.actions).toEqual([{ ...owner, secondaryKey: undefined }])
    expect(result.binds).toEqual({})
  })

  it('action: does not touch a bind entry that does not point at the released action’s own alias', () => {
    const owner = action({ id: 'a1', name: 'Drop RL', key: 'q' })
    // 'q' in binds points at something else entirely (e.g. stale data) - not this action's alias.
    const binds = { q: 'weapnext' }
    const collision: BindCollision = { kind: 'action', key: 'q', actionId: 'a1', name: 'Drop RL', slot: 'primary' }

    const result = releaseKey([owner], binds, collision)

    expect(result.actions).toEqual([{ ...owner, key: undefined }])
    expect(result.binds).toEqual({ q: 'weapnext' })
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
