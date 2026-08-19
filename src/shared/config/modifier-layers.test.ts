import { describe, expect, it } from 'vitest'
import type { AltLayer } from '@shared/config/alt-layers'
import { generateLayerAliases, sanitizeCommand } from '@shared/config/alt-layers'
import type { ConfigProfile } from '@shared/modules/config'
import {
  findBindLocation,
  findModifierOverrideOwner,
  upsertModifierLayerOverride,
  type UpsertModifierLayerOverrideInput,
} from './modifier-layers'

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

function upsert(
  input: Partial<UpsertModifierLayerOverrideInput> = {},
): ReturnType<typeof upsertModifierLayerOverride> {
  return upsertModifierLayerOverride({
    layers: [],
    modifier: 'ALT',
    key: 'R',
    command: 'drop rocket launcher',
    newId: 'new-layer-id',
    ...input,
  })
}

describe('upsertModifierLayerOverride — creating a new layer', () => {
  it('creates a hold ALT layer named Alt when none exists', () => {
    const result = upsert()

    expect(result.created).toBe(true)
    expect(result.layerId).toBe('new-layer-id')
    expect(result.previousCommand).toBeUndefined()
    expect(result.layers).toEqual([
      {
        id: 'new-layer-id',
        name: 'Alt',
        mode: 'hold',
        triggerKey: 'ALT',
        overrides: { R: 'drop rocket launcher' },
      },
    ])
  })

  it('uses the modifier-specific literal name for CTRL and SHIFT', () => {
    expect(upsert({ modifier: 'CTRL', newId: 'c1' }).layers[0]?.name).toBe('Ctrl')
    expect(upsert({ modifier: 'SHIFT', newId: 's1' }).layers[0]?.name).toBe('Shift')
  })

  it('reuses the same layer for a second key under the same modifier', () => {
    const first = upsert()
    const second = upsertModifierLayerOverride({
      layers: first.layers,
      modifier: 'ALT',
      key: 'F',
      command: 'wave 1',
      newId: 'unused-because-reused',
    })

    expect(second.created).toBe(false)
    expect(second.layerId).toBe('new-layer-id')
    // Same layer, not a second one.
    expect(second.layers).toHaveLength(1)
    expect(second.layers[0]?.overrides).toEqual({
      R: 'drop rocket launcher',
      F: 'wave 1',
    })
  })

  it('reuses a pre-existing hand-made layer with an arbitrary name', () => {
    const handMade = layer({ id: 'hand-1', name: 'Rocketjump', triggerKey: 'ALT', overrides: {} })
    const result = upsert({ layers: [handMade] })

    expect(result.created).toBe(false)
    expect(result.layerId).toBe('hand-1')
    expect(result.layers).toHaveLength(1)
    expect(result.layers[0]?.name).toBe('Rocketjump')
    expect(result.layers[0]?.overrides).toEqual({ R: 'drop rocket launcher' })
  })

  it('keeps Ctrl+R and Alt+R in two different layers, each owning its own R', () => {
    const afterCtrl = upsert({ modifier: 'CTRL', key: 'R', command: 'wave 2', newId: 'ctrl-layer' })
    const afterAlt = upsertModifierLayerOverride({
      layers: afterCtrl.layers,
      modifier: 'ALT',
      key: 'R',
      command: 'drop rocket launcher',
      newId: 'alt-layer',
    })

    expect(afterAlt.layers).toHaveLength(2)
    const ctrlLayer = afterAlt.layers.find((candidate) => candidate.triggerKey === 'CTRL')
    const altLayer = afterAlt.layers.find((candidate) => candidate.triggerKey === 'ALT')
    expect(ctrlLayer?.overrides.R).toBe('wave 2')
    expect(altLayer?.overrides.R).toBe('drop rocket launcher')
  })
})

describe('upsertModifierLayerOverride — untouched inputs', () => {
  it('leaves every other layer untouched (deep-equal, and unrelated overrides object identity-safe)', () => {
    const untouched = layer({
      id: 'other',
      name: 'Zoom',
      triggerKey: 'v',
      overrides: { '1': 'zoom' },
    })
    const altLayer = layer({
      id: 'alt-1',
      name: 'Alt',
      triggerKey: 'ALT',
      overrides: { Q: 'wave 3' },
    })

    const result = upsert({ layers: [untouched, altLayer], newId: 'unused' })

    const returnedUntouched = result.layers.find((candidate) => candidate.id === 'other')
    expect(returnedUntouched).toBe(untouched)
    expect(returnedUntouched?.overrides).toEqual({ '1': 'zoom' })
  })
})

describe('upsertModifierLayerOverride — previousCommand', () => {
  it('reports the command a second write to the same key would replace', () => {
    const first = upsert({ key: 'R', command: 'drop rocket launcher' })
    const second = upsertModifierLayerOverride({
      layers: first.layers,
      modifier: 'ALT',
      key: 'R',
      command: 'drop grenade launcher',
      newId: 'unused',
    })

    expect(second.previousCommand).toBe('drop rocket launcher')
    expect(second.layers[0]?.overrides.R).toBe('drop grenade launcher')
  })

  it('is undefined for a key that had no override yet, even in an existing layer', () => {
    const first = upsert({ key: 'R' })
    const second = upsertModifierLayerOverride({
      layers: first.layers,
      modifier: 'ALT',
      key: 'F',
      command: 'wave 1',
      newId: 'unused',
    })

    expect(second.previousCommand).toBeUndefined()
  })
})

describe('upsertModifierLayerOverride — command storage', () => {
  it('stores the command via sanitizeCommand only, never re-derived or re-joined', () => {
    const result = upsert({ command: 'drop  rocket  launcher   ' })
    // sanitizeCommand alone: whitespace runs collapsed to one space, trimmed —
    // no extra prefix/suffix a re-derivation step might add.
    expect(result.layers[0]?.overrides.R).toBe('drop rocket launcher')
  })

  it('drops quote characters the same way sanitizeCommand does', () => {
    const result = upsert({ command: 'say_team "taking rl"; drop rl' })
    expect(result.layers[0]?.overrides.R).not.toContain('"')
    expect(result.layers[0]?.overrides.R).toBe('say_team taking rl; drop rl')
  })
})

describe('findBindLocation', () => {
  it('finds a command bound in profile.binds with modifier: null', () => {
    const result = findBindLocation(profile({ binds: { w: '+forward' } }), '+forward')
    expect(result).toEqual({ key: 'w', modifier: null })
  })

  it('finds a command bound only inside an ALT layer override', () => {
    const altLayer = layer({ triggerKey: 'ALT', overrides: { R: 'drop rocket launcher' } })
    const result = findBindLocation(profile({ layers: [altLayer] }), 'drop rocket launcher')
    // normalizeBindKey lower-cases a single printable character.
    expect(result).toEqual({ key: 'r', modifier: 'ALT' })
  })

  it('returns null when the command is bound nowhere', () => {
    const result = findBindLocation(
      profile({ binds: { w: '+forward' }, layers: [layer({ overrides: { R: 'drop rl' } })] }),
      'quit',
    )
    expect(result).toBeNull()
  })

  it('prefers a base-bind match over a layer override match', () => {
    const altLayer = layer({ triggerKey: 'ALT', overrides: { Q: 'wave 1' } })
    const result = findBindLocation(
      profile({ binds: { w: 'wave 1' }, layers: [altLayer] }),
      'wave 1',
    )
    expect(result).toEqual({ key: 'w', modifier: null })
  })

  it('skips a non-modifier layer even if its override matches the command', () => {
    const zoomLayer = layer({
      id: 'zoom',
      name: 'Zoom',
      triggerKey: 'v',
      overrides: { '1': 'wave 1' },
    })
    const result = findBindLocation(profile({ layers: [zoomLayer] }), 'wave 1')
    expect(result).toBeNull()
  })

  it('skips a layer with no trigger key at all', () => {
    const triggerless = layer({ triggerKey: null, overrides: { R: 'drop rl' } })
    const result = findBindLocation(profile({ layers: [triggerless] }), 'drop rl')
    expect(result).toBeNull()
  })
})

describe('findModifierOverrideOwner', () => {
  it('returns null when no layer exists for the modifier', () => {
    expect(findModifierOverrideOwner([], 'ALT', 'R')).toBeNull()
  })

  it('returns null when the layer exists but the key has no override yet', () => {
    const altLayer = layer({ id: 'alt-1', name: 'Alt', triggerKey: 'ALT', overrides: {} })
    expect(findModifierOverrideOwner([altLayer], 'ALT', 'R')).toBeNull()
  })

  it('reports the layer id/name and the exact occupying command', () => {
    const altLayer = layer({
      id: 'alt-1',
      name: 'Alt',
      triggerKey: 'ALT',
      overrides: { R: 'drop rocket launcher' },
    })
    expect(findModifierOverrideOwner([altLayer], 'ALT', 'R')).toEqual({
      layerId: 'alt-1',
      layerName: 'Alt',
      command: 'drop rocket launcher',
    })
  })

  it('matches by triggerKey only, so a hand-made layer with an arbitrary name is still found', () => {
    const handMade = layer({
      id: 'hand-1',
      name: 'Rocketjump',
      triggerKey: 'ALT',
      overrides: { R: 'drop rocket launcher' },
    })
    expect(findModifierOverrideOwner([handMade], 'ALT', 'R')?.layerName).toBe('Rocketjump')
  })

  it('does not cross modifiers: a CTRL override at the same key is invisible to an ALT lookup', () => {
    const ctrlLayer = layer({ id: 'ctrl-1', name: 'Ctrl', triggerKey: 'CTRL', overrides: { R: 'wave 1' } })
    expect(findModifierOverrideOwner([ctrlLayer], 'ALT', 'R')).toBeNull()
  })
})

describe('base bind vs. layer override — identical rendering (no second code path)', () => {
  // A command with both a `;` (helper-alias hoisting) and a `"` (quote
  // stripping), exercising alt-layers.ts's quoting rules end-to-end.
  const COMMAND = 'drop rocket launcher; say_team "dropping RL"'

  it('renders the identical executed command whether the string is a base bind or a fresh layer override', () => {
    // Path A: what a base bind stores for this exact string (D6: the editor
    // sanitizes before saving a raw command as a base bind).
    const baseBoundCommand = sanitizeCommand(COMMAND)

    // Path B: the exact same string placed into a layer override via
    // upsertModifierLayerOverride (what D3's caller does for an Alt+R capture).
    const { layers } = upsert({ layers: [], key: 'R', command: COMMAND })
    const altLayer = layers[0]!
    const overrideCommand = altLayer.overrides.R!

    // One sanitizing code path: the base-bind text and the layer-override
    // text agree exactly, and neither carries the quote the user typed.
    expect(overrideCommand).toBe(baseBoundCommand)
    expect(overrideCommand).not.toContain('"')
    expect(overrideCommand).toBe('drop rocket launcher; say_team dropping RL')

    // A hand-built layer carrying that same already-sanitized string renders
    // byte-identical aliases to the one upsertModifierLayerOverride produced
    // — proving there is no second, divergent rendering path either.
    const handPlacedLayer = layer({
      id: 'hand',
      name: 'Alt',
      triggerKey: 'ALT',
      overrides: { R: overrideCommand },
    })
    const rendered = generateLayerAliases(altLayer, {})
    const handRendered = generateLayerAliases(handPlacedLayer, {})
    expect(rendered.aliases.map((a) => a.line)).toEqual(handRendered.aliases.map((a) => a.line))

    // The `;`-carrying command was hoisted into its own helper alias, whose
    // body is exactly the sanitized command both paths agree on.
    const helperAlias = rendered.aliases.find((a) => /_c\d+$/.test(a.name))
    expect(helperAlias?.body).toBe(baseBoundCommand)
  })

  it('never leaves a quote character in the stored override or its rendered alias', () => {
    const { layers } = upsert({ layers: [], key: 'R', command: COMMAND })
    const altLayer = layers[0]!
    const rendered = generateLayerAliases(altLayer, {})

    expect(altLayer.overrides.R).not.toContain('"')
    for (const alias of rendered.aliases) expect(alias.body).not.toContain('"')
  })
})
