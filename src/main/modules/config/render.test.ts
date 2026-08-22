import { describe, expect, it } from 'vitest'
import type { ConfigAction, ConfigProfile } from '@shared/modules/config'
import type { AltLayer } from '@shared/config/alt-layers'
import { generateLayerAliases } from '@shared/config/alt-layers'
import { aliasNameFor, renderActionAliasLines } from '@shared/config/alias-render'
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
    kind: 'bind',
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

  /** Story 011: a layer with real overrides but no trigger key assigned. */
  const noTriggerLayer: AltLayer = {
    id: 'layer-no-trigger',
    name: 'NoTrigger',
    mode: 'hold',
    triggerKey: null,
    overrides: { '1': 'drop rl' },
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
      `bind ${holdResult.triggerBind!.key} ${holdResult.triggerBind!.command}`,
      `bind ${toggleResult.triggerBind!.key} ${toggleResult.triggerBind!.command}`,
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

    expect(rendered).not.toContain(
      `bind ${emptyResult.triggerBind!.key} ${emptyResult.triggerBind!.command}`,
    )
    expect(rendered).toContain(`bind ${holdResult.triggerBind!.key} ${holdResult.triggerBind!.command}`)
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

    for (const alias of noTriggerResult.aliases) {
      expect(rendered).toContain(alias.line)
    }

    // The only "bind " line in the whole file is the other layer's trigger
    // bind - the trigger-less layer contributes none, not even a malformed one.
    const bindLines = rendered.split('\n').filter((line) => line.startsWith('bind '))
    expect(bindLines).toEqual([`bind ${holdResult.triggerBind!.key} ${holdResult.triggerBind!.command}`])
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
          'bind MOUSE1 "+attack"',
          'bind w "+forward"',
          '',
        ].join('\n'),
      )
    })

    it('changes nothing else in the file: renders identically to the same profile with no actions at all', () => {
      // AC5 in miniature - the dead lines go, and no other line is added,
      // removed, reordered or reworded. Asserted against the same profile
      // stripped of its actions rather than against a hand-written expectation,
      // so it also covers the cvar/layer/bind blocks around them.
      const base = {
        id: 'unchanged',
        cvars: { sensitivity: '3', cl_run: '0' },
        binds: { MOUSE1: '+attack', UPARROW: '+forward', w: '+forward' },
        layers: [holdLayer],
      }

      expect(renderProfileFile(profile({ ...base, actions: [forwardRow, attackRow] }))).toBe(
        renderProfileFile(profile(base)),
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

      const rendered = renderProfileFile(p)

      expect(rendered).toContain(`alias drops_c1 "${forwardAlias}; ${attackAlias}"`)
      expect(rendered).toContain(`alias ${forwardAlias} +forward`)
      expect(rendered).toContain(`alias ${attackAlias} +attack`)
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

      expect(bindLines.sort()).toEqual([`bind PGUP "${aliasName}"`, `bind r "${aliasName}"`].sort())
      expect(aliasLines).toEqual([
        `alias ${aliasName} "drop rocket launcher; drop rockets; say_team need ammo"`,
      ])
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
