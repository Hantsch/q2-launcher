import { latin1RoundTrip } from './render.test-helpers'
import { describe, expect, it } from 'vitest'
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
import {
  profile,
  testProfileHeader,
  TEST_PROFILE_UNBINDALL,
  cvarBlock,
  unformat,
} from './render.test-helpers'

describe('renderProfileFile', () => {
  it('renders the header block, then cvars grouped by catalog order, then the unowned binds', () => {
    const p = profile({
      id: 'abc123',
      cvars: { sensitivity: '3', cl_run: '0', crosshair: '0' },
      binds: { UPARROW: '+forward', c: '+movedown', SHIFT: '+speed' },
    })

    expect(renderProfileFile(p)).toBe(
      [
        ...testProfileHeader('abc123'),
        ...TEST_PROFILE_UNBINDALL,
        // Catalog order (ALL_CVARS index), not alphabetical: sensitivity, then cl_run, then
        // crosshair - alphabetical would be cl_run/crosshair/sensitivity, a different order,
        // so this also pins that the sort key really is the catalog, not the key string. Since
        // story 048 D2 the three stored values sit among every *other* catalogue cvar too, each
        // at its default - the file states the whole configuration, not just the deviations.
        ...cvarBlock({ sensitivity: '3', cl_run: '0', crosshair: '0' }),
        '',
        // Story 040 D3: this profile has no actions at all, so no bind here has an owning entry
        // and every one of them lands in the "other binds" section - written, not dropped, and
        // sorted by normalized key (uppercase key names before the single-character `c`). No
        // trailing comment: the file has no display name for a bind nothing in the profile owns.
        '// --- Other binds -------------------------------------------------------------',
        'bind SHIFT   "+speed"',
        'bind UPARROW "+forward"',
        'bind c       "+movedown"',
        '',
      ].join('\n'),
    )
  })

  /**
   * Story 048 D2's headline acceptance: an empty `cvars` map still renders the complete catalogue,
   * every cvar at its own `def.default`, in the existing grouped and name-aligned layout. This is
   * what makes `exec`ing the file idempotent - whatever `config.cfg`, `autoexec.cfg`, another
   * profile or a mod set before it is written back to the intended value.
   */
  it('writes every catalogue cvar at its default for a profile with an empty cvars map', () => {
    const p = profile({ id: 'empty-id', cvars: {}, binds: {} })

    expect(renderProfileFile(p)).toBe(
      [...testProfileHeader('empty-id'), ...TEST_PROFILE_UNBINDALL, ...cvarBlock(), ''].join('\n'),
    )
  })

  /**
   * Story 040 D4's own acceptance: a profile with no stored `writeUnbindall` behaves exactly as
   * `true`. Same output as an explicit `writeUnbindall: true` and different from `false` - the
   * three cases the setting has to distinguish.
   */
  it('writes unbindall by default when writeUnbindall is unset', () => {
    const p = profile({ id: 'unbindall-default', cvars: {}, binds: {} })
    expect(p.writeUnbindall).toBeUndefined()

    expect(renderProfileFile(p)).toBe(renderProfileFile({ ...p, writeUnbindall: true }))
  })

  it('writes a single unbindall line directly after the header when writeUnbindall is true', () => {
    const p = profile({ id: 'unbindall-on', cvars: {}, binds: {}, writeUnbindall: true })

    expect(renderProfileFile(p)).toBe(
      [...testProfileHeader('unbindall-on'), ...TEST_PROFILE_UNBINDALL, ...cvarBlock(), ''].join(
        '\n',
      ),
    )
  })

  it('writes no unbindall line at all when writeUnbindall is false', () => {
    const p = profile({ id: 'unbindall-off', cvars: {}, binds: {}, writeUnbindall: false })

    expect(renderProfileFile(p)).toBe(
      [...testProfileHeader('unbindall-off'), ...cvarBlock(), ''].join('\n'),
    )
  })

  it('round-trips high-ASCII values through latin1 byte-for-byte', () => {
    const p = profile({
      id: 'hi-ascii',
      cvars: { name: 'Bjørn' },
      binds: {},
    })

    const rendered = renderProfileFile(p)
    const roundTripped = latin1RoundTrip(rendered)

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

  /** Story 011: a layer with real overrides but no trigger key assigned. */
  const noTriggerLayer: AltLayer = {
    id: 'layer-no-trigger',
    name: 'NoTrigger',
    mode: 'hold',
    triggerKey: null,
    overrides: { '1': 'drop rl' },
  }

  it('emits every layer alias, verbatim, in its own layer section, in array + generation order', () => {
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

    // Content: every generated alias, unchanged and in generation order, layer by layer in
    // `profile.layers` order - asserted against the generator's own output, not a literal.
    const expectedAliasLines = [
      ...holdResult.aliases.map((a) => a.line),
      ...toggleResult.aliases.map((a) => a.line),
    ]
    expect(lines.filter((line) => line.startsWith('alias ')).map(unformat)).toEqual(
      expectedAliasLines,
    )

    // Layout (story 040 D3): one section per layer, banner naming the layer, its mode and its
    // trigger key; the layer's aliases and its trigger bind inside it; the whole block *after*
    // the bind sections, so a trigger always wins its key. Pinned verbatim, padding and comments
    // included.
    const firstLayerBannerIndex = lines.findIndex((line) => line.startsWith('// --- Layer: Drops '))
    const otherBindsIndex = lines.findIndex((line) => line.startsWith('// --- Other binds '))

    expect(otherBindsIndex).toBeGreaterThanOrEqual(0)
    expect(firstLayerBannerIndex).toBeGreaterThan(otherBindsIndex)
    // Story 042 D2: the banner carries the layer's own ref, mode and trigger key - the fields
    // that let a reader put these lines back into the right layer. `trigger` is present here
    // because both layers have one; the trigger-less layer's own case below pins its absence. The
    // banner's `-` fill is gone on both: the title plus its tag already fills the 80-char width,
    // and no line this writer emits ends in whitespace with nothing after it.
    expect(lines.slice(firstLayerBannerIndex)).toEqual([
      '// --- Layer: Drops (hold, on ALT) [q2l layer=layer-drops mode=hold trigger=ALT]',
      'alias +drops "bind 1 drop rl; bind 2 drop rg"  // Drops',
      'alias -drops "unbind 1; unbind 2"              // Drops',
      'bind ALT     +drops                            // Drops',
      '',
      '// --- Layer: Zoom (toggle, on v) [q2l layer=layer-zoom mode=toggle trigger=v] -',
      'alias zoom_on  "bind MOUSE2 zoom_toggle_cmd; alias zoom zoom_off"  // Zoom',
      'alias zoom_off "unbind MOUSE2; alias zoom zoom_on"                 // Zoom',
      'alias zoom     zoom_on                                             // Zoom',
      'bind v         zoom                                                // Zoom',
      '',
    ])
  })

  it('puts each layer trigger bind inside its own layer section, in profile layer order', () => {
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
    const triggerLine = (result: typeof holdResult): string =>
      `bind ${result.triggerBind!.key} ${result.triggerBind!.command}`

    // Both trigger binds are written, in layer array order, each one the last line of its own
    // layer's section - and the layer sections themselves come after every bind section, so a
    // trigger bind is always the last write to its key (`buildLayerSections`' doc comment).
    expect(lines.filter((line) => line.startsWith('bind ')).map(unformat)).toEqual([
      // The base bind, in the "other binds" section, before both layer sections.
      'bind UPARROW "+forward"',
      triggerLine(holdResult),
      triggerLine(toggleResult),
    ])

    const holdBannerIndex = lines.findIndex((line) => line.startsWith('// --- Layer: Drops '))
    const zoomBannerIndex = lines.findIndex((line) => line.startsWith('// --- Layer: Zoom '))
    const holdTriggerIndex = lines.findIndex((line) => unformat(line) === triggerLine(holdResult))

    expect(holdBannerIndex).toBeLessThan(holdTriggerIndex)
    expect(holdTriggerIndex).toBeLessThan(zoomBannerIndex)
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
    const codeLines = rendered.split('\n').map(unformat)

    expect(codeLines).not.toContain(
      `bind ${emptyResult.triggerBind!.key} ${emptyResult.triggerBind!.command}`,
    )
    expect(codeLines).toContain(
      `bind ${holdResult.triggerBind!.key} ${holdResult.triggerBind!.command}`,
    )
    // An empty layer contributes no lines at all, so it must not leave a banner over nothing
    // either (story 040: "an empty section is omitted").
    expect(rendered).not.toContain('// --- Layer: Empty ')
  })

  it('renders a layer with overrides but no trigger key: aliases are emitted, no bind line is', () => {
    const binds = {}
    const p = profile({
      id: 'layers-id',
      cvars: {},
      binds,
      layers: [noTriggerLayer, holdLayer],
    })

    const noTriggerResult = generateLayerAliases(noTriggerLayer, binds)
    const holdResult = generateLayerAliases(holdLayer, binds)

    expect(noTriggerResult.aliases.length).toBeGreaterThan(0)
    expect(noTriggerResult.triggerBind).toBeNull()

    const rendered = renderProfileFile(p)
    const codeLines = rendered.split('\n').map(unformat)

    for (const alias of noTriggerResult.aliases) {
      expect(codeLines).toContain(alias.line)
    }
    // The banner says so out loud rather than showing an empty pair of parentheses - and its tag
    // (story 042 D2) omits `trigger` entirely rather than emitting it empty, so "no trigger" reads
    // back as an absent field and not as a layer triggered by a key named "".
    const noTriggerBanner = rendered
      .split('\n')
      .find((line) => line.startsWith('// --- Layer: NoTrigger '))
    expect(noTriggerBanner).toBe(
      '// --- Layer: NoTrigger (hold, no trigger key) [q2l layer=layer-no-trigger mode=hold]',
    )
    expect(noTriggerBanner).not.toContain('trigger=')

    // The only "bind " line in the whole file is the other layer's trigger
    // bind - the trigger-less layer contributes none, not even a malformed one.
    const bindLines = rendered.split('\n').filter((line) => line.startsWith('bind '))
    expect(bindLines.map(unformat)).toEqual([
      `bind ${holdResult.triggerBind!.key} ${holdResult.triggerBind!.command}`,
    ])
  })

  it('never emits a bind line with an empty key for a trigger-less layer', () => {
    const binds = { UPARROW: '+forward' }
    const p = profile({
      id: 'layers-id',
      cvars: {},
      binds,
      layers: [noTriggerLayer, holdLayer, toggleLayer],
    })

    const rendered = renderProfileFile(p)

    // A `bind` line with no key would show up as two consecutive spaces
    // (`bind  <command>`) - that must never happen, trigger-less layer or not.
    expect(rendered).not.toMatch(/^bind {2}/m)
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

    expect(renderLoaderFile(p, 'My-Config.cfg')).toBe(
      [
        '// q2-launcher profile abc123 - hand-edited changes are read back',
        'exec My-Config.cfg',
        '',
      ].join('\n'),
    )
  })

  it('places the switch-bind chain after the exec line when given a usable chain input', () => {
    const p = profile({ id: 'abc123' })
    const switchBind: SwitchBindChainInput = {
      key: 'F9',
      defaultProfileId: 'abc123',
      profiles: [
        { id: 'abc123', name: 'Main', fileName: 'Main.cfg' },
        { id: 'def456', name: 'Alt', fileName: 'Alt.cfg' },
      ],
    }

    const rendered = renderLoaderFile(p, 'Main.cfg', switchBind)
    const lines = rendered.split('\n')
    const chainLines = renderSwitchBindChain(switchBind).split('\n')

    expect(lines).toEqual([
      '// q2-launcher profile abc123 - hand-edited changes are read back',
      'exec Main.cfg',
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
      profiles: [{ id: 'abc123', name: 'Main', fileName: 'Main.cfg' }],
    }

    expect(renderLoaderFile(p, 'Main.cfg', switchBind)).toBe(renderLoaderFile(p, 'Main.cfg'))
  })

  it('round-trips latin1 byte-for-byte with a high-ASCII profile name in the chain', () => {
    const p = profile({ id: 'abc123' })
    const switchBind: SwitchBindChainInput = {
      key: 'F9',
      defaultProfileId: 'abc123',
      profiles: [
        { id: 'abc123', name: 'Bjørn', fileName: 'Bjorn.cfg' },
        { id: 'def456', name: 'Alt', fileName: 'Alt.cfg' },
      ],
    }

    const rendered = renderLoaderFile(p, 'Bjorn.cfg', switchBind)
    const roundTripped = latin1RoundTrip(rendered)

    expect(roundTripped).toBe(rendered)
  })
})

describe('profileFileName', () => {
  it('produces q2l-profile-<id>.cfg', () => {
    expect(profileFileName('abc123')).toBe('q2l-profile-abc123.cfg')
  })
})

describe('sentinelLine', () => {
  it('produces the exact sentinel format', () => {
    expect(sentinelLine('abc123')).toBe(
      '// q2-launcher profile abc123 - hand-edited changes are read back',
    )
  })

  it('is prefixed by OWNERSHIP_MARKER', () => {
    expect(sentinelLine('abc123').startsWith(OWNERSHIP_MARKER)).toBe(true)
  })
})
