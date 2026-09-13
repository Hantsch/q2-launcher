import { describe, expect, it } from 'vitest'
import type { AltLayer } from '@shared/config/alt-layers'
import { aliasNameFor } from '@shared/config/alias-render'
import { applyActionBindMirror } from '@shared/config/action-mirror'
import type { ActionKeySlot, ConfigAction } from '@shared/modules/config'
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
    kind: 'bind',
    commands: [],
    ...overrides,
  }
}

/** Builds a `keys` array from a sparse list of slots - `undefined` entries are skipped. */
function keySlots(...slots: (ActionKeySlot | undefined)[]): ActionKeySlot[] {
  return slots.filter((slot): slot is ActionKeySlot => slot !== undefined)
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
      keys: keySlots({ key: 'G', modifier: 'ALT' }),
    })
    const dropAmmoHgrenades = action({
      id: 'b7c48d11-0000-4000-8000-000000000002',
      catalogId: 'dropAmmo:hgrenades',
      name: 'Hand Grenades',
      keys: keySlots({ key: 'H', modifier: 'ALT' }),
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
    const altR = action({ id: 'alt-r-action', name: 'Alt R', keys: keySlots({ key: 'R', modifier: 'ALT' }) })
    const ctrlR = action({ id: 'ctrl-r-action', name: 'Ctrl R', keys: keySlots({ key: 'R', modifier: 'CTRL' }) })

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
    const rocketJump = action({ id: 'rj-action', name: 'Rocket Jump', keys: keySlots({ key: 'R', modifier: 'ALT' }) })

    const result = applyActionLayerMirror([handMade], [rocketJump], idSequence())

    const altLayers = result.filter((candidate) => candidate.triggerKey === 'ALT')
    expect(altLayers).toHaveLength(1)
    expect(altLayers[0]?.id).toBe('hand-1')
    expect(altLayers[0]?.name).toBe('Rocketjump')
    expect(altLayers[0]?.overrides.r).toBe(aliasNameFor(rocketJump))
  })

  it('is idempotent: calling it twice with the same inputs yields the same result both times', () => {
    const altR = action({ id: 'alt-r-action', name: 'Alt R', keys: keySlots({ key: 'R', modifier: 'ALT' }) })
    const ctrlR = action({ id: 'ctrl-r-action', name: 'Ctrl R', keys: keySlots({ key: 'R', modifier: 'CTRL' }) })
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
    const stillPresentNoModifier = action({ id: 'stale', name: 'Stale', keys: keySlots({ key: 'G' }) })

    const result = applyActionLayerMirror([altLayerWithStale], [stillPresentNoModifier], idSequence())

    const altLayer = result.find((candidate) => candidate.triggerKey === 'ALT')
    expect(altLayer?.overrides.G).toBeUndefined()

    // Same, but the action is removed from `actions` entirely.
    const resultRemoved = applyActionLayerMirror([altLayerWithStale], [], idSequence())
    const altLayerRemoved = resultRemoved.find((candidate) => candidate.triggerKey === 'ALT')
    expect(altLayerRemoved?.overrides.G).toBeUndefined()
  })
  // Story 039 D3: the prefix is no longer the ownership test, so these cases use an explicit,
  // prefix-free `aliasName`. Nothing here starts with `q2l_a_`: every removal below fails if the
  // strip falls back to the legacy marker alone, and the hand-typed `z: 'ssg_sg'` fails if the
  // value-based half is ever applied without its key scope.
  describe('with prefix-free alias names', () => {
    function ssgSg(overrides: Partial<ConfigAction> = {}): ConfigAction {
      return action({
        id: 'ssg',
        name: 'SSG + SG',
        aliasName: 'ssg_sg',
        commands: [
          { kind: 'raw', text: 'use super shotgun' },
          { kind: 'raw', text: 'use shotgun' },
        ],
        ...overrides,
      })
    }

    /** An ALT layer carrying our own override plus three the user typed themselves. */
    function altLayerWithHandMade(): AltLayer {
      return layer({
        id: 'alt-1',
        name: 'Alt',
        triggerKey: 'ALT',
        overrides: { g: 'ssg_sg', r: '+attack', x: 'some_alias', z: 'ssg_sg' },
      })
    }

    it('leaves hand-made overrides alone, including one referencing the alias by hand', () => {
      const bound = ssgSg({ keys: keySlots({ key: 'g', modifier: 'ALT' }) })

      const result = applyActionLayerMirror([altLayerWithHandMade()], [bound], idSequence(), [bound])

      expect(result).toHaveLength(1)
      expect(result[0]!.overrides).toEqual({
        g: 'ssg_sg',
        r: '+attack',
        x: 'some_alias',
        z: 'ssg_sg',
      })
    })

    it('clears the override of a slot the user cleared in the Controls grid', () => {
      const before = ssgSg({ keys: keySlots({ key: 'g', modifier: 'ALT' }) })
      const cleared = ssgSg({ keys: [] })

      const result = applyActionLayerMirror([altLayerWithHandMade()], [cleared], idSequence(), [
        before,
      ])

      expect(result[0]!.overrides).toEqual({ r: '+attack', x: 'some_alias', z: 'ssg_sg' })
    })

    it('leaves nothing behind when the action is deleted', () => {
      const before = ssgSg({
        keys: keySlots({ key: 'g', modifier: 'ALT' }, { key: 'h', modifier: 'ALT' }),
      })
      const withBoth = layer({
        id: 'alt-1',
        name: 'Alt',
        triggerKey: 'ALT',
        overrides: { g: 'ssg_sg', h: 'ssg_sg', r: '+attack' },
      })

      const result = applyActionLayerMirror([withBoth], [], idSequence(), [before])

      expect(result[0]!.overrides).toEqual({ r: '+attack' })
    })

    it('hands a slot that gains a modifier over from `binds` to the layer, and back', () => {
      // The two mirrors run in the same save and must agree: exactly one of them may hold the slot,
      // or the key is either bound twice or not at all.
      const base = ssgSg({ keys: keySlots({ key: 'g' }) })
      const modified = ssgSg({ keys: keySlots({ key: 'g', modifier: 'ALT' }) })

      // base -> ALT: the base bind goes, the override appears.
      expect(applyActionBindMirror({ g: 'ssg_sg' }, [modified], [base])).toEqual({})
      const gained = applyActionLayerMirror([], [modified], idSequence('alt-layer'), [base])
      expect(gained).toHaveLength(1)
      expect(gained[0]!.overrides).toEqual({ g: 'ssg_sg' })

      // ALT -> base: the override goes, the base bind comes back.
      const lost = applyActionLayerMirror(gained, [base], idSequence(), [modified])
      expect(lost[0]!.overrides).toEqual({})
      expect(applyActionBindMirror({}, [base], [modified])).toEqual({ g: 'ssg_sg' })
    })

    it('mirrors a third slot (index 2) into its modifier layer too, not just the first two', () => {
      // Story 050, D3's acceptance criterion: an action with a third key slot that carries a
      // modifier gets an override for it exactly like the first two, since the mirror loops over
      // every slot the accessor returns.
      const threeSlots = ssgSg({
        keys: keySlots({ key: 'g' }, { key: 'h' }, { key: 'j', modifier: 'ALT' }),
      })

      const result = applyActionLayerMirror([], [threeSlots], idSequence('alt-layer'))

      expect(result).toHaveLength(1)
      expect(result[0]!.triggerKey).toBe('ALT')
      expect(result[0]!.overrides).toEqual({ j: 'ssg_sg' })
      // The two unmodified slots stay out of the layer - they belong to `applyActionBindMirror`.
      expect(applyActionBindMirror({}, [threeSlots])).toEqual({ g: 'ssg_sg', h: 'ssg_sg' })
    })
  })

  // Story 019 D2: an alias entry defines an alias for other bindings to call.
  // It is not bindable, so it must never reach a layer's overrides - the
  // exclusion lives here, at the single derive site, and not in a caller.
  describe('alias entries', () => {
    it('writes no override for an alias entry, even one still carrying key + modifier', () => {
      const aliasEntry = action({
        id: 'alias-entry',
        name: '+test',
        kind: 'alias',
        keys: keySlots({ key: 'R', modifier: 'ALT' }),
      })

      const result = applyActionLayerMirror([], [aliasEntry], idSequence('alt-layer'))

      // Not even the ALT layer itself is created for it.
      expect(result).toEqual([])
    })

    it('strips the stale override of an entry that has just become an alias', () => {
      const before = action({ id: 'turned', name: '+test', keys: keySlots({ key: 'R', modifier: 'ALT' }) })
      const created = applyActionLayerMirror([], [before], idSequence('alt-layer'))
      expect(created[0]!.overrides).toEqual({ r: aliasNameFor(before) })

      // `previousActions` passed explicitly as `[before]` (still `kind: 'bind'`) - the same shape
      // `setActions` always calls this with when a row's `kind` changes mid-edit (story 039, D7):
      // the ownership rule is value-based against what the action *used to* mirror, not against
      // what its now-`alias` self would mirror today, so the strip needs the pre-change object to
      // recognise its own stale override.
      const result = applyActionLayerMirror(
        created,
        [{ ...before, kind: 'alias' }],
        idSequence(),
        [before],
      )

      expect(result[0]!.overrides).toEqual({})
    })

    it('leaves hand-made overrides and other rows alone while skipping the alias entry', () => {
      const handMade = layer({
        id: 'alt-1',
        name: 'Rocketjump',
        triggerKey: 'ALT',
        overrides: { q: 'say_team taking rl' },
      })
      const aliasEntry = action({
        id: 'alias-entry',
        name: '+test',
        kind: 'alias',
        keys: keySlots({ key: 'R', modifier: 'ALT' }),
      })
      const bound = action({ id: 'bound', name: 'Rocket Jump', keys: keySlots({ key: 'G', modifier: 'ALT' }) })

      const result = applyActionLayerMirror([handMade], [aliasEntry, bound], idSequence())

      expect(result).toHaveLength(1)
      expect(result[0]!.overrides).toEqual({
        q: 'say_team taking rl',
        g: aliasNameFor(bound),
      })
    })
  })
})
