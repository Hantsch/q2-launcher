import { describe, expect, it } from 'vitest'
import type { ConfigAction, ConfigProfile } from '@shared/modules/config'
import type { AltLayer } from '@shared/config/alt-layers'
import { generateLayerAliases } from '@shared/config/alt-layers'
import type { SwitchBindChainInput } from './switch-bind'
import { renderSwitchBindChain } from './switch-bind'
import {
  OWNERSHIP_MARKER,
  profileFileName,
  renderLoaderFile,
  renderProfileFile,
  sentinelLine,
} from './render'

function profile(overrides: Partial<ConfigProfile> = {}): ConfigProfile {
  return {
    id: 'test-id',
    name: 'Test',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    cvars: {},
    binds: {},
    assignments: [],
    ...overrides,
  }
}

/** Story 008: mirrors `alias-render.test.ts`'s own `action()` helper. */
function action(overrides: Partial<ConfigAction> = {}): ConfigAction {
  return {
    id: 'ab12cd34-0000-0000-0000-000000000000',
    categoryId: 'weapons',
    name: 'Drop RL',
    commands: [{ kind: 'raw', text: 'drop rl' }],
    ...overrides,
  }
}

describe('renderProfileFile', () => {
  it('renders the sentinel line followed by sorted cvars then sorted binds', () => {
    const p = profile({
      id: 'abc123',
      cvars: { sensitivity: '3', cl_run: '0', crosshair: '0' },
      binds: { UPARROW: '+forward', c: '+movedown', SHIFT: '+speed' },
    })

    expect(renderProfileFile(p)).toBe(
      [
        '// q2-launcher profile abc123 - generated, do not edit',
        'set cl_run "0"',
        'set crosshair "0"',
        'set sensitivity "3"',
        'bind SHIFT "+speed"',
        'bind UPARROW "+forward"',
        'bind c "+movedown"',
        '',
      ].join('\n'),
    )
  })

  it('emits just the sentinel line and trailing newline for an empty profile', () => {
    const p = profile({ id: 'empty-id', cvars: {}, binds: {} })

    expect(renderProfileFile(p)).toBe('// q2-launcher profile empty-id - generated, do not edit\n')
  })

  it('round-trips high-ASCII values through latin1 byte-for-byte', () => {
    const p = profile({
      id: 'hi-ascii',
      cvars: { name: 'Bjørn' },
      binds: {},
    })

    const rendered = renderProfileFile(p)
    const roundTripped = Buffer.from(rendered, 'latin1').toString('latin1')

    expect(roundTripped).toBe(rendered)
  })
})

describe('renderProfileFile with layers', () => {
  const holdLayer: AltLayer = {
    id: 'layer-drops',
    name: 'Drops',
    mode: 'hold',
    triggerKey: 'ALT',
    overrides: { '1': 'drop rl', '2': 'drop rg' },
  }

  const toggleLayer: AltLayer = {
    id: 'layer-zoom',
    name: 'Zoom',
    mode: 'toggle',
    triggerKey: 'v',
    overrides: { MOUSE2: 'zoom_toggle_cmd' },
  }

  const emptyLayer: AltLayer = {
    id: 'layer-empty',
    name: 'Empty',
    mode: 'hold',
    triggerKey: 'g',
    overrides: {},
  }

  it('emits every layer alias, verbatim, between the set and bind blocks, in array + generation order', () => {
    const binds = { UPARROW: '+forward' }
    const p = profile({
      id: 'layers-id',
      cvars: { sensitivity: '3' },
      binds,
      layers: [holdLayer, toggleLayer],
    })

    const holdResult = generateLayerAliases(holdLayer, binds)
    const toggleResult = generateLayerAliases(toggleLayer, binds)

    const rendered = renderProfileFile(p)
    const lines = rendered.split('\n')

    const setLineIndex = lines.indexOf('set sensitivity "3"')
    const firstBindIndex = lines.indexOf('bind UPARROW "+forward"')

    expect(setLineIndex).toBeGreaterThanOrEqual(0)
    expect(firstBindIndex).toBeGreaterThan(setLineIndex)

    const aliasSection = lines.slice(setLineIndex + 1, firstBindIndex)
    const expectedAliasLines = [
      ...holdResult.aliases.map((a) => a.line),
      ...toggleResult.aliases.map((a) => a.line),
    ]

    expect(aliasSection).toEqual(expectedAliasLines)
  })

  it('appends both layers trigger binds after the sorted bind block, in profile layer order', () => {
    const binds = { UPARROW: '+forward' }
    const p = profile({
      id: 'layers-id',
      cvars: {},
      binds,
      layers: [holdLayer, toggleLayer],
    })

    const holdResult = generateLayerAliases(holdLayer, binds)
    const toggleResult = generateLayerAliases(toggleLayer, binds)

    const rendered = renderProfileFile(p)
    const lines = rendered.split('\n')

    const lastBaseBindIndex = lines.indexOf('bind UPARROW "+forward"')
    const trailing = lines.slice(lastBaseBindIndex + 1)

    expect(trailing).toEqual([
      `bind ${holdResult.triggerBind.key} ${holdResult.triggerBind.command}`,
      `bind ${toggleResult.triggerBind.key} ${toggleResult.triggerBind.command}`,
      '',
    ])
  })

  it('does not emit a trigger bind for an empty layer, but still emits one for a non-empty layer alongside it', () => {
    const binds = {}
    const p = profile({
      id: 'layers-id',
      cvars: {},
      binds,
      layers: [emptyLayer, holdLayer],
    })

    const emptyResult = generateLayerAliases(emptyLayer, binds)
    const holdResult = generateLayerAliases(holdLayer, binds)

    expect(emptyResult.aliases).toEqual([])

    const rendered = renderProfileFile(p)

    expect(rendered).not.toContain(`bind ${emptyResult.triggerBind.key} ${emptyResult.triggerBind.command}`)
    expect(rendered).toContain(`bind ${holdResult.triggerBind.key} ${holdResult.triggerBind.command}`)
  })

  it('renders a profile with layers: undefined identically to one without the field', () => {
    const p1 = profile({ id: 'no-layers', cvars: { crosshair: '0' }, binds: { c: '+movedown' } })
    const p2 = profile({
      id: 'no-layers',
      cvars: { crosshair: '0' },
      binds: { c: '+movedown' },
      layers: undefined,
    })

    expect(renderProfileFile(p2)).toBe(renderProfileFile(p1))
  })

  it('renders a profile with layers: [] identically to one without the field', () => {
    const p1 = profile({ id: 'no-layers', cvars: { crosshair: '0' }, binds: { c: '+movedown' } })
    const p2 = profile({
      id: 'no-layers',
      cvars: { crosshair: '0' },
      binds: { c: '+movedown' },
      layers: [],
    })

    expect(renderProfileFile(p2)).toBe(renderProfileFile(p1))
  })

  it('is deterministic across repeated calls on the same profile', () => {
    const p = profile({
      id: 'layers-id',
      cvars: { sensitivity: '3' },
      binds: { UPARROW: '+forward' },
      layers: [holdLayer, toggleLayer],
    })

    const first = renderProfileFile(p)
    const second = renderProfileFile(p)

    expect(second).toBe(first)
  })
})

describe('renderLoaderFile', () => {
  it('renders the sentinel line followed by the exec line', () => {
    const p = profile({ id: 'abc123' })

    expect(renderLoaderFile(p)).toBe(
      ['// q2-launcher profile abc123 - generated, do not edit', 'exec q2l-profile-abc123.cfg', ''].join(
        '\n',
      ),
    )
  })

  it('places the switch-bind chain after the exec line when given a usable chain input', () => {
    const p = profile({ id: 'abc123' })
    const switchBind: SwitchBindChainInput = {
      key: 'F9',
      defaultProfileId: 'abc123',
      profiles: [
        { id: 'abc123', name: 'Main' },
        { id: 'def456', name: 'Alt' },
      ],
    }

    const rendered = renderLoaderFile(p, switchBind)
    const lines = rendered.split('\n')
    const chainLines = renderSwitchBindChain(switchBind).split('\n')

    expect(lines).toEqual([
      '// q2-launcher profile abc123 - generated, do not edit',
      'exec q2l-profile-abc123.cfg',
      ...chainLines,
      '',
    ])
  })

  it('renders byte-identical to the no-argument call when the chain input yields an empty chain', () => {
    const p = profile({ id: 'abc123' })
    const switchBind: SwitchBindChainInput = {
      key: 'F9',
      defaultProfileId: 'abc123',
      // Fewer than 2 profiles - renderSwitchBindChain returns '' for this.
      profiles: [{ id: 'abc123', name: 'Main' }],
    }

    expect(renderLoaderFile(p, switchBind)).toBe(renderLoaderFile(p))
  })

  it('round-trips latin1 byte-for-byte with a high-ASCII profile name in the chain', () => {
    const p = profile({ id: 'abc123' })
    const switchBind: SwitchBindChainInput = {
      key: 'F9',
      defaultProfileId: 'abc123',
      profiles: [
        { id: 'abc123', name: 'Bjørn' },
        { id: 'def456', name: 'Alt' },
      ],
    }

    const rendered = renderLoaderFile(p, switchBind)
    const roundTripped = Buffer.from(rendered, 'latin1').toString('latin1')

    expect(roundTripped).toBe(rendered)
  })
})

describe('renderProfileFile with actions', () => {
  // Same shape as `renderProfileFile with layers`'s own `holdLayer` (that one
  // is scoped to its own `describe` block, so it is redefined here rather
  // than reached across blocks).
  const holdLayer: AltLayer = {
    id: 'layer-drops',
    name: 'Drops',
    mode: 'hold',
    triggerKey: 'ALT',
    overrides: { '1': 'drop rl', '2': 'drop rg' },
  }

  it('places the action alias block after the layer aliases and before the bind block', () => {
    const first = action({ name: 'One', id: 'aaaa0000' })
    const second = action({
      name: 'Two',
      id: 'bbbb1111',
      commands: [{ kind: 'raw', text: 'wave 2' }],
      key: 'x',
    })
    const p = profile({
      id: 'actions-id',
      cvars: { sensitivity: '3' },
      // The `x` bind is the mirror D4 writes for the keyed action; the existing
      // sorted bind loop emits it with no action-specific code.
      binds: { UPARROW: '+forward', x: 'q2l_a_two_bbbb' },
      layers: [holdLayer],
      actions: [first, second],
    })

    const lines = renderProfileFile(p).split('\n')

    const lastLayerAliasIndex = lines.indexOf('alias -drops "unbind 1; unbind 2"')
    const firstActionIndex = lines.indexOf('alias q2l_a_one_aaaa drop rl')
    const secondActionIndex = lines.indexOf('alias q2l_a_two_bbbb wave 2')
    const firstBindIndex = lines.indexOf('bind UPARROW "+forward"')

    expect(lines).toContain('alias +drops "bind 1 drop rl; bind 2 drop rg"')
    expect(lastLayerAliasIndex).toBeGreaterThanOrEqual(0)
    expect(firstActionIndex).toBeGreaterThan(lastLayerAliasIndex)
    expect(secondActionIndex).toBe(firstActionIndex + 1)
    expect(firstBindIndex).toBeGreaterThan(secondActionIndex)
    expect(lines).toContain('bind x "q2l_a_two_bbbb"')
  })

  it('renders a profile with actions: [] identically to one without the field', () => {
    const base = { id: 'no-actions', cvars: { crosshair: '0' }, binds: { c: '+movedown' } }

    expect(renderProfileFile(profile({ ...base, actions: [] }))).toBe(
      renderProfileFile(profile(base)),
    )
  })

  it('renders a profile with actions: undefined identically to one without the field', () => {
    const base = { id: 'no-actions', cvars: { crosshair: '0' }, binds: { c: '+movedown' } }

    expect(renderProfileFile(profile({ ...base, actions: undefined }))).toBe(
      renderProfileFile(profile(base)),
    )
  })

  it('leaves a profile with layers untouched when it has no actions', () => {
    const base = {
      id: 'no-actions',
      cvars: { crosshair: '0' },
      binds: { c: '+movedown' },
      layers: [holdLayer],
    }

    expect(renderProfileFile(profile({ ...base, actions: [] }))).toBe(
      renderProfileFile(profile(base)),
    )
  })

  it('round-trips a high-ASCII message action through latin1 byte-for-byte', () => {
    // One constant for input and expectation, so the assertion cannot silently
    // disagree with the action about which bytes it means.
    const text = 'Bjørn sagt: Größe ÿ'
    const p = profile({
      id: 'hi-ascii',
      actions: [
        action({
          name: 'Greet',
          id: 'ab12cd34',
          commands: [{ kind: 'message', channel: 'say', text }],
        }),
      ],
    })

    const rendered = renderProfileFile(p)

    expect(rendered).toContain(`alias q2l_a_greet_ab12 say ${text}`)
    expect(Buffer.from(rendered, 'latin1').toString('latin1')).toBe(rendered)
  })

  it('is deterministic across repeated calls on the same profile', () => {
    const p = profile({
      id: 'actions-id',
      actions: [action({ name: 'One', id: 'aaaa0000' }), action({ name: 'Two', id: 'bbbb1111' })],
    })

    expect(renderProfileFile(p)).toBe(renderProfileFile(p))
  })
})

describe('profileFileName', () => {
  it('produces q2l-profile-<id>.cfg', () => {
    expect(profileFileName('abc123')).toBe('q2l-profile-abc123.cfg')
  })
})

describe('sentinelLine', () => {
  it('produces the exact sentinel format', () => {
    expect(sentinelLine('abc123')).toBe('// q2-launcher profile abc123 - generated, do not edit')
  })

  it('is prefixed by OWNERSHIP_MARKER', () => {
    expect(sentinelLine('abc123').startsWith(OWNERSHIP_MARKER)).toBe(true)
  })
})
