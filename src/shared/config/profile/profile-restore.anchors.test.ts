import { describe, expect, it } from 'vitest'
import { formatMetaTag } from '@shared/config/profile/profile-metadata'
import { doc, tagged, slotsOf, keysOf } from './profile-restore.test-helpers'

describe('restoreProfileParts - anchor lines and how they find their entry', () => {
  /** The file `render.ts` writes for an entry bound only through a modifier: an anchor line under
   * its own category section, and the ALT layer that actually carries the binding. */
  function anchoredFile(): ReturnType<typeof doc> {
    const file = doc()
    file.version()
    file.header('Entries: Movement', formatMetaTag({ cat: 'movement' }))
    file.comment(tagged('Forward', { cid: 'forward', key: 'w', mod: 'ALT' }))
    file.header(
      'Layer: Alt (hold, on ALT)',
      formatMetaTag({ layer: 'remote-alt', mode: 'hold', trigger: 'ALT' }),
    )
    file.alias('+alt', 'bind w +forward', ' Alt')
    file.alias('-alt', 'unbind w', ' Alt')
    file.bind('ALT', '+alt', ' Alt')
    return file
  }

  it('rebuilds an entry that has no alias line and no bind line anywhere in the file', () => {
    const result = anchoredFile().restore()

    expect(result.warnings).toEqual([])
    expect(result.actions).toEqual([
      {
        id: 'id1',
        categoryId: 'movement',
        name: 'Forward',
        kind: 'bind',
        // Taken from the layer override the anchor names - the only place the file records what this
        // entry does, since it has no alias line to hold a body.
        commands: [{ kind: 'raw', text: '+forward' }],
        catalogId: 'forward',
        keys: [{ key: 'w', modifier: 'ALT' }],
      },
    ])
    // The override stays on the layer: it is a derived mirror of that same slot.
    expect(result.layers[0]!.overrides).toEqual({ w: '+forward' })
  })

  it('does not hand the same override to a second slot as well', () => {
    const [action] = anchoredFile().restore().actions

    expect(slotsOf(action)).toHaveLength(1)
  })

  it('pairs an anchor with its entry by `cid`, even when the two proses differ', () => {
    // D7's first anchor clause: `cid` is checked before prose, so a catalogue-backed entry survives
    // a display name that drifted between its bind line and its anchor.
    const file = doc()
    file.version()
    file.header('Binds: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.bind('r', 'rl', tagged('Rocket launcher', { cid: 'weapon:rl' }))
    file.header('Entries: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.comment(tagged('RL (renamed)', { cid: 'weapon:rl', key: 'g', mod: 'CTRL' }))

    const result = file.restore()

    expect(result.actions).toHaveLength(1)
    expect(slotsOf(result.actions[0])).toEqual([{ key: 'r' }, { key: 'g', modifier: 'CTRL' }])
    // The bind line's own prose still names the entry - the alias/bind line comes first.
    expect(result.actions[0]!.name).toBe('Rocket launcher')
  })

  it('pairs a `cid`-less anchor with its entry by display prose', () => {
    // D7's second anchor clause: a user-made entry has no catalogue link, so its anchor's only tie
    // to it is the display name both lines carry.
    const file = doc()
    file.version()
    file.header('Aliases: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.alias('quad_rl', 'use rocket launcher; say_team quad', tagged('Quad RL'))
    file.header('Entries: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.comment(tagged('Quad RL', { key: 'g', mod: 'SHIFT' }))

    const result = file.restore()

    expect(result.actions).toHaveLength(1)
    expect(result.actions[0]!.aliasName).toBe('quad_rl')
    expect(slotsOf(result.actions[0])).toEqual([{ key: 'g', modifier: 'SHIFT' }])
  })

  it('never merges two entries because one name is a prefix of the other (review finding 1)', () => {
    // The prose match is *exact* and nothing wider. A prefix relation (the removed third step)
    // matched `Reload` against its sibling `Reload weapon` here and folded the two into one entry:
    // one of them lost its name, its commands and its bind in one go, with no warning at all. Both
    // entries survive, each with its own line, and the anchor lands on the one it names exactly.
    const file = doc()
    file.version()
    file.header('Aliases: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.alias('reload', 'use shotgun; +attack', tagged('Reload'))
    file.alias('reload_weapon', 'weapnext; +attack', tagged('Reload weapon'))
    file.header('Entries: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.comment(tagged('Reload weapon', { key: 'b', mod: 'ALT' }))

    const result = file.restore()

    expect(result.actions.map((action) => action.name)).toEqual(['Reload', 'Reload weapon'])
    expect(result.actions.map((action) => action.aliasName)).toEqual(['reload', 'reload_weapon'])
    expect(slotsOf(result.actions[0])).toEqual([])
    expect(slotsOf(result.actions[1])).toEqual([{ key: 'b', modifier: 'ALT' }])
    // Both bodies are still there - the merge used to keep only the first line's.
    expect(result.actions[1]!.commands).toEqual([
      { kind: 'raw', text: 'weapnext' },
      { kind: 'raw', text: '+attack' },
    ])
  })

  it('splits an anchor whose prose is only a prefix of its entry`s off as its own entry', () => {
    // The other side of the same coin: with the prefix step gone, an anchor whose prose is a
    // *truncation* of the entry's own no longer pairs with it - it becomes its own row, the same
    // accepted drift an inconsistent hand-rename produces (see the test below). Nothing is lost:
    // both the alias line's entry and the anchor's entry survive with their own keys.
    const file = doc()
    file.version()
    file.header('Aliases: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.alias('combo', 'use bfg10k; say_team big one incoming', tagged('Quad damage BFG combo'))
    file.header('Entries: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.comment(tagged('Quad damage BFG', { key: 'b', mod: 'ALT' }))

    const result = file.restore()

    expect(result.actions.map((action) => action.name)).toEqual([
      'Quad damage BFG combo',
      'Quad damage BFG',
    ])
    expect(slotsOf(result.actions[1])).toEqual([{ key: 'b', modifier: 'ALT' }])
  })

  it('splits an inconsistently renamed anchor off as its own entry, losing no line', () => {
    // D7's fourth acceptance clause, and the drift the User accepted: the anchor's prose was
    // hand-edited to something that is neither the entry's name nor a prefix of it, and the entry
    // has no `cid` to fall back on. Two rows, no crash, and every config line still accounted for.
    const file = doc()
    file.version()
    file.header('Aliases: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.alias('quad_rl', 'use rocket launcher', tagged('Quad RL'))
    file.header('Entries: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.comment(tagged('Something else entirely', { an: 'quad_rl', key: 'g', mod: 'SHIFT' }))
    file.header(
      'Layer: Alt (hold, on SHIFT)',
      formatMetaTag({ layer: 'l-s', mode: 'hold', trigger: 'SHIFT' }),
    )
    file.alias('+shifted', 'bind g quad_rl', ' Shifted')
    file.alias('-shifted', 'unbind g', ' Shifted')
    file.bind('SHIFT', '+shifted', ' Shifted')

    const result = file.restore()

    expect(result.actions.map((action) => action.name)).toEqual([
      'Quad RL',
      'Something else entirely',
    ])
    // The alias line's entry keeps its own line and its own name; the anchor's entry keeps the key
    // and modifier the anchor recorded. Nothing was dropped and nothing was merged.
    expect(slotsOf(result.actions[0])).toEqual([])
    expect(slotsOf(result.actions[1])).toEqual([{ key: 'g', modifier: 'SHIFT' }])
    expect(result.actions[1]!.aliasName).toBe('quad_rl')
    // The anchor line is still reported as understood, so it does not also show up as an
    // unrecognised leftover in the import preview.
    expect(result.consumedCommentLines).toEqual(
      expect.arrayContaining([{ file: 'q2l-profile-src.cfg', line: 5 }]),
    )
  })

  it('gives an anchor whose prose matches two entries its own entry rather than guessing', () => {
    const file = doc()
    file.version()
    file.header('Aliases: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.alias('rl_a', 'use rocket launcher', tagged('Rocket'))
    file.alias('rl_b', 'use rocket launcher; wave 1', tagged('Rocket'))
    file.header('Entries: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.comment(tagged('Rocket', { key: 'g', mod: 'ALT' }))

    const result = file.restore()

    expect(result.actions).toHaveLength(3)
    expect(slotsOf(result.actions[2])).toEqual([{ key: 'g', modifier: 'ALT' }])
  })

  it('keeps an anchor out of an entry that sits in another category', () => {
    // The match is scoped to the anchor's own section, so a same-named entry in a different category
    // is not a candidate at all.
    const file = doc()
    file.version()
    file.header('Aliases: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.alias('quad_rl', 'use rocket launcher', tagged('Quad RL'))
    file.header('Entries: Movement', formatMetaTag({ cat: 'movement' }))
    file.comment(tagged('Quad RL', { key: 'g', mod: 'ALT' }))

    const result = file.restore()

    expect(result.actions).toHaveLength(2)
    expect(result.actions[0]!.categoryId).toBe('weapons')
    expect(result.actions[1]!.categoryId).toBe('movement')
  })

  it('joins a second anchor of one anchor-only entry onto the first one`s entry', () => {
    // An entry whose every slot is modified has no alias and no bind line at all, only its anchors.
    // The second one has to find the group the first one created, or the entry comes back split.
    const file = doc()
    file.version()
    file.header('Entries: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.comment(tagged('Next weapon', { an: 'weapnext', key: 'MWHEELUP', mod: 'ALT' }))
    file.comment(tagged('Next weapon', { an: 'weapnext', key: 'MWHEELDOWN', mod: 'CTRL' }))

    const result = file.restore()

    expect(result.actions).toHaveLength(1)
    expect(slotsOf(result.actions[0])).toEqual([
      { key: 'MWHEELUP', modifier: 'ALT' },
      { key: 'MWHEELDOWN', modifier: 'CTRL' },
    ])
  })

  it('takes the own alias name off an anchor`s `an` field when no alias line carries it', () => {
    const file = doc()
    file.version()
    file.header('Entries: Weapons', formatMetaTag({ cat: 'weapons' }))
    // The self-mirroring shape story 039 drops the alias line for: nothing in the file spells
    // `weapnext` as code, so the tag is the only place the entry's own alias name can live.
    file.comment(tagged('Next weapon', { an: 'weapnext', key: 'MWHEELUP', mod: 'ALT' }))
    file.header(
      'Layer: Alt (hold, on ALT)',
      formatMetaTag({ layer: 'l-alt', mode: 'hold', trigger: 'ALT' }),
    )
    file.alias('+alt', 'bind MWHEELUP weapnext', ' Alt')
    file.alias('-alt', 'unbind MWHEELUP', ' Alt')
    file.bind('ALT', '+alt', ' Alt')

    const result = file.restore()

    expect(result.warnings).toEqual([])
    expect(result.actions).toEqual([
      {
        id: 'id1',
        categoryId: 'weapons',
        name: 'Next weapon',
        kind: 'bind',
        commands: [{ kind: 'raw', text: 'weapnext' }],
        keys: [{ key: 'MWHEELUP', modifier: 'ALT' }],
        aliasName: 'weapnext',
      },
    ])
  })

  it('reads no entry out of a comment that carries no `key`, and keeps the line preserved', () => {
    // Story 050: `key` is the anchor discriminator, and only anchors ever carry one. A comment-only
    // line with a `cid` but no `key` is therefore not an anchor - the writer emits no such line
    // (`render.ts#buildAnchorLines`), and reading one as a keyless, commandless entry would hand
    // `catalog-binds.ts#applySlot` an empty base to spread on the next bind of that catalogue row.
    // The line is not consumed either, so it stays visible in the import preview's `preserved` list
    // instead of being lost.
    const file = doc()
    file.version()
    file.header('Entries: Movement', formatMetaTag({ cat: 'movement' }))
    file.comment(tagged('Strafe left', { cid: 'moveleft' }))

    const result = file.restore()

    expect(result.actions).toEqual([])
    expect(result.consumedCommentLines).not.toEqual(
      expect.arrayContaining([{ file: 'q2l-profile-src.cfg', line: 3 }]),
    )
  })

  it('ignores a `key` on a section header or on the version marker', () => {
    const file = doc()
    file.version()
    // A hand-edited `key` on a *section* header is not an entry anchor.
    file.header('Binds: Weapons', formatMetaTag({ key: 'g', cat: 'weapons' }))
    file.bind('q', 'ssg_sg', tagged('SSG'))

    const result = file.restore()

    expect(result.actions.map((entry) => entry.name)).toEqual(['SSG'])
    expect(result.actions[0]!.categoryId).toBe('weapons')
  })
})

describe('restoreProfileParts - unbound lines (story 052 D3)', () => {
  /**
   * One unbound line exactly as `render.ts#unboundLine` writes it, marker stripped the way
   * `config-parser.ts` hands a comment-only line over: the whole `bind` command commented out, then
   * the same `  // <prose> [q2l …]` trailing comment every other entry line carries.
   */
  function unbound(command: string, prose: string, fields: Record<string, string> = {}): string {
    return `bind "${command}"  //${tagged(prose, fields)}`
  }

  it('rebuilds an entry that has no line at all but its unbound one, command included', () => {
    const file = doc()
    file.version()
    file.header('Entries: Movement', formatMetaTag({ cat: 'movement' }))
    file.comment(unbound('+moveleft', 'Strafe left', { cid: 'movement:moveleft' }))

    const result = file.restore()

    expect(result.warnings).toEqual([])
    expect(result.actions).toEqual([
      {
        id: 'id1',
        // From the section the line sits in, exactly as an anchor's category is.
        categoryId: 'movement',
        name: 'Strafe left',
        kind: 'bind',
        // The point of the whole shape: the body carries what the entry runs, so this is not the
        // `commands: []` the reverted 042 "entry anchor" came back with.
        commands: [{ kind: 'raw', text: '+moveleft' }],
        catalogId: 'movement:moveleft',
      },
    ])
    expect(keysOf(result.actions[0])).toEqual([])
  })

  it('claims the line, so it never reaches the import preview`s preserved list', () => {
    const file = doc()
    file.version()
    file.header('Entries: Movement', formatMetaTag({ cat: 'movement' }))
    file.comment(unbound('+moveleft', 'Strafe left', { cid: 'movement:moveleft' }))

    // `import.ts#preservedLinesFor` subtracts exactly this list from what the dialog calls
    // "preserved" - a launcher-owned line the reader fully understood is the opposite of "we did
    // not understand this, so we kept it verbatim".
    expect(file.restore().consumedCommentLines).toContainEqual({
      file: 'q2l-profile-src.cfg',
      line: 3,
    })
  })

  it('reads `//bind ""` as an entry that genuinely has no commands', () => {
    const file = doc()
    file.version()
    file.header('Entries: Movement', formatMetaTag({ cat: 'movement' }))
    // The shape most of `STANDARD_TEMPLATE`'s seeded rows have (story 052 D1): a real row, with a
    // name and a catalogue id, that the user has not given a command yet.
    file.comment(unbound('', 'Crouch', { cid: 'movement:crouch' }))

    const result = file.restore()

    expect(result.actions).toEqual([
      {
        id: 'id1',
        categoryId: 'movement',
        name: 'Crouch',
        kind: 'bind',
        commands: [],
        catalogId: 'movement:crouch',
      },
    ])
  })

  it('keeps two commandless rows in one category apart instead of folding them into one', () => {
    // The collapse this shape invites: keyed on what the line says - an empty bind value - every
    // seeded row of a template profile is the same key. Each unbound line gets a group of its own
    // for exactly that reason.
    const file = doc()
    file.version()
    file.header('Entries: Movement', formatMetaTag({ cat: 'movement' }))
    file.comment(unbound('', 'Crouch', { cid: 'movement:crouch' }))
    file.comment(unbound('', 'Jump', { cid: 'movement:jump' }))

    const result = file.restore()

    expect(result.actions.map((entry) => entry.name)).toEqual(['Crouch', 'Jump'])
    expect(result.actions.map((entry) => entry.catalogId)).toEqual([
      'movement:crouch',
      'movement:jump',
    ])
  })

  it('takes the entry`s own alias name off the line`s `an` field', () => {
    const file = doc()
    file.version()
    file.header('Entries: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.comment(unbound('weapnext', 'Next weapon', { an: 'weapnext' }))

    const result = file.restore()

    expect(result.actions[0]!.aliasName).toBe('weapnext')
    expect(result.actions[0]!.commands).toEqual([{ kind: 'raw', text: 'weapnext' }])
  })

  it('leaves a bound entry and its lines exactly as they were', () => {
    // The no-regression half: the same file carries an ordinary alias+bind entry next to the
    // unbound one, and neither reads the other's lines.
    const file = doc()
    file.version()
    file.header('Aliases: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.alias(
      'ssg_sg',
      'use super shotgun; use shotgun',
      tagged('SSG + SG', { cid: 'weapon:ssg_sg' }),
    )
    file.header('Binds: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.bind('q', 'ssg_sg', tagged('SSG + SG', { cid: 'weapon:ssg_sg' }))
    file.header('Entries: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.comment(unbound('+attack', 'Attack', { cid: 'weapon:attack' }))

    const result = file.restore()

    expect(result.warnings).toEqual([])
    expect(result.actions).toEqual([
      {
        id: 'id1',
        categoryId: 'weapons',
        name: 'SSG + SG',
        kind: 'bind',
        commands: [
          { kind: 'raw', text: 'use super shotgun' },
          { kind: 'raw', text: 'use shotgun' },
        ],
        catalogId: 'weapon:ssg_sg',
        keys: [{ key: 'q' }],
        aliasName: 'ssg_sg',
      },
      {
        id: 'id2',
        categoryId: 'weapons',
        name: 'Attack',
        kind: 'bind',
        commands: [{ kind: 'raw', text: '+attack' }],
        catalogId: 'weapon:attack',
      },
    ])
  })

  it('does not let an anchor line of another entry land on an unbound one', () => {
    // An unbound entry has no key slot at all - that is why it got this line rather than an anchor -
    // so an anchor, which is nothing but a key claim, must never be matched onto it, not even when
    // the two share a `cid`. The anchor keeps its own entry instead.
    const file = doc()
    file.version()
    file.header('Entries: Movement', formatMetaTag({ cat: 'movement' }))
    file.comment(unbound('+moveleft', 'Strafe left', { cid: 'movement:moveleft' }))
    file.comment(tagged('Strafe left', { cid: 'movement:moveleft', key: 'a', mod: 'ALT' }))

    const result = file.restore()

    expect(result.actions).toHaveLength(2)
    const [unboundEntry, anchored] = result.actions
    expect(unboundEntry!.commands).toEqual([{ kind: 'raw', text: '+moveleft' }])
    expect(keysOf(unboundEntry)).toEqual([])
    expect(slotsOf(anchored)).toEqual([{ key: 'a', modifier: 'ALT' }])
  })

  it('is not read as a section banner when its display name carries a banner rule', () => {
    // The claiming-order defect this predicate exists to prevent, in its `---` form: the prose of an
    // unbound line is a user-typed display name, so `scanComments`' decoration test would have taken
    // this line for an untagged banner, minted a category named after it and re-filed the line below
    // it under that category.
    const file = doc()
    file.version()
    file.header('Entries: Movement', formatMetaTag({ cat: 'movement' }))
    file.comment(unbound('+moveleft', 'Strafe --- left', { cid: 'movement:moveleft' }))
    file.comment(unbound('+moveright', 'Strafe right', { cid: 'movement:moveright' }))

    const result = file.restore()

    // Exactly one category - the `Entries: Movement` header's - and none named after the display
    // name: a second category here would be the very defect this predicate prevents.
    expect(result.categories).toEqual([
      { id: 'movement', name: 'Movement', nameKey: 'config.controls.categories.movement' },
    ])
    expect(result.actions.map((entry) => entry.categoryId)).toEqual(['movement', 'movement'])
    expect(result.actions.map((entry) => entry.name)).toEqual(['Strafe --- left', 'Strafe right'])
  })

  it('leaves a hand-typed comment that merely mentions a bind alone', () => {
    // Tag presence is the whole launcher-owned signal (story 050): without a `[q2l …]` this is a
    // player's own note, and reading an entry out of it would invent a row nobody created - and
    // consume a line the import preview is supposed to show.
    const file = doc()
    file.version()
    file.header('Entries: Movement', formatMetaTag({ cat: 'movement' }))
    file.comment(' bind "+moveleft" - maybe later')

    const result = file.restore()

    expect(result.actions).toEqual([])
    expect(result.consumedCommentLines).not.toContainEqual({
      file: 'q2l-profile-src.cfg',
      line: 3,
    })
  })

  it('keeps a `//` inside a quoted command out of the display prose', () => {
    // Read with the config tokenizer's own rules, so a `//` inside the quoted body is part of the
    // command rather than the start of the trailing comment.
    const file = doc()
    file.version()
    file.header('Entries: Other', formatMetaTag({ cat: 'chat' }))
    file.comment(unbound('say see http://q2.example', 'Site'))

    const result = file.restore()

    expect(result.actions[0]!.name).toBe('Site')
    expect(result.actions[0]!.commands).toEqual([
      { kind: 'message', channel: 'say', text: 'see http://q2.example' },
    ])
  })
})

/**
 * Story 063 D2 - an unbound line **next to an alias line**.
 *
 * D1 made the writer emit both for a keyless `bind`/`message` entry with a body (the grenade rows):
 * the alias line for what the entry runs, the unbound line for the empty key slot the alias line
 * cannot record. This is the reader half - the two lines have to become *one* entry, and that entry's
 * kind has to be the keyed one the unbound line says it is. Before D2 the alias line alone was read
 * as story 019's `kind: 'alias'` ("never bound"), which took the row's bind slot away for good.
 *
 * The refusal cases matter as much as the join: every gate in `matchUnbound` fails towards two
 * separate entries, which loses nothing and stays visible, rather than towards a merge that would
 * take one row's name, body and keys with it.
 */
