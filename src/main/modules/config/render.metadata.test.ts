import { describe, expect, it } from 'vitest'
import type { ConfigAction, ConfigProfile } from '@shared/modules/config'
import { ROUND_TRIP_FIXTURES } from '@shared/config/fixtures/profiles'
import { STRICTEST_LINE_BUDGET, renderProfileFile } from './render'
import { profile, action, testProfileHeader, keySlots, entryTag } from './render.test-helpers'

/**
 * Story 042 D2 - the metadata the writer now emits, as a format rather than as decoration.
 *
 * The failure mode this block exists for is a tag that renders but cannot be read back: a hash
 * that changes between renders, a value that smuggles a `]` or a `//` out of a display name, a
 * prose that forges a tag, or a `v` marker that lands on the sentinel line and breaks every
 * ownership check in `writer.ts`/`cleanup.ts`/`canonical.ts`. Each of those is silent on a green
 * layout assertion, so each gets its own case here.
 */
describe('the [q2l ...] metadata the writer emits', () => {
  it("carries the version marker exactly once, only in the header block's own tag line (story 051 D2)", () => {
    const lines = renderProfileFile(
      profile({
        id: 'versioned',
        actions: [
          action({ id: 'v-1', name: 'One', keys: keySlots({ key: 'q' }), aliasName: 'one_e' }),
        ],
        binds: { q: 'one_e' },
        layers: [
          {
            id: 'l1',
            name: 'Drops',
            mode: 'hold',
            triggerKey: 'ALT',
            overrides: { '1': 'drop rl' },
          },
        ],
      }),
    ).split('\n')

    const tagLine = testProfileHeader('versioned')[3]!
    // Ownership travels only as the `id` field in this same tag now (story 051) - no second,
    // sentinel-shaped line repeats the profile id anywhere else in the file.
    expect(lines.filter((line) => line.includes('v=1'))).toEqual([tagLine])
    expect(lines.filter((line) => line.includes('versioned'))).toEqual([tagLine])
    expect(lines[3]).toBe(tagLine)
    expect(lines[0]).not.toContain('[q2l')
  })

  it('neutralises a display name that tries to forge a tag, so only the real tag parses as one', () => {
    const p = profile({
      id: 'forged',
      categories: [{ id: 'cat-real', name: 'Weapons [q2l cat=movement]' }],
      actions: [
        action({
          id: 'forge-1',
          name: 'Gib [q2l cid=attack:primary]',
          categoryId: 'cat-real',
          keys: keySlots({ key: 'q' }),
          aliasName: 'gib_e',
        }),
      ],
      binds: { q: 'gib_e' },
    })

    const rendered = renderProfileFile(p)

    // One `[q2l` per line, always the trailing one: the user's own text reads back as inert
    // `(q2l ...)`-ish decoration, never as a real field.
    for (const line of rendered.split('\n')) {
      expect(line.split('[q2l').length - 1).toBeLessThanOrEqual(1)
    }
    expect(rendered).toContain(`// Gib (q2l cid=attack:primary] ${entryTag()}`)
    expect(rendered).toContain(
      '// --- Aliases: Weapons (q2l cat=movement] [q2l cat=cat-real ord=0] ',
    )
    // The forged fields did not become real ones - the only `cid` and `cat` in the file are the
    // ones the writer put there itself.
    expect(rendered).not.toContain('[q2l cid=attack:primary]')
    expect(rendered).not.toContain('[q2l cat=movement]')
  })

  it('percent-escapes a tag value that carries a space, a `]` or a `/`', () => {
    // A `catalogId` is machine-minted today, so this is the defensive path: a value that could
    // otherwise close the tag early, split a token, or open a second `//` inside the comment.
    const p = profile({
      id: 'escaped',
      actions: [
        action({
          id: 'esc-1',
          name: 'Odd',
          catalogId: 'weird id]with/slash%',
          keys: keySlots({ key: 'q' }),
          aliasName: 'odd_e',
        }),
      ],
      binds: { q: 'odd_e' },
    })

    const rendered = renderProfileFile(p)
    const bindLine = rendered.split('\n').find((line) => line.startsWith('bind q '))!

    expect(bindLine).toContain('cid=weird%20id%5Dwith%2Fslash%25')
    // Exactly one `//` on the line - the comment's own. An unescaped `/` in a value could pair up
    // with the next one and read as a command separator inside the comment.
    expect(bindLine.split('//').length - 1).toBe(1)
    expect(bindLine.endsWith(']')).toBe(true)
  })

  it('keeps a banner inside the line budget even when the tag value itself is absurdly long', () => {
    // The title-side of this is already covered above; this is the tag side. A category id this
    // long is unreachable through the IPC schemas but uncapped in the persisted store, and the
    // rule is that the tag is dropped whole rather than cut into a `[q2l` with no closing bracket.
    const id = 'x'.repeat(4000)
    const rendered = renderProfileFile(
      profile({
        id: 'long-cat-id',
        categories: [{ id, name: 'Long id' }],
        actions: [
          action({
            id: 'long-1',
            name: 'E',
            categoryId: id,
            keys: keySlots({ key: 'z' }),
            aliasName: 'e',
          }),
        ],
        binds: { z: 'e' },
      }),
    )

    for (const line of rendered.split('\n')) {
      expect(line.length).toBeLessThan(STRICTEST_LINE_BUDGET)
      if (line.includes('[q2l')) expect(line).toMatch(/\[q2l[^\]]*\]/)
    }
    expect(rendered).toContain('// --- Aliases: Long id ')
  })

  it('is deterministic and latin1-safe with every tag kind in one file', () => {
    const build = (): ConfigProfile =>
      profile({
        id: 'tagged-rich',
        name: 'Bjørn',
        categories: [{ id: 'cat-melee', name: 'Nähkampf' }],
        actions: [
          action({
            id: 'rich-a',
            name: 'Nahkampf',
            categoryId: 'cat-melee',
            catalogId: 'weapon:blaster',
            keys: keySlots({ key: 'x' }, { key: 'MOUSE3' }),
            aliasName: 'melee_x',
            commands: [
              { kind: 'raw', text: 'use blaster' },
              { kind: 'raw', text: '+attack' },
            ],
          }),
        ],
        binds: { x: 'melee_x', MOUSE3: 'melee_x', F1: 'say Grüße' },
        layers: [
          {
            id: 'l1',
            name: 'Drops',
            mode: 'hold',
            triggerKey: 'ALT',
            overrides: { '1': 'drop rl' },
          },
          {
            id: 'l2',
            name: 'Zoom',
            mode: 'toggle',
            triggerKey: null,
            overrides: { MOUSE2: 'zoom' },
          },
        ],
      })

    const rendered = renderProfileFile(build())

    expect(renderProfileFile(build())).toBe(rendered)
    expect(Buffer.from(rendered, 'latin1').toString('latin1')).toBe(rendered)
    // The two slots of the one entry: one catalogue tag, twice, with nothing left to tell the
    // two lines apart but the key each of them binds.
    const catalogue = { cid: 'weapon:blaster' }
    expect(
      rendered.split('\n').filter((line) => line.endsWith(`  // Nahkampf ${entryTag(catalogue)}`)),
    ).toHaveLength(3)
    // The trigger-less layer's header still records the layer and its mode, just no trigger.
    expect(rendered).toContain('[q2l layer=l2 mode=toggle]')
    expect(rendered).toContain('[q2l layer=l1 mode=hold trigger=ALT]')
  })

  it('marks a fieldless entry line with the bare [q2l] tag, and never a kind or a slot', () => {
    const p = profile({
      id: 'kinds',
      actions: [
        action({
          id: 'k-alias',
          name: '+slow',
          kind: 'alias',
          commands: [{ kind: 'raw', text: 'cl_maxfps 30' }],
        }),
        action({
          id: 'k-msg',
          name: 'GG',
          kind: 'message',
          aliasName: 'gg_e',
          commands: [{ kind: 'message', channel: 'say', text: 'gg' }],
        }),
      ],
    })

    const lines = renderProfileFile(p).split('\n')

    // Neither entry is catalogue-backed, so neither tag has a single field left to carry - and
    // both lines still get one. That bare marker is the only thing that still says "the launcher
    // wrote this line", so a line rendering without it would come back as a hand-typed bind.
    expect(lines.some((line) => line.endsWith(`// +slow ${entryTag()}`))).toBe(true)
    expect(lines.some((line) => line.endsWith(`// GG ${entryTag()}`))).toBe(true)
    expect(entryTag()).toBe('[q2l]')
    for (const line of lines) expect(line).not.toMatch(/\be=|\bk=|\bslot=/)
  })
})

/**
 * Story 050 D6 - the writer's half of the tag shrink.
 *
 * Every byte on these lines is what story 042's round-trip property is measured against, and both
 * failure modes of this deliverable are silent: a tag that carries one field too many reads back
 * as an unknown key, and a tag (or an anchor line) that carries one field too *few* reads back as
 * a different set of entries and slots than was saved - no error either way, just a file that
 * reconstructs into something else. So the three things the reader depends on are pinned here
 * byte-for-byte: what an entry line's tag says, that every entry line has one, and that an
 * entry's anchors appear once per modified slot in slot order.
 */
describe('the reduced [q2l ...] tag', () => {
  /**
   * The story's own example, byte for byte, alignment included.
   *
   * `movement:attack` is a real continuous catalogue row, so its mirror value is the bare
   * `+attack` (story 034) and it keeps no alias line - which is exactly the shape the story's
   * example line has. The `movement:forward` row next to it is what puts the third space in front
   * of the `//`: the two rows share one category section, so `"+attack"` is padded to the width of
   * `"+forward"` before `attachTaggedComment` adds its own two spaces.
   */
  it("renders the story's example line exactly", () => {
    const catalogueRow = (overrides: Partial<ConfigAction>): ConfigAction =>
      action({ categoryId: 'movement', kind: 'bind', ...overrides })
    const forward = catalogueRow({
      id: 'ex-forward',
      name: 'Forward',
      catalogId: 'movement:forward',
      keys: keySlots({ key: 'w' }),
      commands: [{ kind: 'raw', text: '+forward' }],
    })
    const attack = catalogueRow({
      id: 'ex-attack',
      name: 'Attack',
      catalogId: 'movement:attack',
      keys: keySlots({ key: 'mouse1' }),
      commands: [{ kind: 'raw', text: '+attack' }],
    })
    const lines = renderProfileFile(
      profile({
        id: 'story-example',
        actions: [forward, attack],
        binds: { w: '+forward', mouse1: '+attack' },
      }),
    ).split('\n')

    expect(lines).toContain('bind mouse1 "+attack"   // Attack [q2l cid=movement:attack]')
    expect(lines).toContain('bind w      "+forward"  // Forward [q2l cid=movement:forward]')
    // The comment on its own, so this half of the acceptance holds independently of whatever the
    // surrounding section's column alignment happens to be.
    const bindLine = lines.find((line) => line.startsWith('bind mouse1'))!
    expect(bindLine.slice(bindLine.indexOf('// '))).toBe('// Attack [q2l cid=movement:attack]')
  })

  /**
   * The multi-slot half of the story (its "more than two key slots" decision) meeting the anchor
   * rule: an anchor per *modified* slot, for every slot, in slot order.
   *
   * Slot order is the whole point of the assertion being an `toEqual` over an ordered list rather
   * than three `toContain`s. Since `slot` left the tag, the only record of which key is slot 1 is
   * the order the claiming lines appear in the file, so an anchor block emitted in any other order
   * silently permutes the entry's keys on the next import - and every individual line would still
   * look perfectly correct.
   */
  it('emits one anchor line per modified slot, for all slots, in slot order', () => {
    const multi = action({
      id: 'multi-slot',
      name: 'Multi key',
      categoryId: 'movement',
      aliasName: 'multi_e',
      keys: keySlots(
        { key: 'r', modifier: 'ALT' },
        { key: 'p' },
        { key: 'F5', modifier: 'CTRL' },
        { key: 'F6', modifier: 'SHIFT' },
      ),
      commands: [
        { kind: 'raw', text: 'use rl' },
        { kind: 'raw', text: 'wait' },
      ],
    })
    const lines = renderProfileFile(
      profile({ id: 'multi-anchor', actions: [multi], binds: { p: 'multi_e' } }),
    ).split('\n')

    // One anchor per modified slot - slots 0, 2 and 3 - in that order, and none for the plain
    // slot 1, whose `bind p` line already says everything the file needs about it.
    expect(lines.filter((line) => line.startsWith('// Multi key'))).toEqual([
      `// Multi key ${entryTag({ key: 'r', mod: 'ALT' })}`,
      `// Multi key ${entryTag({ key: 'F5', mod: 'CTRL' })}`,
      `// Multi key ${entryTag({ key: 'F6', mod: 'SHIFT' })}`,
    ])
    expect(lines).toContain(`bind p "multi_e"  // Multi key ${entryTag()}`)
    expect(lines.filter((line) => line.includes('key=p'))).toEqual([])
    // `an` is omitted: this entry keeps a real alias line (the `bind p` mirror references it), and
    // that line's own name is the authoritative spelling of the alias name.
    expect(lines.some((line) => line.includes('an='))).toBe(false)
  })

  /**
   * The one shape that still needs `an`: a continuous catalogue row on a *modified* key. Its
   * mirror is the bare `+forward` rather than its alias (story 034), so story 038 drops the alias
   * line as unreachable, and the modifier means story 016 writes no `bind` line either - leaving no
   * code in the file whose own text could spell the entry's alias name. Its anchor is the only
   * place that name can live, which is why `an` survived the cut.
   */
  it('carries an= on the anchor of an entry that has no other line in the file', () => {
    const lonely = action({
      id: 'lonely',
      name: 'Forward',
      categoryId: 'movement',
      kind: 'bind',
      catalogId: 'movement:forward',
      aliasName: 'lonely_e',
      keys: keySlots({ key: 'w', modifier: 'ALT' }),
      commands: [{ kind: 'raw', text: '+forward' }],
    })
    const lines = renderProfileFile(profile({ id: 'lonely-anchor', actions: [lonely] })).split('\n')

    expect(lines.some((line) => line.startsWith('alias lonely_e'))).toBe(false)
    expect(lines.some((line) => line.startsWith('bind '))).toBe(false)
    expect(lines).toContain(
      `// Forward ${entryTag({ cid: 'movement:forward', an: 'lonely_e', key: 'w', mod: 'ALT' })}`,
    )
  })

  /**
   * AC1, as a whole-file audit rather than as one more literal: no tag the writer emits anywhere
   * carries `e`, `k` or `slot`.
   *
   * Checked by parsing each line's tag and looking at its *keys*, never by searching the line for
   * the substring `e=` - `[q2l layer=l1 mode=hold]` contains that substring inside `mode=`, and a
   * substring check would either fail on a legitimate layer header or have to be weakened into
   * something that no longer proves anything. The corpus is both the round-trip fixtures (the
   * profiles story 042's fixed point is measured on) and a local set covering the line kinds those
   * fixtures do not all have at once: an anchor block, a multi-slot entry, a layer with and
   * without a trigger, an unowned bind and an orphaned category.
   */
  it('emits no e=, k= or slot= field in any tag, on any line, for the whole fixture corpus', () => {
    const local: ConfigProfile[] = [
      profile({
        id: 'audit-1',
        categories: [{ id: 'cat-melee', name: 'Nähkampf' }],
        actions: [
          action({
            id: 'audit-a',
            name: 'Nahkampf',
            categoryId: 'cat-melee',
            catalogId: 'weapon:blaster',
            aliasName: 'melee_x',
            keys: keySlots({ key: 'x' }, { key: 'MOUSE3' }, { key: 'F7', modifier: 'CTRL' }),
            commands: [
              { kind: 'raw', text: 'use blaster' },
              { kind: 'raw', text: '+attack' },
            ],
          }),
          action({
            id: 'audit-b',
            name: 'Orphaned',
            categoryId: 'category-that-is-gone',
            aliasName: 'orphan_e',
            keys: keySlots({ key: 'o', modifier: 'ALT' }),
            commands: [
              { kind: 'raw', text: 'wave 3' },
              { kind: 'raw', text: 'wait' },
            ],
          }),
        ],
        binds: { x: 'melee_x', MOUSE3: 'melee_x', F1: 'say hello' },
        layers: [
          {
            id: 'l1',
            name: 'Drops',
            mode: 'hold',
            triggerKey: 'ALT',
            overrides: { '1': 'drop rl' },
          },
          {
            id: 'l2',
            name: 'Zoom',
            mode: 'toggle',
            triggerKey: null,
            overrides: { MOUSE2: 'zoom' },
          },
        ],
      }),
      ...ROUND_TRIP_FIXTURES,
    ]

    const removed = ['e', 'k', 'slot']
    for (const p of local) {
      for (const line of renderProfileFile(p).split('\n')) {
        const tag = /\[q2l(?<body>(?:\s+[^\s\]]+)*)\s*\]\s*$/.exec(line)
        if (!tag) continue
        const keys = (tag.groups!.body ?? '')
          .trim()
          .split(/\s+/)
          .filter((token) => token.length > 0)
          .map((token) => token.slice(0, token.indexOf('=')))
        for (const key of removed) expect(keys).not.toContain(key)
        // Positive side of the same check, so a tag that renders no field at all cannot make the
        // assertion above pass by emitting nothing: every key is one the post-050 registry has.
        for (const key of keys) {
          // `lbl` (story 045, D4) is the tenth registered key - a toggle/press-release state's own
          // display label - `ord` (story 052's F3 fix) the eleventh, a category section header's
          // own position in `profile.categories`, and `sub` (story 053 D2) the twelfth, a
          // second-level section header's own sub-category id. `cvs`/`cvsub` (story 059 D2) are the
          // thirteenth and fourteenth, a cvar section/sub-section header's own id - a distinct
          // namespace from `cat`/`sub`. Each joined the list here rather than replacing anything,
          // which is exactly what "a key addition alone needs no `META_FORMAT_VERSION` bump" means.
          // `id` (story 051 D2) is the profile's own stable id - like `v`, only ever emitted on the
          // header block's own tag line, never a per-line one.
          expect([
            'v',
            'id',
            'cid',
            'an',
            'key',
            'mod',
            'cat',
            'layer',
            'mode',
            'trigger',
            'lbl',
            'ord',
            'sub',
            'cvs',
            'cvsub',
          ]).toContain(key)
        }
      }
    }
  })
})
