import { describe, expect, it, vi } from 'vitest'
import type { AltLayer } from '@shared/config/alt-layers'
import {
  applyTriggerPress,
  applyTriggerRelease,
  resolveTestPress,
  type TestModeProfile,
  type TestModeSwitchState,
} from './test-mode'

// Real `generateLayerAliases` only ever returns a `null` triggerBind when the
// layer's own `triggerKey` is blank — and a blank trigger key can never be
// the one `resolveTestPress` matched on in the first place. Decision 4 still
// requires the resolver to degrade gracefully if `triggerBind` ever comes
// back null for a matched layer (e.g. a future alias-generation issue), so
// that specific case is exercised by mocking the generator for one call
// rather than by contorting a real layer into an unreachable state.
vi.mock('@shared/config/alt-layers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shared/config/alt-layers')>()
  return { ...actual, generateLayerAliases: vi.fn(actual.generateLayerAliases) }
})

function layer(overrides: Partial<AltLayer> = {}): AltLayer {
  return {
    id: 'l1',
    name: 'Weapons',
    mode: 'hold',
    triggerKey: null,
    overrides: {},
    ...overrides,
  }
}

function profile(overrides: Partial<TestModeProfile> = {}): TestModeProfile {
  return {
    binds: {},
    layers: [],
    actions: [],
    ...overrides,
  }
}

describe('resolveTestPress', () => {
  it('resolves a hold layer\'s trigger to kind trigger with mode hold and the +-prefixed alias', () => {
    const layers = [layer({ id: 'l1', name: 'Weapons', mode: 'hold', triggerKey: 'q', overrides: { w: '+forward' } })]

    const result = resolveTestPress('q', profile({ layers }), null)

    expect(result).toEqual({
      key: 'q',
      kind: 'trigger',
      layerId: 'l1',
      layerName: 'Weapons',
      mode: 'hold',
      alias: '+weapons',
    })
  })

  it('resolves a toggle layer\'s trigger with its dispatch alias', () => {
    const layers = [layer({ id: 'l1', name: 'Zoom', mode: 'toggle', triggerKey: 'v', overrides: { x: 'zoom_in' } })]

    const result = resolveTestPress('v', profile({ layers }), null)

    expect(result).toEqual({
      key: 'v',
      kind: 'trigger',
      layerId: 'l1',
      layerName: 'Zoom',
      mode: 'toggle',
      alias: 'zoom',
    })
  })

  it('resolves a layer whose triggerBind is null as kind trigger with alias null, never unbound', async () => {
    const { generateLayerAliases } = await import('@shared/config/alt-layers')
    vi.mocked(generateLayerAliases).mockReturnValueOnce({ aliases: [], triggerBind: null, issues: [] })

    const layers = [layer({ id: 'l1', name: 'Empty', mode: 'hold', triggerKey: 'q', overrides: {} })]

    const result = resolveTestPress('q', profile({ layers }), null)

    expect(result).toEqual({ key: 'q', kind: 'trigger', layerId: 'l1', layerName: 'Empty', mode: 'hold', alias: null })
  })

  it('with a layer displayed, a key with an override resolves kind override carrying the layer name', () => {
    const layers = [layer({ id: 'l1', name: 'Weapons', mode: 'hold', triggerKey: 'q', overrides: { w: '+forward' } })]

    const result = resolveTestPress('w', profile({ layers }), 'l1')

    expect(result).toEqual({ key: 'w', kind: 'override', command: '+forward', layerName: 'Weapons' })
  })

  it('with a layer displayed, a key without an override falls back to kind base', () => {
    const layers = [layer({ id: 'l1', name: 'Weapons', mode: 'hold', triggerKey: 'q', overrides: { w: '+forward' } })]

    const result = resolveTestPress('e', profile({ layers, binds: { e: 'use blaster' } }), 'l1')

    expect(result).toEqual({ key: 'e', kind: 'base', command: 'use blaster' })
  })

  it('resolves an unbound key to kind unbound', () => {
    const result = resolveTestPress('z', profile(), null)

    expect(result).toEqual({ key: 'z', kind: 'unbound' })
  })

  it('016-style fixture: resolving ALT reports the trigger, resolving R (with that layer displayed) reports the override (AC 7)', () => {
    const layers = [
      layer({ id: 'alt', name: 'Alt', mode: 'hold', triggerKey: 'ALT', overrides: { r: 'q2l_action_1' } }),
    ]

    const triggerResult = resolveTestPress('ALT', profile({ layers }), null)
    expect(triggerResult).toMatchObject({ kind: 'trigger', layerId: 'alt', layerName: 'Alt', mode: 'hold' })

    const overrideResult = resolveTestPress('r', profile({ layers }), 'alt')
    expect(overrideResult).toEqual({ key: 'r', kind: 'override', command: 'q2l_action_1', layerName: 'Alt' })
  })
})

describe('applyTriggerPress / applyTriggerRelease', () => {
  function state(overrides: Partial<TestModeSwitchState> = {}): TestModeSwitchState {
    return { displayedLayerId: null, heldTrigger: null, ...overrides }
  }

  it('a hold trigger press sets the layer and remembers the previous one; release restores it', () => {
    const initial = state({ displayedLayerId: 'base-selected' })
    const press = resolveTestPress(
      'q',
      profile({ layers: [layer({ id: 'l1', name: 'Weapons', mode: 'hold', triggerKey: 'q', overrides: { w: '+forward' } })] }),
      initial.displayedLayerId,
    )

    const pressed = applyTriggerPress(initial, press)
    expect(pressed).toEqual({ displayedLayerId: 'l1', heldTrigger: { key: 'q', restoreLayerId: 'base-selected' } })

    const released = applyTriggerRelease(pressed, 'q')
    expect(released).toEqual({ displayedLayerId: 'base-selected', heldTrigger: null })
  })

  it('a release of a key that is not the held trigger is a no-op', () => {
    const held = state({ displayedLayerId: 'l1', heldTrigger: { key: 'q', restoreLayerId: null } })

    expect(applyTriggerRelease(held, 'other')).toEqual(held)
  })

  it('a second hold press replaces the currently held trigger', () => {
    const layers = [
      layer({ id: 'l1', name: 'Weapons', mode: 'hold', triggerKey: 'q', overrides: { w: '+forward' } }),
      layer({ id: 'l2', name: 'Grenades', mode: 'hold', triggerKey: 'g', overrides: { w: '+grenade' } }),
    ]
    const initial = state({ displayedLayerId: null })

    const firstPress = resolveTestPress('q', profile({ layers }), initial.displayedLayerId)
    const afterFirst = applyTriggerPress(initial, firstPress)
    expect(afterFirst).toEqual({ displayedLayerId: 'l1', heldTrigger: { key: 'q', restoreLayerId: null } })

    const secondPress = resolveTestPress('g', profile({ layers }), afterFirst.displayedLayerId)
    const afterSecond = applyTriggerPress(afterFirst, secondPress)
    expect(afterSecond).toEqual({ displayedLayerId: 'l2', heldTrigger: { key: 'g', restoreLayerId: 'l1' } })
  })

  it('a toggle press flips layer<->base and is unaffected by a release', () => {
    const layers = [layer({ id: 'l1', name: 'Zoom', mode: 'toggle', triggerKey: 'v', overrides: { x: 'zoom_in' } })]
    const initial = state({ displayedLayerId: null })

    const press = resolveTestPress('v', profile({ layers }), initial.displayedLayerId)
    const toggled = applyTriggerPress(initial, press)
    expect(toggled).toEqual({ displayedLayerId: 'l1', heldTrigger: null })

    // A release of the toggle's own key must not touch displayedLayerId.
    const afterRelease = applyTriggerRelease(toggled, 'v')
    expect(afterRelease).toEqual(toggled)

    const pressAgain = resolveTestPress('v', profile({ layers }), toggled.displayedLayerId)
    const toggledBack = applyTriggerPress(toggled, pressAgain)
    expect(toggledBack).toEqual({ displayedLayerId: null, heldTrigger: null })
  })
})
