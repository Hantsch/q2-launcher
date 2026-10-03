import { latin1RoundTrip } from './render.test-helpers'
import { describe, expect, it } from 'vitest'
import type { ConfigAction } from '@shared/modules/config'
import type { AltLayer } from '@shared/config/alt-layers'
import { aliasNameFor, renderActionAliasLines } from '@shared/config/alias-render'
import { parseMetaTag } from '@shared/config/profile-metadata'
import { renderProfileFile } from './render'
import {
  profile,
  action,
  testProfileHeader,
  keySlots,
  entryTag,
  TEST_PROFILE_UNBINDALL,
  cvarBlock,
  unformat,
} from './render.test-helpers'

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
      keys: keySlots({ key: 'x' }),
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
      '// --- Aliases: Weapons [q2l cat=weapons ord=0] --------------------------------',
    )
    expect(lines).toContain(`alias one drop rl  // One ${entryTag()}`)
    expect(lines).toContain(`alias two wave 2   // Two ${entryTag()}`)
    expect(lines).toContain(
      '// --- Binds: Weapons [q2l cat=weapons ord=0] ----------------------------------',
    )
    expect(lines).toContain(`bind x "two"  // Two ${entryTag()}`)
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
    expect(latin1RoundTrip(rendered)).toBe(rendered)
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
  describe('no alias line for a directly bindable action', () => {
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
      keys: keySlots({ key: 'w' }),
      commands: [{ kind: 'raw', text: '+forward' }],
    })
    const attackRow = catalogueRow({
      id: 'a1a1',
      name: 'Attack',
      catalogId: 'attack:primary',
      keys: keySlots({ key: 'MOUSE1' }),
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
          ...testProfileHeader('dead-alias'),
          ...TEST_PROFILE_UNBINDALL,
          ...cvarBlock(),
          '',
          // Both binds are owned (each row's `bindValueFor` is the bare command sitting on the
          // key that row holds), so they are filed under the owning action's category and
          // ordered by that action's index in `profile.actions` - `w` before `MOUSE1`, which is
          // neither alphabetical nor insertion order.
          '// --- Binds: Movement [q2l cat=movement ord=0] --------------------------------',
          `bind w      "+forward"  // Forward ${entryTag({ cid: 'movement:forward' })}`,
          `bind MOUSE1 "+attack"   // Attack ${entryTag({ cid: 'attack:primary' })}`,
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
      const modified = { ...forwardRow, keys: keySlots({ key: 'r', modifier: 'ALT' }) }
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
        commands: [
          { kind: 'raw', text: 'wait' },
          { kind: 'raw', text: '+attack' },
        ],
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
        keys: keySlots({ key: 'w' }),
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
          action({ id: 'qqqq6666', name: 'SSG SG', keys: keySlots({ key: 'q' }) }),
          action({ id: 'aliasent', name: '+test', kind: 'alias' }),
        ],
      })

      expect(renderProfileFile(p)).toBe(renderProfileFile(p))
    })
  })

  describe('dual-bound actions', () => {
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
        keys: keySlots({ key: 'r' }, { key: 'PGUP' }),
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
      expect(bindLines.map(unformat)).toEqual([`bind PGUP "${aliasName}"`, `bind r "${aliasName}"`])
      expect(aliasLines.map(unformat)).toEqual([
        `alias ${aliasName} "drop rocket launcher; drop rockets; say_team need ammo"`,
      ])

      // Story 050 D6's own acceptance for this shape (AC4): the two bind lines are *identical*
      // past the key - same catalogue tag, no `e` to pair them and no `slot` to tell them apart.
      // What pairs them back into one two-key entry on import is the bind value they share, and
      // which of the two is slot 1 is the order they appear in the file, not a field.
      const catalogue = { cid: 'dropWeapon:rlauncher' }
      expect(bindLines.map((line) => line.slice(line.indexOf('  // ') + '  // '.length))).toEqual([
        `Rocket Launcher ${entryTag(catalogue)}`,
        `Rocket Launcher ${entryTag(catalogue)}`,
      ])
      expect(aliasLines[0]!.endsWith(`  // Rocket Launcher ${entryTag(catalogue)}`)).toBe(true)

      // Asserted as a property too, not only against the literals above: no line of this entry
      // carries any of the three keys story 050 removed.
      for (const line of [...bindLines, ...aliasLines]) {
        expect(line).not.toMatch(/\be=|\bk=|\bslot=/)
      }
    })

    it('renders a movement row with only a Primary key as exactly one bind line', () => {
      const movementRow = action({
        name: 'Jump',
        id: 'cccc2222',
        categoryId: 'movement',
        catalogId: 'movement:jump',
        keys: keySlots({ key: 'SPACE' }),
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
 * Story 045, D4: a toggle/press-release entry's `lbl` tag field. `buildAliasSections` has to put a
 * state's own `parts[i].label` on that state's own rendered alias line - never on the dispatch alias
 * or on a `_p<n>` chunk line - which `entryTag`/`twoPartAliasNames` are what this deliverable added.
 */
describe('toggle/press-release state labels ride the `lbl` tag', () => {
  const zoom = action({
    id: 'zoom-lbl',
    name: 'Zoom',
    categoryId: 'weapons',
    kind: 'toggle',
    catalogId: 'movement:zoom',
    commands: [],
    keys: keySlots({ key: 'v' }),
    parts: [
      { label: 'In', commands: [{ kind: 'raw', text: 'zoom_fov' }] },
      { label: 'Out', commands: [{ kind: 'raw', text: 'norm_fov' }] },
    ],
  })

  it('puts each state`s label on that state`s own alias line, and neither on the dispatch line', () => {
    const lines = renderProfileFile(profile({ id: 'zoom-lbl', actions: [zoom] })).split('\n')
    const commentOf = (prefix: string): string => {
      const line = lines.find((l) => l.startsWith(prefix))!
      return line.slice(line.indexOf('// '))
    }

    expect(commentOf('alias zoom_s1 ')).toBe(
      `// Zoom ${entryTag({ cid: 'movement:zoom', lbl: 'In' })}`,
    )
    expect(commentOf('alias zoom_s2 ')).toBe(
      `// Zoom ${entryTag({ cid: 'movement:zoom', lbl: 'Out' })}`,
    )
    // Note the trailing space: distinguishes the dispatch line (`alias zoom zoom_s1`) from either
    // state line (`alias zoom_s1 ...`) - both share the `alias zoom` prefix otherwise.
    expect(commentOf('alias zoom ')).toBe(`// Zoom ${entryTag({ cid: 'movement:zoom' })}`)
  })

  it('puts no `lbl` on a chunk line of either half', () => {
    const longHalf = Array.from({ length: 40 }, (_, i) => ({
      kind: 'raw' as const,
      text: `command_number_${i}_padded_to_be_long_enough_to_force_a_chunk_split`,
    }))
    const chunked = action({
      ...zoom,
      id: 'zoom-lbl-chunked',
      parts: [
        { label: 'In', commands: longHalf },
        { label: 'Out', commands: [{ kind: 'raw', text: 'norm_fov' }] },
      ],
    })
    const lines = renderProfileFile(profile({ id: 'zoom-lbl-chunked', actions: [chunked] })).split(
      '\n',
    )
    const chunkLines = lines.filter((line) => line.startsWith('alias zoom_s1_p'))

    expect(chunkLines.length).toBeGreaterThan(0)
    for (const line of chunkLines) expect(line).not.toContain('lbl=')
  })

  it('round-trips a label containing characters the tag grammar escapes', () => {
    const rawLabel = 'In/Out 100% [x]'
    const withEscapes = action({
      ...zoom,
      id: 'zoom-lbl-escape',
      parts: [
        { label: rawLabel, commands: [{ kind: 'raw', text: 'zoom_fov' }] },
        { label: 'Out', commands: [{ kind: 'raw', text: 'norm_fov' }] },
      ],
    })
    const lines = renderProfileFile(
      profile({ id: 'zoom-lbl-escape', actions: [withEscapes] }),
    ).split('\n')
    const stateLine = lines.find((line) => line.startsWith('alias zoom_s1 '))!
    const tagStart = stateLine.lastIndexOf('[q2l')
    const tagText = stateLine.slice(tagStart)

    // The escaped form actually reached the file - space, `%` and `]` are all among the four
    // characters `escapeMetaValue` percent-encodes, so a byte-identical round trip is not a no-op.
    expect(tagText).not.toContain(rawLabel)
    const parsed = parseMetaTag(tagText)
    expect(parsed.fields.lbl).toBe(rawLabel)
  })

  it('renders a press/release entry with no labels exactly as D3 already verified - no `lbl` anywhere', () => {
    const slow = action({
      id: 'slow-no-lbl',
      name: 'Slow',
      categoryId: 'weapons',
      kind: 'press-release',
      commands: [],
      keys: keySlots({ key: 'CTRL' }),
      parts: [
        { commands: [{ kind: 'raw', text: 'cl_run 0' }] },
        { commands: [{ kind: 'raw', text: 'cl_run 1' }] },
      ],
    })
    const lines = renderProfileFile(profile({ id: 'slow-no-lbl', actions: [slow] })).split('\n')
    const commentOf = (prefix: string): string => {
      const line = lines.find((l) => l.startsWith(prefix))!
      return line.slice(line.indexOf('// '))
    }

    expect(commentOf('alias +slow ')).toBe(`// Slow ${entryTag()}`)
    expect(commentOf('alias -slow ')).toBe(`// Slow ${entryTag()}`)
    expect(lines.some((line) => line.includes('lbl='))).toBe(false)
  })
})
