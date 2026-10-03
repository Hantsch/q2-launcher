import { latin1RoundTrip } from './render.test-helpers'
import { describe, expect, it } from 'vitest'
import type { ConfigAction, ConfigActionCategory, ConfigProfile } from '@shared/modules/config'
import { keySlotAt } from '@shared/config/action-slots'
import { effectiveSize } from '@shared/config/engine-limits'
import { STRICTEST_LINE_BUDGET, renderProfileFile } from './render'
import {
  TEMPLATE_CATEGORIES,
  profile,
  action,
  keySlots,
  entryTag,
  CVAR_GROUP_BANNERS,
  unformat,
  setLines,
} from './render.test-helpers'

/**
 * Story 040 D3 - the alias, layer and bind sections themselves.
 *
 * The risky half of this story: it reads the actions -> `binds` mirror *backwards* (a reverse
 * index no helper provided before), and a mistake there is silent on disk - a bind filed under
 * the wrong banner with the wrong name, or, worse, one that stops being written at all. Every
 * block below therefore asserts on the bind *count* or the bind *set* as well as on the layout,
 * so a lost keybinding cannot hide behind a passing formatting assertion.
 */
describe('alias, layer and bind sections', () => {
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
    /**
     * Story 052 D4: deliberately neither alphabetical nor built-ins-first, and with one former
     * built-in (`drops`) renamed by its `name`. The section order below is exactly this array's
     * order, which is what makes reordering and renaming a category in the rail move and rename its
     * section in the file (AC 8).
     */
    const categories: ConfigActionCategory[] = [
      { id: 'cat-bravo', name: 'Bravo' },
      { id: 'drops', name: 'Drops' },
      { id: 'cat-alpha', name: 'Alpha' },
      { id: 'movement', name: 'Movement', nameKey: 'config.controls.categories.movement' },
      { id: 'weapons', name: 'Weapons', nameKey: 'config.controls.categories.weapons' },
    ]

    /** One entry per section a category can produce, plus one whose category the profile no
     * longer has - built so both the alias and the bind side of each category is exercised. */
    const entries: ConfigAction[] = [
      action({
        id: 'e-move',
        name: 'Strafe left',
        categoryId: 'movement',
        keys: keySlots({ key: 'a' }),
        aliasName: 'strafe_l',
        commands: [
          { kind: 'raw', text: 'wait' },
          { kind: 'raw', text: '+moveleft' },
        ],
      }),
      action({
        id: 'e-weap',
        name: 'SSG + SG',
        categoryId: 'weapons',
        keys: keySlots({ key: 'q' }),
        aliasName: 'ssg_sg',
        commands: [
          { kind: 'raw', text: 'use super shotgun' },
          { kind: 'raw', text: 'use shotgun' },
        ],
      }),
      action({
        id: 'e-drop',
        name: 'Drop RL',
        categoryId: 'drops',
        keys: keySlots({ key: 'r' }),
        aliasName: 'drop_rl',
        commands: [
          { kind: 'raw', text: 'drop rocket launcher' },
          { kind: 'raw', text: 'say_team dropped rl' },
        ],
      }),
      action({
        id: 'e-bravo',
        name: 'Bravo entry',
        categoryId: 'cat-bravo',
        keys: keySlots({ key: 'b' }),
        aliasName: 'bravo_e',
        commands: [
          { kind: 'raw', text: 'wave 1' },
          { kind: 'raw', text: 'wait' },
        ],
      }),
      action({
        id: 'e-alpha',
        name: 'Alpha entry',
        categoryId: 'cat-alpha',
        keys: keySlots({ key: 'z' }),
        aliasName: 'alpha_e',
        commands: [
          { kind: 'raw', text: 'wave 2' },
          { kind: 'raw', text: 'wait' },
        ],
      }),
      action({
        id: 'e-gone',
        name: 'Orphan entry',
        categoryId: 'deleted-category',
        keys: keySlots({ key: 'o' }),
        aliasName: 'orphan_e',
        commands: [
          { kind: 'raw', text: 'wave 3' },
          { kind: 'raw', text: 'wait' },
        ],
      }),
    ]

    const grouped = profile({
      id: 'grouped',
      categories,
      actions: entries,
      binds: {
        // The mirror `setActions` would have written for each entry above, plus one bind the
        // user typed themselves.
        ...Object.fromEntries(entries.map((entry) => [keySlotAt(entry, 0)!.key, entry.aliasName!])),
        F1: 'say hello',
      },
    })

    it('orders alias and bind sections by profile.categories array order, then other', () => {
      // `profile.categories` is deliberately stored Bravo-before-Alpha, so a section order of
      // Alpha-before-Bravo would prove the code sorted by name instead of following the array.
      // Story 052 D4: the three former built-ins are in that same array and get no head start -
      // `drops` sits second because the array says so, under the profile's own name for it
      // ("Drops", not the template's "Weapon dropping"), and `movement`/`weapons` come last.
      // (This profile has no layers; the layer sections' own placement - last, after "Other
      // binds" - is pinned by the tests in the layers block above.)
      // Story 042 D2: every category section header carries its own `cat` id, which is what lets
      // an import file these lines back under the right category (and a custom one under a
      // category minted from the banner's title). The two "Other" buckets carry no tag: their
      // members' `categoryId` matches no category the profile has, so there is no id to record and
      // a tag would invent one. "Other binds" carries none either - those lines have no owner.
      // Story 052 (F3 fix): each of those headers also carries `ord`, the category's own position in
      // `profile.categories` - the same value on all three of a category's headers, and the only
      // thing that tells a reader the order apart when two categories share no section block.
      // Story 048 D2: the four cvar group banners lead every file now - no group can be empty once
      // every catalogue cvar is written.
      expect(banners(renderProfileFile(grouped))).toEqual([
        ...CVAR_GROUP_BANNERS,
        'Aliases: Bravo [q2l cat=cat-bravo ord=0]',
        'Aliases: Drops [q2l cat=drops ord=1]',
        'Aliases: Alpha [q2l cat=cat-alpha ord=2]',
        'Aliases: Movement [q2l cat=movement ord=3]',
        'Aliases: Weapons [q2l cat=weapons ord=4]',
        'Aliases: Other',
        'Binds: Bravo [q2l cat=cat-bravo ord=0]',
        'Binds: Drops [q2l cat=drops ord=1]',
        'Binds: Alpha [q2l cat=cat-alpha ord=2]',
        'Binds: Movement [q2l cat=movement ord=3]',
        'Binds: Weapons [q2l cat=weapons ord=4]',
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
        // bind line can be pinned byte-for-byte, comment and (story 042 D2) metadata tag included.
        expect(lines).toContain(
          `bind ${keySlotAt(entry, 0)!.key} "${entry.aliasName}"  // ${entry.name} ${entryTag()}`,
        )
        expect(
          lines.some(
            (line) =>
              line.startsWith(`alias ${entry.aliasName} `) &&
              line.endsWith(`  // ${entry.name} ${entryTag()}`),
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
        keys: keySlots({ key: 'k' }, { key: 'HOME' }),
        aliasName: 'two_slots',
        commands: [
          { kind: 'raw', text: 'wave 1' },
          { kind: 'raw', text: 'wait' },
        ],
      })
      const first = action({
        id: 'e-first',
        name: 'First',
        categoryId: 'movement',
        keys: keySlots({ key: 'zzz_last_key' }),
        aliasName: 'first_e',
        commands: [
          { kind: 'raw', text: 'wave 2' },
          { kind: 'raw', text: 'wait' },
        ],
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
      keys: keySlots({ key: 'q' }),
      aliasName: 'ssg_sg',
      commands: [
        { kind: 'raw', text: 'use super shotgun' },
        { kind: 'raw', text: 'use shotgun' },
      ],
    })

    it('does not claim the same value on a key the action does not hold (story 039 key-scoping)', () => {
      // Since story 039 an alias name is a readable word, so a user's own `bind e "ssg_sg"` is
      // byte-for-byte the mirror value - only the key tells the two apart.
      const p = profile({ id: 'key-scoped', actions: [ssgSg], binds: { q: 'ssg_sg', e: 'ssg_sg' } })
      const lines = renderProfileFile(p).split('\n')

      expect(lines).toContain(`bind q "ssg_sg"  // SSG + SG ${entryTag()}`)
      // The unclaimed key keeps no comment at all - neither the label nor a tag that would hand a
      // hand-typed bind to an entry that does not own it.
      expect(lines).toContain('bind e "ssg_sg"')
      expect(lines.filter((line) => line.startsWith('bind e '))).toEqual(['bind e "ssg_sg"'])
      expect(banners(renderProfileFile(p))).toContain('Other binds')
    })

    it('does not claim a key whose value is not the action`s own mirror value', () => {
      const p = profile({ id: 'value-scoped', actions: [ssgSg], binds: { q: 'something else' } })
      const rendered = renderProfileFile(p)

      // The key is right, the value is not - so this is a hand-typed bind on a slot the entry
      // also holds, and it is written unlabelled rather than mislabelled.
      expect(rendered.split('\n')).toContain('bind q "something else"')
      expect(banners(rendered)).not.toContain('Binds: Weapons [q2l cat=weapons]')
    })

    it('does not claim a plain key for an action whose slot carries a modifier (story 016)', () => {
      // `Alt+R` is mirrored into the ALT layer's overrides, never into `binds`, so a plain `r`
      // in `binds` belongs to whoever typed it - not to this entry.
      const modified = { ...ssgSg, keys: keySlots({ key: 'r', modifier: 'ALT' }) }
      const p = profile({ id: 'modified-slot', actions: [modified], binds: { r: 'ssg_sg' } })
      const rendered = renderProfileFile(p)

      expect(rendered.split('\n')).toContain('bind r "ssg_sg"')
      expect(banners(rendered)).not.toContain('Binds: Weapons [q2l cat=weapons]')
    })

    it('never lets a kind: alias entry own a bind (story 019)', () => {
      const aliasEntry = action({
        id: 'alias-entry',
        name: '+slow',
        kind: 'alias',
        categoryId: 'weapons',
        keys: keySlots({ key: 'g' }),
        commands: [{ kind: 'raw', text: 'cl_maxfps 30' }],
      })
      const p = profile({ id: 'alias-owner', actions: [aliasEntry], binds: { g: '+slow' } })
      const rendered = renderProfileFile(p)

      expect(rendered.split('\n')).toContain('bind g "+slow"')
      expect(banners(rendered)).toContain('Other binds')
      expect(banners(rendered)).not.toContain('Binds: Weapons [q2l cat=weapons]')
    })

    it('labels a continuous catalogue row`s direct command mirror (story 034), not just an alias mirror', () => {
      const forward = action({
        id: 'cat-forward',
        name: 'Forward',
        categoryId: 'movement',
        catalogId: 'movement:forward',
        keys: keySlots({ key: 'w' }),
        commands: [{ kind: 'raw', text: '+forward' }],
      })
      const p = profile({ id: 'direct-mirror', actions: [forward], binds: { w: '+forward' } })

      // `bindValueFor` returns the bare command here, so the reverse index has to match on that
      // and not on the alias name - the catalogue label is what proves it did.
      expect(renderProfileFile(p).split('\n')).toContain(
        `bind w "+forward"  // Forward ${entryTag({ cid: 'movement:forward' })}`,
      )
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
          {
            id: 'l1',
            name: 'Drops',
            mode: 'hold',
            triggerKey: 'ALT',
            overrides: { '1': 'drop rl' },
          },
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
        keys: keySlots({ key: 'ALT' }),
        aliasName: 'attack_e',
        commands: [
          { kind: 'raw', text: 'use blaster' },
          { kind: 'raw', text: '+attack' },
        ],
      })
      const p = profile({
        id: 'trigger-conflict-owned',
        actions: [attack],
        binds: { ALT: 'attack_e' },
        layers: [
          {
            id: 'l1',
            name: 'Drops',
            mode: 'hold',
            triggerKey: 'ALT',
            overrides: { '1': 'drop rl' },
          },
        ],
      })

      const rendered = renderProfileFile(p)
      const codeLines = rendered.split('\n').map(unformat)

      // The base bind really did land in its owning category's section, not in "other binds" -
      // otherwise this case would silently be the previous test over again.
      expect(banners(rendered)).toContain('Binds: Weapons [q2l cat=weapons ord=0]')
      expect(codeLines).toContain('bind ALT "attack_e"')
      expect(codeLines).toContain('bind ALT +drops')
      expect(codeLines.indexOf('bind ALT +drops')).toBeGreaterThan(
        codeLines.indexOf('bind ALT "attack_e"'),
      )
    })

    it('emits no banner for a category with nothing in it', () => {
      const p = profile({
        id: 'sparse',
        // The empty one first, so its absence from the output cannot be an ordering artefact.
        categories: [{ id: 'cat-empty', name: 'Empty category' }, ...TEMPLATE_CATEGORIES],
        actions: [
          action({
            id: 'only',
            name: 'Only',
            categoryId: 'weapons',
            aliasName: 'only_e',
            commands: [
              { kind: 'raw', text: 'wave 1' },
              { kind: 'raw', text: 'wait' },
            ],
          }),
        ],
      })

      expect(banners(renderProfileFile(p))).toEqual([
        ...CVAR_GROUP_BANNERS,
        // `ord=0`, not `ord=1`: `categoryOrdinals` numbers only the categories that carry an entry,
        // so the empty one that writes no section does not consume an ordinal either - see that
        // function's own doc comment for why a gap here would cost story 042's fixed point.
        'Aliases: Weapons [q2l cat=weapons ord=0]',
        // Story 063 D1: `only` is a keyless `kind: 'bind'` entry with a body, so besides its alias
        // line it now also earns an unbound line (`isUnboundEntry`) recording its empty key slot -
        // which means its category's `Entries:` section is no longer "nothing in it" either.
        'Entries: Weapons [q2l cat=weapons ord=0]',
      ])
    })
  })

  describe('budget, encoding and determinism over the whole file', () => {
    /** A profile touching every section kind this deliverable adds. */
    function richProfile(nameSuffix = ''): ConfigProfile {
      const entry = action({
        id: 'rich-1',
        name: `Nahkampf${nameSuffix}`,
        categoryId: 'cat-melee',
        keys: keySlots({ key: 'x' }),
        aliasName: 'melee_x',
        commands: [
          { kind: 'raw', text: 'use blaster' },
          { kind: 'raw', text: '+attack' },
        ],
      })
      return profile({
        id: 'rich',
        name: 'Bjørn - Test',
        cvars: { sensitivity: '3', unknown_cvar: 'ÿ' },
        categories: [{ id: 'cat-melee', name: 'Nähkampf' }],
        actions: [entry],
        binds: { x: 'melee_x', F1: 'say Grüße' },
        layers: [
          {
            id: 'l1',
            name: 'Drops',
            mode: 'hold',
            triggerKey: 'ALT',
            overrides: { '1': 'drop rl' },
          },
        ],
      })
    }

    it('round-trips the whole file - banners, labels and all - through latin1 byte-for-byte', () => {
      const rendered = renderProfileFile(richProfile())

      expect(rendered).toContain('Nähkampf')
      expect(latin1RoundTrip(rendered)).toBe(rendered)
    })

    it('is deterministic across repeated calls on a profile with every section kind', () => {
      expect(renderProfileFile(richProfile())).toBe(renderProfileFile(richProfile()))
    })

    it('keeps every line inside the strictest engine line budget, comments included', () => {
      for (const line of renderProfileFile(richProfile()).split('\n')) {
        expect(line.length).toBeLessThan(STRICTEST_LINE_BUDGET)
      }
    })

    /**
     * Story 042 D2 inverts story 040's give-way order, and this is where that inversion is pinned
     * end to end: the display name is decoration, the `[q2l ...]` tag is state nothing else in the
     * file records, so under budget pressure the *prose* is cut and the tag comes through whole.
     */
    it('truncates the display name rather than the command, and keeps the metadata tag whole', () => {
      const label = 'N'.repeat(200)
      const command = 'x'.repeat(900)
      const p = profile({
        id: 'truncated-comment',
        actions: [
          action({
            id: 'long',
            name: label,
            categoryId: 'weapons',
            aliasName: 'long_entry',
            commands: [{ kind: 'raw', text: command }],
          }),
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
      const tag = entryTag()
      expect(comment.endsWith(` ${tag}`)).toBe(true)

      const prose = comment.slice(0, comment.length - tag.length - 1)
      expect(prose.length).toBeGreaterThan(0)
      expect(prose.length).toBeLessThan(label.length)
      expect(label.startsWith(prose)).toBe(true)
    })

    /**
     * One step past the case above: the line leaves room for the tag but not for a single character
     * of prose plus its separating space. The name goes entirely and the tag stays - the opposite
     * of what story 040 would have done with the same line.
     */
    it('drops the display name entirely before it shortens the metadata tag', () => {
      const tag = entryTag({ cid: 'movement:forward' })
      // Sized so `bind w "<command>"  // ` plus the bare tag lands exactly on the last byte the
      // engine's line budget allows, leaving nothing at all for the name.
      const filler = STRICTEST_LINE_BUDGET - 1 - 'bind w ""  // '.length - tag.length
      const command = `+forward ${'z'.repeat(filler - '+forward '.length)}`
      const huge = action({
        id: 'drop-prose',
        name: 'A display name that has to go',
        categoryId: 'movement',
        catalogId: 'movement:forward',
        keys: keySlots({ key: 'w' }),
        commands: [{ kind: 'raw', text: command }],
      })
      const p = profile({ id: 'dropped-prose', actions: [huge], binds: { w: command } })

      const bindLine = renderProfileFile(p)
        .split('\n')
        .find((line) => line.startsWith('bind w'))!

      expect(bindLine).toBe(`bind w "${command}"  // ${tag}`)
      expect(bindLine.length).toBe(STRICTEST_LINE_BUDGET - 1)
      expect(bindLine).not.toContain('A display name')
    })

    /**
     * And one step past *that*: the tag itself no longer fits. It is dropped whole rather than cut
     * short - a truncated `[q2l` with no closing bracket reads back as malformed, which loses the
     * metadata anyway and reports the whole comment as garbage while doing it - and the line falls
     * back to exactly what story 040 would have written for it: the display name alone.
     * Unreachable through the app (a command this long is already at the engine's own line limit),
     * which is why it is handled rather than asserted away.
     */
    it('drops the metadata tag whole - never a half tag - when not even the bare tag fits', () => {
      const tag = entryTag({ cid: 'movement:forward' })
      const filler = STRICTEST_LINE_BUDGET - 1 - 'bind w ""  // '.length - tag.length + 1
      const command = `+forward ${'z'.repeat(filler - '+forward '.length)}`
      const huge = action({
        id: 'no-room',
        name: 'Forward',
        categoryId: 'movement',
        catalogId: 'movement:forward',
        keys: keySlots({ key: 'w' }),
        commands: [{ kind: 'raw', text: command }],
      })
      const p = profile({ id: 'no-room-at-all', actions: [huge], binds: { w: command } })

      const bindLine = renderProfileFile(p)
        .split('\n')
        .find((line) => line.startsWith('bind w'))!

      expect(bindLine).toBe(`bind w "${command}"  // Forward`)
      expect(bindLine).not.toContain('[q2l')
      expect(bindLine.length).toBeLessThan(STRICTEST_LINE_BUDGET)
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
        keys: keySlots({ key: 'w' }),
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
        keys: keySlots({ key: 'a' }),
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
     * `findCvar` matches case-insensitively, so two spellings of one cvar are one cvar. Since story
     * 048 D2 the pair must collapse to a single `set` line: a second line for the same cvar would
     * now be a *default* rendering after the user's real value and winning at exec time (the engine
     * runs the whole file top to bottom, last `set` wins), which is a silent clobber rather than a
     * cosmetic duplicate. The surviving line is the spelling that sorts last - the one that already
     * rendered last, and therefore already won, before this change - and the choice cannot depend on
     * `Object.keys` insertion order (AC5: "never insertion-order-dependent").
     */
    it('collapses two differently-cased spellings of one cvar into a single set line', () => {
      const forward = renderProfileFile(profile({ cvars: { sensitivity: '3', Sensitivity: '4' } }))
      const reversed = renderProfileFile(profile({ cvars: { Sensitivity: '4', sensitivity: '3' } }))

      expect(forward).toBe(reversed)
      expect(setLines(forward).filter((line) => /^set sensitivity\b/i.test(line))).toEqual([
        'set sensitivity "3"',
      ])
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
          actions: [
            action({
              id: 'long-cat',
              name: 'E',
              categoryId: 'cat-long',
              keys: keySlots({ key: 'z' }),
              aliasName: 'e',
            }),
          ],
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
