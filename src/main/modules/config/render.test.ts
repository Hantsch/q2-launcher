import { describe, expect, it } from 'vitest'
import type { ConfigAction, ConfigProfile } from '@shared/modules/config'
import type { AltLayer } from '@shared/config/alt-layers'
import { generateLayerAliases } from '@shared/config/alt-layers'
import { aliasNameFor, renderActionAliasLines } from '@shared/config/alias-render'
import { effectiveSize } from '@shared/config/engine-limits'
import type { SwitchBindChainInput } from './switch-bind'
import { renderSwitchBindChain } from './switch-bind'
import {
  OWNERSHIP_MARKER,
  STRICTEST_LINE_BUDGET,
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
    kind: 'bind',
    commands: [{ kind: 'raw', text: 'drop rl' }],
    ...overrides,
  }
}

/**
 * The header block story 040 D2 now emits unconditionally, for the default `profile()` name
 * ("Test") - every exact-match test in this file that predates D2 has to grow this block, since it
 * appears even for a profile with no cvars/binds at all. Built once here (rather than hand-counted
 * inline) so the fill width can't silently drift between the tests that need it; still a literal,
 * not a call into `render.ts`'s own `banner()` - the point is to pin the real output, not to test
 * the implementation against itself.
 */
const TEST_PROFILE_HEADER = [
  '// =============================================================================',
  '//  Test',
  '//  Q2 Launcher - do not hand-edit while the launcher has the profile open',
  '// =============================================================================',
]

/**
 * Story 040 D4: `writeUnbindall` defaults to on, so `default `profile()`'s missing value renders
 * this line unconditionally too - same rebaselining reason `TEST_PROFILE_HEADER` documents for D2,
 * one line down from it since it is its own block (blank-line separated by `joinBlocks`).
 */
const TEST_PROFILE_UNBINDALL = ['', 'unbindall']

/**
 * One rendered bind/alias line stripped back to the bare command it was before story 040 D3
 * aligned it and hung a `// <label>` off it: the trailing comment removed, and the multi-space
 * column padding collapsed back to the single space the old flat dump used.
 *
 * Exists so the assertions that are about *content* (this alias line, in this order, with this
 * body - the thing that actually executes) can keep being written against `generateLayerAliases`'
 * and `renderActionAlias`' own output instead of against a hand-copied literal that happens to
 * carry today's column widths. The assertions that are about the *layout* pin the padded lines
 * verbatim instead; both kinds appear below, deliberately.
 *
 * Safe as a whitespace collapse for exactly these lines: every generated body has been through
 * `sanitizeCommand`, which collapses runs of whitespace, so no two-space run inside a body can be
 * destroyed by this.
 */
function unformat(line: string): string {
  return line.replace(/\s{2,}\/\/ .*$/, '').replace(/\s{2,}/g, ' ')
}

describe('renderProfileFile', () => {
  it('renders the sentinel line, the header block, then cvars grouped by catalog order, then the unowned binds', () => {
    const p = profile({
      id: 'abc123',
      cvars: { sensitivity: '3', cl_run: '0', crosshair: '0' },
      binds: { UPARROW: '+forward', c: '+movedown', SHIFT: '+speed' },
    })

    expect(renderProfileFile(p)).toBe(
      [
        '// q2-launcher profile abc123 - generated, do not edit',
        ...TEST_PROFILE_HEADER,
        ...TEST_PROFILE_UNBINDALL,
        '',
        '// --- Player ------------------------------------------------------------------',
        // Catalog order (ALL_CVARS index), not alphabetical: sensitivity, then cl_run, then
        // crosshair - alphabetical would be cl_run/crosshair/sensitivity, a different order,
        // so this also pins that the sort key really is the catalog, not the key string.
        'set sensitivity "3"',
        'set cl_run      "0"',
        'set crosshair   "0"',
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

  it('emits the sentinel line and the header block for an empty profile, with no cvar section at all', () => {
    const p = profile({ id: 'empty-id', cvars: {}, binds: {} })

    expect(renderProfileFile(p)).toBe(
      [
        '// q2-launcher profile empty-id - generated, do not edit',
        ...TEST_PROFILE_HEADER,
        ...TEST_PROFILE_UNBINDALL,
        '',
      ].join('\n'),
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

    expect(renderProfileFile(p)).toBe(
      renderProfileFile({ ...p, writeUnbindall: true }),
    )
  })

  it('writes a single unbindall line directly after the header when writeUnbindall is true', () => {
    const p = profile({ id: 'unbindall-on', cvars: {}, binds: {}, writeUnbindall: true })

    expect(renderProfileFile(p)).toBe(
      [
        '// q2-launcher profile unbindall-on - generated, do not edit',
        ...TEST_PROFILE_HEADER,
        ...TEST_PROFILE_UNBINDALL,
        '',
      ].join('\n'),
    )
  })

  it('writes no unbindall line at all when writeUnbindall is false', () => {
    const p = profile({ id: 'unbindall-off', cvars: {}, binds: {}, writeUnbindall: false })

    expect(renderProfileFile(p)).toBe(
      ['// q2-launcher profile unbindall-off - generated, do not edit', ...TEST_PROFILE_HEADER, ''].join(
        '\n',
      ),
    )
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
    expect(lines.slice(firstLayerBannerIndex)).toEqual([
      '// --- Layer: Drops (hold, on ALT) ---------------------------------------------',
      'alias +drops "bind 1 drop rl; bind 2 drop rg"  // Drops',
      'alias -drops "unbind 1; unbind 2"              // Drops',
      'bind ALT     +drops                            // Drops',
      '',
      '// --- Layer: Zoom (toggle, on v) ----------------------------------------------',
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
    // The banner says so out loud rather than showing an empty pair of parentheses.
    expect(rendered).toContain('// --- Layer: NoTrigger (hold, no trigger key) ')

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
      ['// q2-launcher profile abc123 - generated, do not edit', 'exec My-Config.cfg', ''].join('\n'),
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
      '// q2-launcher profile abc123 - generated, do not edit',
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

  /**
   * Story 040 D3 reversed the two alias blocks: an action's aliases now sit in their category's
   * own section *before* the layer sections. The bind sections sit between them, because a layer
   * section ends in that layer's trigger bind and has to be the last thing in the file that can
   * `bind` a key (`buildLayerSections`). Order between alias *definitions* is free - Quake 2
   * resolves an alias body when it runs, not when it is defined - so that half is a layout change;
   * the bind-vs-trigger half is not, and has its own regression test below.
   */
  it('renders the action alias sections, then the binds, then the layer sections', () => {
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
      // The `x` bind is the mirror `setActions` writes for the keyed action; the bind sections
      // emit it, and the reverse index is what files it under the action's own category.
      binds: { UPARROW: '+forward', x: 'two' },
      layers: [holdLayer],
      actions: [first, second],
    })

    const lines = renderProfileFile(p).split('\n')
    const codeLines = lines.map(unformat)

    const firstActionIndex = codeLines.indexOf('alias one drop rl')
    const secondActionIndex = codeLines.indexOf('alias two wave 2')
    const firstLayerAliasIndex = codeLines.indexOf('alias +drops "bind 1 drop rl; bind 2 drop rg"')
    const lastLayerAliasIndex = codeLines.indexOf('alias -drops "unbind 1; unbind 2"')
    const ownedBindIndex = codeLines.indexOf('bind x "two"')
    const unownedBindIndex = codeLines.indexOf('bind UPARROW "+forward"')

    expect(firstActionIndex).toBeGreaterThanOrEqual(0)
    expect(secondActionIndex).toBe(firstActionIndex + 1)
    expect(ownedBindIndex).toBeGreaterThan(secondActionIndex)
    expect(unownedBindIndex).toBeGreaterThan(ownedBindIndex)
    expect(firstLayerAliasIndex).toBeGreaterThan(unownedBindIndex)
    expect(lastLayerAliasIndex).toBeGreaterThan(firstLayerAliasIndex)

    // Both actions sit in the same (weapons) category, so they share one alias section, and the
    // keyed one's bind is filed under that same category with the entry's name on it.
    expect(lines).toContain(
      '// --- Aliases: Weapons --------------------------------------------------------',
    )
    expect(lines).toContain('alias one drop rl  // One')
    expect(lines).toContain('alias two wave 2   // Two')
    expect(lines).toContain(
      '// --- Binds: Weapons ----------------------------------------------------------',
    )
    expect(lines).toContain('bind x "two"  // Two')
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

    expect(rendered).toContain(`alias greet say ${text}`)
    expect(Buffer.from(rendered, 'latin1').toString('latin1')).toBe(rendered)
  })

  it('is deterministic across repeated calls on the same profile', () => {
    const p = profile({
      id: 'actions-id',
      actions: [action({ name: 'One', id: 'aaaa0000' }), action({ name: 'Two', id: 'bbbb1111' })],
    })

    expect(renderProfileFile(p)).toBe(renderProfileFile(p))
  })

  /**
   * Story 038: an action whose bind mirror does not go through its alias, and
   * whose alias name nothing else in the profile calls, gets no alias line -
   * `alias q2l_a_attack_3137 +attack` next to `bind MOUSE1 "+attack"` is a
   * line that does nothing.
   *
   * Every "kept" case below is a silent-unbind risk, not a tidiness one:
   * dropping a line something still calls turns a live key dead in a saved
   * profile. They are grouped by *where* the reference comes from, one per
   * source, because that is the axis the guard can be wrong on.
   */
  describe('story 038: no alias line for a directly bindable action', () => {
    /**
     * A continuous catalogue row (story 034): `bindValueFor` mirrors it as its
     * own `+command`, so its alias is defined and - unless something else in
     * the profile names it - called by nobody.
     */
    function catalogueRow(overrides: Partial<ConfigAction>): ConfigAction {
      return action({
        categoryId: 'movement',
        kind: 'bind',
        commands: [{ kind: 'raw', text: '+forward' }],
        ...overrides,
      })
    }

    const forwardRow = catalogueRow({
      id: 'f0f0',
      name: 'Forward',
      catalogId: 'movement:forward',
      key: 'w',
      commands: [{ kind: 'raw', text: '+forward' }],
    })
    const attackRow = catalogueRow({
      id: 'a1a1',
      name: 'Attack',
      catalogId: 'attack:primary',
      key: 'MOUSE1',
      commands: [{ kind: 'raw', text: '+attack' }],
    })
    const forwardAlias = aliasNameFor(forwardRow)
    const attackAlias = aliasNameFor(attackRow)

    it('emits no alias line for a catalogue row, and leaves its bind line exactly as it was', () => {
      const p = profile({
        id: 'dead-alias',
        // What `applyActionBindMirror` writes for a continuous row since story
        // 034: the command itself, never the alias name.
        binds: { MOUSE1: '+attack', w: '+forward' },
        actions: [forwardRow, attackRow],
      })

      expect(renderProfileFile(p)).toBe(
        [
          '// q2-launcher profile dead-alias - generated, do not edit',
          ...TEST_PROFILE_HEADER,
          ...TEST_PROFILE_UNBINDALL,
          '',
          // Both binds are owned (each row's `bindValueFor` is the bare command sitting on the
          // key that row holds), so they are filed under the owning action's category and
          // ordered by that action's index in `profile.actions` - `w` before `MOUSE1`, which is
          // neither alphabetical nor insertion order.
          '// --- Binds: Movement ---------------------------------------------------------',
          'bind w      "+forward"  // Forward',
          'bind MOUSE1 "+attack"   // Attack',
          '',
        ].join('\n'),
      )
    })

    it('changes no bind in the file: every bind line survives an action list that produces no aliases', () => {
      // AC5 in miniature - the dead alias lines go, and no bind line is added, removed or
      // reworded. Since story 040 D3 the action list *does* legitimately change a bind's
      // section and its trailing comment (that is the whole point of the reverse index), so the
      // comparison is over the bind commands themselves rather than over the whole file.
      const base = {
        id: 'unchanged',
        cvars: { sensitivity: '3', cl_run: '0' },
        binds: { MOUSE1: '+attack', UPARROW: '+forward', w: '+forward' },
        layers: [holdLayer],
      }
      const bindCommands = (text: string): string[] =>
        text
          .split('\n')
          .filter((line) => line.startsWith('bind '))
          .map(unformat)
          .sort()

      const withActions = renderProfileFile(profile({ ...base, actions: [forwardRow, attackRow] }))
      const withoutActions = renderProfileFile(profile(base))

      expect(withActions).not.toContain(`alias ${forwardAlias}`)
      expect(withActions).not.toContain(`alias ${attackAlias}`)
      expect(bindCommands(withActions)).toEqual(bindCommands(withoutActions))
      // The cvar block above them is untouched by the action list either way.
      expect(withActions.split('\n').filter((line) => line.startsWith('set '))).toEqual(
        withoutActions.split('\n').filter((line) => line.startsWith('set ')),
      )
    })

    it('keeps the alias line when a base bind still points at it (a pre-story-034 mirror)', () => {
      // A profile saved before story 034 has the alias name in `binds`, not the
      // bare command. Dropping the alias there would leave `bind w
      // "q2l_a_forward_f0f0"` calling nothing - the key goes dead.
      const p = profile({
        id: 'legacy-mirror',
        binds: { w: forwardAlias },
        actions: [forwardRow],
      })

      const rendered = renderProfileFile(p)

      expect(rendered).toContain(`alias ${forwardAlias} +forward`)
      expect(rendered).toContain(`bind w "${forwardAlias}"`)
    })

    it('keeps the alias line when a layer override points at it (a pre-story-034 modifier mirror)', () => {
      // Same legacy shape on the layer side: `applyActionLayerMirror` used to
      // write `aliasNameFor` into a modifier layer's overrides. The action
      // carries no base bind at all here (a modified slot belongs to the
      // layer), so the override is the *only* reference in the profile.
      const alt: AltLayer = {
        id: 'layer-alt',
        name: 'Alt',
        mode: 'hold',
        triggerKey: 'ALT',
        overrides: { r: forwardAlias },
      }
      const modified = { ...forwardRow, key: 'r', keyModifier: 'ALT' as const }
      const p = profile({ id: 'modifier-mirror', layers: [alt], actions: [modified] })

      const rendered = renderProfileFile(p)

      expect(rendered).toContain(`alias ${forwardAlias} +forward`)
      // Unquoted: the generated body is a single command with no `;` in it.
      expect(rendered).toContain(`alias +alt bind r ${forwardAlias}`)
    })

    it('keeps the alias line when another action`s command calls it', () => {
      const caller = action({
        id: 'cccc3333',
        name: 'Combo',
        commands: [{ kind: 'raw', text: `wait; ${forwardAlias}` }],
      })
      const p = profile({ id: 'called-by-action', actions: [forwardRow, caller] })

      const rendered = renderProfileFile(p)

      expect(rendered).toContain(`alias ${forwardAlias} +forward`)
      expect(rendered).toContain(`alias ${aliasNameFor(caller)} "wait; ${forwardAlias}"`)
    })

    it('keeps the alias line when a hold layer`s generated body calls it', () => {
      // The layer's own alias body is generated, not stored: an override whose
      // value chains two commands is hoisted into `alias <base>_c1 "<chain>"`,
      // and *that* line is what names the two aliases. A scan comparing whole
      // override values against alias names would miss both.
      const drops: AltLayer = {
        id: 'layer-chain',
        name: 'Drops',
        mode: 'hold',
        triggerKey: 'ALT',
        overrides: { '1': `${forwardAlias}; ${attackAlias}` },
      }
      const p = profile({
        id: 'generated-body',
        layers: [drops],
        actions: [forwardRow, attackRow],
      })

      const codeLines = renderProfileFile(p).split('\n').map(unformat)

      expect(codeLines).toContain(`alias drops_c1 "${forwardAlias}; ${attackAlias}"`)
      expect(codeLines).toContain(`alias ${forwardAlias} +forward`)
      expect(codeLines).toContain(`alias ${attackAlias} +attack`)
    })

    it('keeps an unreferenced kind: alias entry (AC6 - that is Care`s business, not the writer`s)', () => {
      const aliasEntry = action({
        id: 'aliasent',
        name: '+test',
        kind: 'alias',
        commands: [{ kind: 'raw', text: '+attack' }],
      })
      const p = profile({ id: 'alias-entry', actions: [aliasEntry] })

      expect(renderProfileFile(p)).toContain('alias +test +attack')
    })

    it('keeps a keyless, unreferenced user-authored action (User decision)', () => {
      const freeform = action({
        id: 'ffff4444',
        name: 'My combo',
        commands: [{ kind: 'raw', text: 'wait' }, { kind: 'raw', text: '+attack' }],
      })
      const p = profile({ id: 'keyless', actions: [freeform] })

      expect(renderProfileFile(p)).toContain(`alias ${aliasNameFor(freeform)} "wait; +attack"`)
    })

    it('drops a chunk-split action whole: neither the parent nor any _p<n> line', () => {
      // The only shape that is both dropped and split: `bindValueFor` returns
      // the bare command for a *single*-command catalogue row, so a multi-command
      // action can never be dropped - but that one command can still be too long
      // for a line, which is what splits it.
      const huge = catalogueRow({
        id: 'hhhh5555',
        name: 'Huge',
        catalogId: 'movement:forward',
        key: 'w',
        commands: [{ kind: 'raw', text: `+forward ${'z'.repeat(2000)}` }],
      })
      const p = profile({
        id: 'chunked-drop',
        binds: { w: `+forward ${'z'.repeat(2000)}` },
        actions: [huge],
      })

      const rendered = renderProfileFile(p)
      const aliasName = aliasNameFor(huge)

      // Split when rendered on its own - so this asserts the family is gone,
      // not that there was never a family to emit.
      expect(renderActionAliasLines([huge])).toHaveLength(2)
      expect(rendered).not.toContain(`alias ${aliasName}`)
      expect(rendered).not.toContain(`${aliasName}_p1`)
    })

    it('is deterministic across repeated calls on a profile that mixes dropped and kept actions', () => {
      const p = profile({
        id: 'mixed',
        cvars: { sensitivity: '3' },
        binds: { MOUSE1: '+attack', q: aliasNameFor(action({ id: 'qqqq6666', name: 'SSG SG' })) },
        layers: [holdLayer],
        actions: [
          forwardRow,
          attackRow,
          action({ id: 'qqqq6666', name: 'SSG SG', key: 'q' }),
          action({ id: 'aliasent', name: '+test', kind: 'alias' }),
        ],
      })

      expect(renderProfileFile(p)).toBe(renderProfileFile(p))
    })
  })

  describe('story 015: dual-bound actions', () => {
    it('renders a drop row with both keys set as two bind lines to the same alias, and one alias definition', () => {
      // Shaped like a materialised drop-catalogue row (decision 6): item, ammo,
      // then the team message. `profile.binds` is hand-built here to mirror
      // exactly what `setActions` (D1, tested in `profiles.test.ts`) writes for
      // a two-key action - both `key` and `secondaryKey` point at the same
      // generated alias name - matching this file's existing pattern of
      // hand-constructing the bind mirror rather than re-testing `setActions`.
      const dropRow = action({
        name: 'Rocket Launcher',
        id: 'ab12cd34',
        categoryId: 'drops',
        catalogId: 'dropWeapon:rlauncher',
        key: 'r',
        secondaryKey: 'PGUP',
        commands: [
          { kind: 'raw', text: 'drop rocket launcher' },
          { kind: 'raw', text: 'drop rockets' },
          { kind: 'message', channel: 'say_team', text: 'need ammo' },
        ],
      })
      const aliasName = aliasNameFor(dropRow)
      const p = profile({
        id: 'dual-bind-id',
        binds: { r: aliasName, PGUP: aliasName },
        actions: [dropRow],
      })

      const rendered = renderProfileFile(p)
      const lines = rendered.split('\n')
      const bindLines = lines.filter((line) => line.startsWith('bind '))
      const aliasLines = lines.filter((line) => line.startsWith('alias '))

      // Both slots of one action, so both binds land in that action's category section, ordered
      // by key within it, and both carry the same entry name as their trailing comment.
      expect(bindLines.map(unformat)).toEqual([
        `bind PGUP "${aliasName}"`,
        `bind r "${aliasName}"`,
      ])
      expect(bindLines.every((line) => line.endsWith('  // Rocket Launcher'))).toBe(true)
      expect(aliasLines.map(unformat)).toEqual([
        `alias ${aliasName} "drop rocket launcher; drop rockets; say_team need ammo"`,
      ])
      expect(aliasLines[0]!.endsWith('  // Rocket Launcher')).toBe(true)
    })

    it('renders a movement row with only a Primary key as exactly one bind line', () => {
      const movementRow = action({
        name: 'Jump',
        id: 'cccc2222',
        categoryId: 'movement',
        catalogId: 'movement:jump',
        key: 'SPACE',
        commands: [{ kind: 'raw', text: '+moveup' }],
      })
      const aliasName = aliasNameFor(movementRow)
      const p = profile({
        id: 'single-bind-id',
        binds: { SPACE: aliasName },
        actions: [movementRow],
      })

      const rendered = renderProfileFile(p)
      const bindLines = rendered.split('\n').filter((line) => line.startsWith('bind '))

      expect(bindLines).toEqual([`bind SPACE "${aliasName}"`])
      // No secondaryKey was set, so no second bind to this alias exists anywhere.
      expect(bindLines.filter((line) => line.includes(aliasName))).toHaveLength(1)
    })
  })
})

/**
 * Story 040 D3 - the alias, layer and bind sections themselves.
 *
 * The risky half of this story: it reads the actions -> `binds` mirror *backwards* (a reverse
 * index no helper provided before), and a mistake there is silent on disk - a bind filed under
 * the wrong banner with the wrong name, or, worse, one that stops being written at all. Every
 * block below therefore asserts on the bind *count* or the bind *set* as well as on the layout,
 * so a lost keybinding cannot hide behind a passing formatting assertion.
 */
describe('story 040 D3: alias, layer and bind sections', () => {
  /** Every section banner in a rendered file, in order, with the trailing `-` fill stripped. */
  function banners(rendered: string): string[] {
    return rendered
      .split('\n')
      .filter((line) => line.startsWith('// --- '))
      .map((line) => line.slice('// --- '.length).replace(/\s*-+$/, ''))
  }

  /** Every `bind <key>` key in a rendered file, in file order. */
  function boundKeys(rendered: string): string[] {
    return rendered
      .split('\n')
      .filter((line) => line.startsWith('bind '))
      .map((line) => line.split(/\s+/)[1]!)
  }

  describe('grouping and order', () => {
    const categories = [
      { id: 'cat-bravo', name: 'Bravo' },
      { id: 'cat-alpha', name: 'Alpha' },
    ]

    /** One entry per section a category can produce, plus one whose category the profile no
     * longer has - built so both the alias and the bind side of each category is exercised. */
    const entries: ConfigAction[] = [
      action({ id: 'e-move', name: 'Strafe left', categoryId: 'movement', key: 'a', aliasName: 'strafe_l', commands: [{ kind: 'raw', text: 'wait' }, { kind: 'raw', text: '+moveleft' }] }),
      action({ id: 'e-weap', name: 'SSG + SG', categoryId: 'weapons', key: 'q', aliasName: 'ssg_sg', commands: [{ kind: 'raw', text: 'use super shotgun' }, { kind: 'raw', text: 'use shotgun' }] }),
      action({ id: 'e-drop', name: 'Drop RL', categoryId: 'drops', key: 'r', aliasName: 'drop_rl', commands: [{ kind: 'raw', text: 'drop rocket launcher' }, { kind: 'raw', text: 'say_team dropped rl' }] }),
      action({ id: 'e-bravo', name: 'Bravo entry', categoryId: 'cat-bravo', key: 'b', aliasName: 'bravo_e', commands: [{ kind: 'raw', text: 'wave 1' }, { kind: 'raw', text: 'wait' }] }),
      action({ id: 'e-alpha', name: 'Alpha entry', categoryId: 'cat-alpha', key: 'z', aliasName: 'alpha_e', commands: [{ kind: 'raw', text: 'wave 2' }, { kind: 'raw', text: 'wait' }] }),
      action({ id: 'e-gone', name: 'Orphan entry', categoryId: 'deleted-category', key: 'o', aliasName: 'orphan_e', commands: [{ kind: 'raw', text: 'wave 3' }, { kind: 'raw', text: 'wait' }] }),
    ]

    const grouped = profile({
      id: 'grouped',
      categories,
      actions: entries,
      binds: {
        // The mirror `setActions` would have written for each entry above, plus one bind the
        // user typed themselves.
        ...Object.fromEntries(entries.map((entry) => [entry.key!, entry.aliasName!])),
        F1: 'say hello',
      },
    })

    it('orders alias and bind sections by category: built-ins, then profile.categories array order, then other', () => {
      // `profile.categories` is deliberately stored Bravo-before-Alpha, so a section order of
      // Alpha-before-Bravo would prove the code sorted by name instead of following the array.
      // (This profile has no layers; the layer sections' own placement - last, after "Other
      // binds" - is pinned by the tests in the layers block above.)
      expect(banners(renderProfileFile(grouped))).toEqual([
        'Aliases: Movement',
        'Aliases: Weapons',
        'Aliases: Weapon dropping',
        'Aliases: Bravo',
        'Aliases: Alpha',
        'Aliases: Other',
        'Binds: Movement',
        'Binds: Weapons',
        'Binds: Weapon dropping',
        'Binds: Bravo',
        'Binds: Alpha',
        'Binds: Other',
        'Other binds',
      ])
    })

    it('writes every bind exactly once and gives every generated bind and alias a trailing label', () => {
      const rendered = renderProfileFile(grouped)
      const lines = rendered.split('\n')

      // Nothing lost, nothing duplicated: the file's bind lines are exactly the profile's keys.
      expect(boundKeys(rendered).sort()).toEqual(Object.keys(grouped.binds).sort())

      for (const entry of entries) {
        // Every category here holds exactly one entry, so no column padding is in play and the
        // bind line can be pinned byte-for-byte, comment included.
        expect(lines).toContain(`bind ${entry.key} "${entry.aliasName}"  // ${entry.name}`)
        expect(
          lines.some(
            (line) =>
              line.startsWith(`alias ${entry.aliasName} `) && line.endsWith(`  // ${entry.name}`),
          ),
        ).toBe(true)
      }

      // The one bind no entry owns: written, in the "other binds" section, with no comment -
      // the file has no display name for a line the user typed.
      expect(lines).toContain('bind F1 "say hello"')
    })

    it('orders the binds inside a category section by the owning action index, and the unowned ones by key', () => {
      const twoSlots = action({
        id: 'e-two-slots',
        name: 'Two slots',
        categoryId: 'movement',
        key: 'k',
        secondaryKey: 'HOME',
        aliasName: 'two_slots',
        commands: [{ kind: 'raw', text: 'wave 1' }, { kind: 'raw', text: 'wait' }],
      })
      const first = action({
        id: 'e-first',
        name: 'First',
        categoryId: 'movement',
        key: 'zzz_last_key',
        aliasName: 'first_e',
        commands: [{ kind: 'raw', text: 'wave 2' }, { kind: 'raw', text: 'wait' }],
      })
      const p = profile({
        id: 'ordering',
        // `first` sits *before* `twoSlots` in the array but holds the alphabetically last key,
        // so an alphabetical sort would put it second.
        actions: [first, twoSlots],
        binds: {
          zzz_last_key: 'first_e',
          k: 'two_slots',
          HOME: 'two_slots',
          b: 'hand typed b',
          A: 'hand typed A',
        },
      })

      const rendered = renderProfileFile(p)

      expect(boundKeys(rendered)).toEqual([
        // Owned, by action index; the two slots of one action then by key among themselves.
        'zzz_last_key',
        'HOME',
        'k',
        // Unowned, by normalized key.
        'A',
        'b',
      ])
    })
  })

  describe('the reverse index (bind value -> owning action)', () => {
    const ssgSg = action({
      id: 'own-1',
      name: 'SSG + SG',
      categoryId: 'weapons',
      key: 'q',
      aliasName: 'ssg_sg',
      commands: [{ kind: 'raw', text: 'use super shotgun' }, { kind: 'raw', text: 'use shotgun' }],
    })

    it('does not claim the same value on a key the action does not hold (story 039 key-scoping)', () => {
      // Since story 039 an alias name is a readable word, so a user's own `bind e "ssg_sg"` is
      // byte-for-byte the mirror value - only the key tells the two apart.
      const p = profile({ id: 'key-scoped', actions: [ssgSg], binds: { q: 'ssg_sg', e: 'ssg_sg' } })
      const lines = renderProfileFile(p).split('\n')

      expect(lines).toContain('bind q "ssg_sg"  // SSG + SG')
      expect(lines).toContain('bind e "ssg_sg"')
      expect(lines).not.toContain('bind e "ssg_sg"  // SSG + SG')
      expect(banners(renderProfileFile(p))).toContain('Other binds')
    })

    it('does not claim a key whose value is not the action`s own mirror value', () => {
      const p = profile({ id: 'value-scoped', actions: [ssgSg], binds: { q: 'something else' } })
      const rendered = renderProfileFile(p)

      // The key is right, the value is not - so this is a hand-typed bind on a slot the entry
      // also holds, and it is written unlabelled rather than mislabelled.
      expect(rendered.split('\n')).toContain('bind q "something else"')
      expect(banners(rendered)).not.toContain('Binds: Weapons')
    })

    it('does not claim a plain key for an action whose slot carries a modifier (story 016)', () => {
      // `Alt+R` is mirrored into the ALT layer's overrides, never into `binds`, so a plain `r`
      // in `binds` belongs to whoever typed it - not to this entry.
      const modified = { ...ssgSg, key: 'r', keyModifier: 'ALT' as const }
      const p = profile({ id: 'modified-slot', actions: [modified], binds: { r: 'ssg_sg' } })
      const rendered = renderProfileFile(p)

      expect(rendered.split('\n')).toContain('bind r "ssg_sg"')
      expect(banners(rendered)).not.toContain('Binds: Weapons')
    })

    it('never lets a kind: alias entry own a bind (story 019)', () => {
      const aliasEntry = action({
        id: 'alias-entry',
        name: '+slow',
        kind: 'alias',
        categoryId: 'weapons',
        key: 'g',
        commands: [{ kind: 'raw', text: 'cl_maxfps 30' }],
      })
      const p = profile({ id: 'alias-owner', actions: [aliasEntry], binds: { g: '+slow' } })
      const rendered = renderProfileFile(p)

      expect(rendered.split('\n')).toContain('bind g "+slow"')
      expect(banners(rendered)).toContain('Other binds')
      expect(banners(rendered)).not.toContain('Binds: Weapons')
    })

    it('labels a continuous catalogue row`s direct command mirror (story 034), not just an alias mirror', () => {
      const forward = action({
        id: 'cat-forward',
        name: 'Forward',
        categoryId: 'movement',
        catalogId: 'movement:forward',
        key: 'w',
        commands: [{ kind: 'raw', text: '+forward' }],
      })
      const p = profile({ id: 'direct-mirror', actions: [forward], binds: { w: '+forward' } })

      // `bindValueFor` returns the bare command here, so the reverse index has to match on that
      // and not on the alias name - the catalogue label is what proves it did.
      expect(renderProfileFile(p).split('\n')).toContain('bind w "+forward"  // Forward')
    })
  })

  describe('what is written and what is not', () => {
    it('does not write a bind whose command is empty, and does not mutate profile.binds', () => {
      const binds = { w: '+forward', i: '', j: '   ' }
      const p = profile({ id: 'empty-binds', binds })

      const rendered = renderProfileFile(p)

      expect(boundKeys(rendered)).toEqual(['w'])
      expect(rendered).not.toContain('bind i')
      expect(rendered).not.toContain('bind j')
      // Render-time omission only: the profile still carries both entries afterwards.
      expect(binds).toEqual({ w: '+forward', i: '', j: '   ' })
      expect(p.binds).toBe(binds)
    })

    /**
     * A base bind sitting on a layer's trigger key is a state the app knowingly allows and warns
     * about (`generateLayerAliases`' `layer.triggerConflict`), and the warning's own copy promises
     * which of the two wins: "the layer's trigger binding will take priority".
     *
     * That promise is decided purely by *file order*. A `.cfg` is `exec`d top to bottom and the
     * engine's binding table holds one command per key, so the last `bind` line on a key is the
     * one that survives - both lines run, only the later one is in effect afterwards. So this is
     * not a layout assertion: it is the assertion that the rendered file still means what the
     * Care warning says it means.
     *
     * Asserted as a relative index rather than a whole-file match on purpose - the property is
     * "the trigger comes after", not "the file looks like this".
     */
    it('writes a layer trigger bind after an unowned base bind colliding on the same key', () => {
      const p = profile({
        id: 'trigger-conflict',
        binds: { ALT: '+attack' },
        layers: [
          { id: 'l1', name: 'Drops', mode: 'hold', triggerKey: 'ALT', overrides: { '1': 'drop rl' } },
        ],
      })

      const codeLines = renderProfileFile(p).split('\n').map(unformat)

      // Nothing dropped for tidiness: both lines are in the file...
      expect(codeLines).toContain('bind ALT +drops')
      expect(codeLines).toContain('bind ALT "+attack"')
      // ...and the trigger is the later of the two, so it is the one the engine keeps.
      expect(codeLines.indexOf('bind ALT +drops')).toBeGreaterThan(
        codeLines.indexOf('bind ALT "+attack"'),
      )
    })

    /**
     * The same invariant for the collision that is *not* in the "other binds" section: a base bind
     * owned by an action, which renders in that action's category bind section. Worth its own case
     * because the two kinds of bind are emitted by different code paths and, before the layer
     * sections were moved to the end of the file, an owned bind was written even later than an
     * unowned one - so it was the harder half of the same bug, not a duplicate of the case above.
     */
    it('writes a layer trigger bind after an owned category bind colliding on the same key', () => {
      const attack = action({
        id: 'e-attack',
        name: 'Attack',
        categoryId: 'weapons',
        key: 'ALT',
        aliasName: 'attack_e',
        commands: [{ kind: 'raw', text: 'use blaster' }, { kind: 'raw', text: '+attack' }],
      })
      const p = profile({
        id: 'trigger-conflict-owned',
        actions: [attack],
        binds: { ALT: 'attack_e' },
        layers: [
          { id: 'l1', name: 'Drops', mode: 'hold', triggerKey: 'ALT', overrides: { '1': 'drop rl' } },
        ],
      })

      const rendered = renderProfileFile(p)
      const codeLines = rendered.split('\n').map(unformat)

      // The base bind really did land in its owning category's section, not in "other binds" -
      // otherwise this case would silently be the previous test over again.
      expect(banners(rendered)).toContain('Binds: Weapons')
      expect(codeLines).toContain('bind ALT "attack_e"')
      expect(codeLines).toContain('bind ALT +drops')
      expect(codeLines.indexOf('bind ALT +drops')).toBeGreaterThan(
        codeLines.indexOf('bind ALT "attack_e"'),
      )
    })

    it('emits no banner for a category with nothing in it', () => {
      const p = profile({
        id: 'sparse',
        categories: [{ id: 'cat-empty', name: 'Empty category' }],
        actions: [
          action({ id: 'only', name: 'Only', categoryId: 'weapons', aliasName: 'only_e', commands: [{ kind: 'raw', text: 'wave 1' }, { kind: 'raw', text: 'wait' }] }),
        ],
      })

      expect(banners(renderProfileFile(p))).toEqual(['Aliases: Weapons'])
    })
  })

  describe('budget, encoding and determinism over the whole file', () => {
    /** A profile touching every section kind this deliverable adds. */
    function richProfile(nameSuffix = ''): ConfigProfile {
      const entry = action({
        id: 'rich-1',
        name: `Nahkampf${nameSuffix}`,
        categoryId: 'cat-melee',
        key: 'x',
        aliasName: 'melee_x',
        commands: [{ kind: 'raw', text: 'use blaster' }, { kind: 'raw', text: '+attack' }],
      })
      return profile({
        id: 'rich',
        name: 'Bjørn - Test',
        cvars: { sensitivity: '3', unknown_cvar: 'ÿ' },
        categories: [{ id: 'cat-melee', name: 'Nähkampf' }],
        actions: [entry],
        binds: { x: 'melee_x', F1: 'say Grüße' },
        layers: [
          { id: 'l1', name: 'Drops', mode: 'hold', triggerKey: 'ALT', overrides: { '1': 'drop rl' } },
        ],
      })
    }

    it('round-trips the whole file - banners, labels and all - through latin1 byte-for-byte', () => {
      const rendered = renderProfileFile(richProfile())

      expect(rendered).toContain('Nähkampf')
      expect(Buffer.from(rendered, 'latin1').toString('latin1')).toBe(rendered)
    })

    it('is deterministic across repeated calls on a profile with every section kind', () => {
      expect(renderProfileFile(richProfile())).toBe(renderProfileFile(richProfile()))
    })

    it('keeps every line inside the strictest engine line budget, comments included', () => {
      for (const line of renderProfileFile(richProfile()).split('\n')) {
        expect(line.length).toBeLessThan(STRICTEST_LINE_BUDGET)
      }
    })

    it('truncates a comment that would bust the budget rather than the command', () => {
      const label = 'N'.repeat(200)
      const command = 'x'.repeat(900)
      const p = profile({
        id: 'truncated-comment',
        actions: [
          action({ id: 'long', name: label, categoryId: 'weapons', aliasName: 'long_entry', commands: [{ kind: 'raw', text: command }] }),
        ],
        binds: { k: 'long_entry' },
      })

      const aliasLine = renderProfileFile(p)
        .split('\n')
        .find((line) => line.startsWith('alias long_entry'))!

      expect(aliasLine.length).toBeLessThan(STRICTEST_LINE_BUDGET)
      // The command survives whole; only the label is cut, and it is cut from its own end.
      expect(aliasLine).toContain(command)
      const comment = aliasLine.slice(aliasLine.indexOf('  // ') + '  // '.length)
      expect(comment.length).toBeGreaterThan(0)
      expect(comment.length).toBeLessThan(label.length)
      expect(label.startsWith(comment)).toBe(true)
    })

    it('drops a comment outright when not even one character of it fits, keeping the command intact', () => {
      // A continuous catalogue row mirrors as its own bare command (story 034), which is how a
      // *bind* value gets long enough to leave no room at all for a label.
      const command = `+forward ${'z'.repeat(1005)}`
      const huge = action({
        id: 'huge',
        name: 'Forward',
        categoryId: 'movement',
        catalogId: 'movement:forward',
        key: 'w',
        commands: [{ kind: 'raw', text: command }],
      })
      const p = profile({ id: 'dropped-comment', actions: [huge], binds: { w: command } })

      const bindLine = renderProfileFile(p)
        .split('\n')
        .find((line) => line.startsWith('bind w'))!

      expect(bindLine).toBe(`bind w "${command}"`)
      expect(bindLine).not.toContain('//')
      expect(bindLine.length).toBeLessThan(STRICTEST_LINE_BUDGET)
    })

    /**
     * The named consequence of this deliverable (D3's own acceptance): the trailing comments are
     * real bytes, so the size Care measures grows with them and a large profile can newly cross
     * the engine's exec-buffer warning. That is the intended surface, not a bug - so it is
     * asserted rather than hidden.
     */
    it('counts comment bytes toward the size Care evaluates on r1q2, and not on q2pro', () => {
      const short = renderProfileFile(richProfile())
      const long = renderProfileFile(richProfile(` ${'L'.repeat(60)}`))

      // r1q2 measures the raw file, comments included - so a longer entry name really does cost
      // the user exec-buffer budget.
      expect(effectiveSize(short, 'r1q2')).toBe(short.length)
      expect(effectiveSize(long, 'r1q2')!).toBeGreaterThan(effectiveSize(short, 'r1q2')!)
      // q2pro measures after `COM_Compress`, which strips comments, so it is unaffected.
      expect(effectiveSize(short, 'q2pro')!).toBeLessThan(short.length)
    })

    /**
     * The reverse index keys on `<normalized key><NUL><value>`. Without a separator the two halves
     * run together and `a` + `bc` collides with `ab` + `c` - which would file a hand-typed
     * `bind ab "c"` under the owning action's category with that entry's name on it, the exact
     * silent mis-attribution `buildBindOwnerIndex` exists to avoid. Asserted behaviourally so the
     * separator cannot be dropped (or silently stripped from the source) without a red test.
     */
    it('does not confuse key+value pairs whose concatenation is identical', () => {
      const owner = action({
        id: 'sep-1',
        name: 'Alpha',
        categoryId: 'movement',
        key: 'a',
        aliasName: 'bc',
        commands: [{ kind: 'raw', text: 'use rl' }],
      })
      const lines = renderProfileFile(
        profile({ id: 'separator', actions: [owner], binds: { a: 'bc', ab: 'c' } }),
      ).split('\n')

      expect(lines.some((line) => /^\/\/ --- Other binds -+$/.test(line))).toBe(true)
      expect(lines.find((line) => line.startsWith('bind a '))).toContain('// Alpha')
      // The unowned bind keeps no comment and never lands in the owner's section.
      expect(lines.find((line) => line.startsWith('bind ab '))).toBe('bind ab "c"')
    })

    /**
     * `findCvar` matches case-insensitively, so two spellings of one cvar share a catalog index.
     * The in-section sort has to break that tie on the stored name, or the pair falls back to
     * `Object.keys` insertion order - the one thing AC5 rules out ("never insertion-order-
     * dependent"). Two profiles differing only in how their `cvars` map was built must render
     * identically.
     */
    it('orders two differently-cased spellings of one cvar independently of insertion order', () => {
      const forward = renderProfileFile(profile({ cvars: { sensitivity: '3', Sensitivity: '4' } }))
      const reversed = renderProfileFile(profile({ cvars: { Sensitivity: '4', sensitivity: '3' } }))

      expect(forward).toBe(reversed)
      expect(forward).toContain('set Sensitivity')
      expect(forward).toContain('set sensitivity')
    })

    /**
     * AC7 covers the banner lines too, and `banner()` never truncates by design - so `render.ts`
     * clamps every title it hands over. Unreachable through the IPC schemas (they cap these names
     * at 120 characters), but the persisted schema caps none of them, and a multi-kilobyte comment
     * line in front of the engine's `char line[1024]` cbuf is not a failure mode worth leaving to
     * a validator elsewhere.
     */
    it('keeps a banner line inside the budget even for an absurdly long profile or category name', () => {
      const long = 'x'.repeat(4000)
      const withLongName = renderProfileFile(profile({ name: long }))
      const withLongCategory = renderProfileFile(
        profile({
          categories: [{ id: 'cat-long', name: long }],
          actions: [action({ id: 'long-cat', name: 'E', categoryId: 'cat-long', key: 'z', aliasName: 'e' })],
          binds: { z: 'e' },
        }),
      )

      for (const rendered of [withLongName, withLongCategory]) {
        for (const line of rendered.split('\n')) {
          expect(line.length).toBeLessThan(STRICTEST_LINE_BUDGET)
        }
      }
    })
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
