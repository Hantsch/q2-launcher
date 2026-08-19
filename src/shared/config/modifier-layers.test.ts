import { describe, expect, it } from 'vitest'
import type { AltLayer } from '@shared/config/alt-layers'
import { aliasNameFor } from '@shared/config/alias-render'
import type { ConfigAction } from '@shared/modules/config'
import { applyActionLayerMirror } from './modifier-layers'

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

function action(overrides: Partial<ConfigAction> = {}): ConfigAction {
  return {
    id: 'action-1',
    categoryId: 'category-1',
    name: 'Action',
    commands: [],
    ...overrides,
  }
}

/** Sequential id generator for tests that create more than one layer. */
function idSequence(...ids: string[]): () => string {
  let index = 0
  return () => ids[index++] ?? `unexpected-id-${index}`
}

describe('applyActionLayerMirror', () => {
  it('gives two catalogue rows that render identical command text their own distinct override (regression)', () => {
    // dropWeapon:grenades and dropAmmo:hgrenades both used to render the
    // identical command string "drop grenades" under the old, now-deleted
    // command-text lookup. Each catalogue row becomes a ConfigAction with its
    // own freshly generated `id` (never the catalogue row's own id - that is
    // what `catalogId` is for), so aliasNameFor - keyed off `action.id` - must
    // keep them apart regardless of the command they both happen to render.
    const dropWeaponGrenades = action({
      id: 'a1e29f00-0000-4000-8000-000000000001',
      catalogId: 'dropWeapon:grenades',
      name: 'Grenades',
      key: 'G',
      keyModifier: 'ALT',
    })
    const dropAmmoHgrenades = action({
      id: 'b7c48d11-0000-4000-8000-000000000002',
      catalogId: 'dropAmmo:hgrenades',
      name: 'Hand Grenades',
      key: 'H',
      keyModifier: 'ALT',
    })

    const result = applyActionLayerMirror(
      [],
      [dropWeaponGrenades, dropAmmoHgrenades],
      idSequence('alt-layer'),
    )

    expect(result).toHaveLength(1)
    const altLayer = result[0]!
    expect(altLayer.triggerKey).toBe('ALT')
    // normalizeBindKey lower-cases a single printable character on write.
    expect(altLayer.overrides.g).toBe(aliasNameFor(dropWeaponGrenades))
    expect(altLayer.overrides.h).toBe(aliasNameFor(dropAmmoHgrenades))
    expect(altLayer.overrides.g).not.toBe(altLayer.overrides.h)
  })

  it('leaves hand-made overrides and non-modifier layers completely untouched', () => {
    const zoomLayer = layer({
      id: 'zoom-1',
      name: 'Zoom',
      triggerKey: 'v',
      overrides: { '1': 'wave 1' },
    })
    const handMadeAlt = layer({
      id: 'hand-alt',
      name: 'Rocketjump',
      triggerKey: 'ALT',
      overrides: { Q: 'say_team taking rl' },
    })

    const result = applyActionLayerMirror([zoomLayer, handMadeAlt], [], idSequence())

    // Untouched by value...
    expect(result).toEqual([zoomLayer, handMadeAlt])
    // ...and by identity: nothing was stripped, so no new object was made.
    expect(result[0]).toBe(zoomLayer)
    expect(result[1]).toBe(handMadeAlt)
  })

  it('gives Alt+R and Ctrl+R two separate layers, each owning its own R', () => {
    const altR = action({ id: 'alt-r-action', name: 'Alt R', key: 'R', keyModifier: 'ALT' })
    const ctrlR = action({ id: 'ctrl-r-action', name: 'Ctrl R', key: 'R', keyModifier: 'CTRL' })

    const result = applyActionLayerMirror([], [altR, ctrlR], idSequence('alt-layer', 'ctrl-layer'))

    expect(result).toHaveLength(2)
    const altLayer = result.find((candidate) => candidate.triggerKey === 'ALT')
    const ctrlLayer = result.find((candidate) => candidate.triggerKey === 'CTRL')
    expect(altLayer?.overrides.r).toBe(aliasNameFor(altR))
    expect(ctrlLayer?.overrides.r).toBe(aliasNameFor(ctrlR))
    expect(altLayer?.overrides.r).not.toBe(ctrlLayer?.overrides.r)
  })

  it('reuses a pre-existing hand-made ALT layer instead of creating a second one', () => {
    const handMade = layer({ id: 'hand-1', name: 'Rocketjump', triggerKey: 'ALT', overrides: {} })
    const rocketJump = action({ id: 'rj-action', name: 'Rocket Jump', key: 'R', keyModifier: 'ALT' })

    const result = applyActionLayerMirror([handMade], [rocketJump], idSequence())

    const altLayers = result.filter((candidate) => candidate.triggerKey === 'ALT')
    expect(altLayers).toHaveLength(1)
    expect(altLayers[0]?.id).toBe('hand-1')
    expect(altLayers[0]?.name).toBe('Rocketjump')
    expect(altLayers[0]?.overrides.r).toBe(aliasNameFor(rocketJump))
  })

  it('is idempotent: calling it twice with the same inputs yields the same result both times', () => {
    const altR = action({ id: 'alt-r-action', name: 'Alt R', key: 'R', keyModifier: 'ALT' })
    const ctrlR = action({ id: 'ctrl-r-action', name: 'Ctrl R', key: 'R', keyModifier: 'CTRL' })
    const actions = [altR, ctrlR]

    const first = applyActionLayerMirror([], actions, idSequence('alt-layer', 'ctrl-layer'))
    const second = applyActionLayerMirror(first, actions, idSequence())

    expect(second).toEqual(first)
  })

  it('leaves no stale override once an action loses its modifier', () => {
    // Simulates the state after a prior mirror pass wrote this override, then
    // the action was edited to drop its ALT modifier (or removed outright).
    const staleAlias = 'q2l_a_stale_0000'
    const altLayerWithStale = layer({
      id: 'alt-1',
      name: 'Alt',
      triggerKey: 'ALT',
      overrides: { G: staleAlias },
    })

    // The action no longer carries a modifier at all (plain base bind now).
    const stillPresentNoModifier = action({ id: 'stale', name: 'Stale', key: 'G' })

    const result = applyActionLayerMirror([altLayerWithStale], [stillPresentNoModifier], idSequence())

    const altLayer = result.find((candidate) => candidate.triggerKey === 'ALT')
    expect(altLayer?.overrides.G).toBeUndefined()

    // Same, but the action is removed from `actions` entirely.
    const resultRemoved = applyActionLayerMirror([altLayerWithStale], [], idSequence())
    const altLayerRemoved = resultRemoved.find((candidate) => candidate.triggerKey === 'ALT')
    expect(altLayerRemoved?.overrides.G).toBeUndefined()
  })
})
