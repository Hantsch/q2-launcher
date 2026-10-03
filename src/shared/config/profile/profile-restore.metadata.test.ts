import { describe, expect, it } from 'vitest'
import { buildImportedActions } from '@shared/config/aliases/alias-import'
import { META_FORMAT_VERSION, formatMetaTag } from '@shared/config/profile/profile-metadata'
import { HAND_EDIT_SENTENCE } from '@shared/config/render/render'
import { restoreProfileParts } from '@shared/config/profile/profile-restore'
import { idFactory, doc, tagged, keysOf } from './profile-restore.test-helpers'

describe('restoreProfileParts - the story-051 banner header', () => {
  const file0 = 'q2l-profile-src.cfg'

  it('reads ownership off the header tag and consumes all four header lines', () => {
    const file = doc()
    file.bannerHeader('profile-9')
    file.header('Aliases: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.alias('rl', 'use rocket launcher', tagged('RL'))

    const result = file.restore()

    // The tag's `id` is what `import.ts` turns into `ownWrittenFile` - without it a new-shape file
    // would import as a foreign config, since no sentinel line is written any more.
    expect(result.sourceProfileId).toBe('profile-9')
    expect(result.metadataVersion).toBe(META_FORMAT_VERSION)
    expect(result.warnings).toEqual([])
    // Still reported, never adopted (AC4).
    expect(result.actions.map((action) => action.id)).not.toContain('profile-9')
    // All four header lines are understood, so `preservedLinesFor` (import.ts) subtracts every one
    // of them from the preview's `preserved` list - AC5's "none of the four appears there".
    for (const line of [1, 2, 3, 4]) {
      expect(result.consumedCommentLines).toContainEqual({ file: file0, line })
    }
    // And the name line between the two rules invented no section of its own: the file's one real
    // category is the only one minted.
    expect(result.categories.map((category) => category.name)).toEqual(['Weapons'])
  })

  it('lets the profile file`s own header outvote the loader`s sentinel', () => {
    // The real read order: `autoexec.cfg` is the entry file and carries a sentinel naming whichever
    // profile is the installation's default; the profile file it `exec`s carries the banner header.
    const loader = doc('autoexec.cfg')
    loader.sentinel('installation-default')

    const profileFile = doc('q2l-profile-p9.cfg')
    profileFile.bannerHeader('p9')
    profileFile.header('Aliases: Weapons', formatMetaTag({ cat: 'weapons' }))
    profileFile.alias('rl', 'use rocket launcher', tagged('RL'))

    const first = loader.input()
    const second = profileFile.input()
    const result = restoreProfileParts({
      aliases: [...first.aliases, ...second.aliases],
      binds: [...first.binds, ...second.binds],
      cvars: [...first.cvars, ...second.cvars],
      comments: [...first.comments, ...second.comments],
      newId: idFactory(),
    })

    expect(result.sourceProfileId).toBe('p9')
    // The loader's own sentinel is still understood, just outvoted - it must not resurface as an
    // unrecognised leftover either.
    expect(result.consumedCommentLines).toContainEqual({ file: 'autoexec.cfg', line: 1 })
  })

  it('keeps the leftovers of a header whose closing rule was hand-deleted in `preserved`', () => {
    // `=` rule / name / tag - the rule under the name is gone, so the backward walk finds prose
    // where it expects decoration and stops there rather than guessing.
    const file = doc()
    file.headerRule()
    file.comment('  My Profile')
    file.headerTag({ v: String(META_FORMAT_VERSION), id: 'profile-9' })
    file.header('Aliases: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.alias('rl', 'use rocket launcher', tagged('RL'))

    const result = file.restore()

    // Ownership rides on the tag line and is unaffected by the mangled decoration around it.
    expect(result.sourceProfileId).toBe('profile-9')
    expect(result.consumedCommentLines).toContainEqual({ file: file0, line: 3 })
    // The two lines the writer's shape no longer accounts for stay visible instead.
    expect(result.consumedCommentLines).not.toContainEqual({ file: file0, line: 1 })
    expect(result.consumedCommentLines).not.toContainEqual({ file: file0, line: 2 })
    // And neither of them was read as a section header: only the file's real category is minted,
    // and the entry is still filed under it.
    expect(result.categories.map((category) => category.name)).toEqual(['Weapons'])
    expect(result.actions).toHaveLength(1)
    expect(result.actions[0]!.categoryId).toBe('weapons')
  })

  it('keeps the name line of a header whose opening rule was hand-deleted in `preserved`', () => {
    // name / `=` rule / tag - the adjacent rule still matches and is consumed, the name line above
    // it is not: without both rules around it, nothing identifies that arbitrary prose as ours.
    const file = doc()
    file.comment('  My Profile')
    file.headerRule()
    file.headerTag({ v: String(META_FORMAT_VERSION), id: 'profile-9' })
    file.header('Aliases: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.alias('rl', 'use rocket launcher', tagged('RL'))

    const result = file.restore()

    expect(result.sourceProfileId).toBe('profile-9')
    expect(result.consumedCommentLines).toContainEqual({ file: file0, line: 3 })
    expect(result.consumedCommentLines).toContainEqual({ file: file0, line: 2 })
    expect(result.consumedCommentLines).not.toContainEqual({ file: file0, line: 1 })
    expect(result.categories.map((category) => category.name)).toEqual(['Weapons'])
  })

  it('still consumes the legacy header block forward from its name+tag line', () => {
    // Pre-051: `=` rule / name+tag / hand-edit sentence / `=` rule. The tag sits in the middle and
    // carries no `id`, so ownership comes from the sentinel line above the block, exactly as before.
    const file = doc()
    file.sentinel('profile-42')
    file.headerRule()
    file.version()
    file.comment(` ${HAND_EDIT_SENTENCE}`)
    file.headerRule()
    file.header('Aliases: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.alias('rl', 'use rocket launcher', tagged('RL'))

    const result = file.restore()

    expect(result.sourceProfileId).toBe('profile-42')
    expect(result.metadataVersion).toBe(META_FORMAT_VERSION)
    for (const line of [1, 2, 3, 4, 5]) {
      expect(result.consumedCommentLines).toContainEqual({ file: file0, line })
    }
    expect(result.categories.map((category) => category.name)).toEqual(['Weapons'])
  })
})

describe('restoreProfileParts - hand-edited and unknown metadata', () => {
  it('reports a mangled tag, loses only that line`s entry, and keeps the rest', () => {
    const file = doc()
    file.version()
    file.header('Binds: Weapons', formatMetaTag({ cat: 'weapons' }))
    // Truncated mid-tag, exactly as a hand-edit leaves it: no closing bracket.
    file.bind('q', 'ssg_sg', ' SSG + SG [q2l cid=')
    file.bind('MOUSE2', 'ssg_sg', tagged('SSG + SG', { cid: 'weapon:ssg_sg' }))

    const result = file.restore()

    expect(result.warnings).toEqual([
      { reason: 'tag-malformed', file: 'q2l-profile-src.cfg', line: 3 },
    ])
    // The surviving line still rebuilds its entry with its own key; the mangled line's bind is not
    // turned into a second, invented entry and is not merged into this one either - a tag nothing
    // could be read out of no longer says whose line it is. It stays a plain bind
    // (`profile.binds` is imported from the parsed lines directly, so nothing about it is lost).
    expect(result.actions).toHaveLength(1)
    expect(keysOf(result.actions[0])).toEqual(['MOUSE2'])
  })

  it('claims a line whose tag has one garbled token among good ones', () => {
    const file = doc()
    file.version()
    file.header('Binds: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.bind('q', 'ssg_sg', ' SSG [q2l cid=weapon:ssg_sg =garbled]')

    const result = file.restore()

    expect(result.warnings.map((warning) => warning.reason)).toEqual(['tag-malformed'])
    expect(result.actions).toHaveLength(1)
    expect(result.actions[0]!.catalogId).toBe('weapon:ssg_sg')
  })

  it('reports a hand-deleted version marker but still reads the tags that are left', () => {
    const file = doc()
    file.header('Binds: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.bind('q', 'ssg_sg', tagged('SSG'))

    const result = file.restore()

    expect(result.metadataVersion).toBeNull()
    expect(result.warnings).toEqual([
      expect.objectContaining({ reason: 'metadata-version-missing' }),
    ])
    expect(result.actions).toHaveLength(1)
  })

  it('parses what it recognises from a newer format version, and says so', () => {
    const file = doc()
    file.version(META_FORMAT_VERSION + 1)
    file.header('Binds: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.bind('q', 'ssg_sg', tagged('SSG', { wobble: 'yes' }))

    const result = file.restore()

    expect(result.metadataVersion).toBe(META_FORMAT_VERSION + 1)
    expect(result.warnings.map((warning) => warning.reason)).toEqual([
      'metadata-version-newer',
      'tag-unknown-keys',
    ])
    expect(result.warnings[1]!.subject).toBe('wobble')
    // Everything the registry does know still came back.
    expect(result.actions[0]).toMatchObject({ name: 'SSG', kind: 'bind', keys: [{ key: 'q' }] })
  })

  it('reports a leftover `e`/`slot` from a hand-edit as an unknown key and reads the line anyway', () => {
    // Story 050 dropped all three keys from the registry, so a field copied out of a pre-050 file
    // is now simply unknown: reported, round-tripped, and ignored for reconstruction.
    const file = doc()
    file.version()
    file.header('Binds: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.bind('q', 'ssg_sg', tagged('SSG', { e: 'b8df77ed', k: 'bind', slot: '2' }))

    const result = file.restore()

    expect(result.warnings).toEqual([
      { reason: 'tag-unknown-keys', file: 'q2l-profile-src.cfg', line: 3, subject: 'e,k,slot' },
    ])
    // `slot=2` says nothing any more - file order does, and this is the entry's first claim.
    expect(keysOf(result.actions[0])).toEqual(['q'])
  })

  it('reports a `v` that is not a version at all', () => {
    const file = doc()
    file.comment(`  My Profile ${formatMetaTag({ v: 'banana' })}`)
    file.bind('q', 'ssg_sg', tagged('SSG'))

    const result = file.restore()

    expect(result.metadataVersion).toBeNull()
    expect(result.warnings.map((warning) => warning.reason)).toContain('metadata-version-invalid')
    expect(result.actions).toHaveLength(1)
  })

  it('reports a hand-added alias line with no tag and imports it from its plain definition', () => {
    const file = doc()
    file.version()
    file.header('Aliases: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.alias('rl', 'use rocket launcher', tagged('RL'))
    file.alias('my_macro', 'say hi; wave 1')

    const result = file.restore()

    expect(result.warnings).toEqual([
      { reason: 'tag-missing', file: 'q2l-profile-src.cfg', line: 4 },
    ])
    expect(result.actions.map((action) => action.aliasName)).toEqual(['rl', 'my_macro'])
  })

  // Story 053 D4: two adjacent untagged banners used to be read as two independent plain sections
  // (D3's own stopgap, since the `Main / Sub` string-fusion that read them before it went with the
  // rest of the read-only second level). Now that the model has a real second level
  // (`ConfigActionCategory.subcategories`), an untagged pair like this - a foreign author's own
  // category header, followed by two untagged banners in a decoration this writer never uses itself
  // (`-`/`=` are `BANNER_RULE`'s own, deliberately excluded - see `decorationWrap`'s doc comment) that
  // recurs at least twice - is promoted into a real category + sub-categories instead, via the
  // repeated-decoration heuristic.
  it('promotes an adjacent untagged pair into a category with real sub-categories', () => {
    const file = doc()
    file.version()
    file.header('Main Key`s')
    file.comment(' ##### 1st row #####')
    file.bind('1', 'weapon_1', tagged('Blaster'))
    file.comment(' ##### 2nd row #####')

    const result = file.restore()

    expect(result.categories).toEqual([
      {
        id: 'id1',
        name: 'Main Key`s',
        subcategories: [
          { id: 'id2', name: '1st row' },
          { id: 'id3', name: '2nd row' },
        ],
      },
    ])
    expect(result.actions[0]!.categoryId).toBe('id1')
    expect(result.actions[0]!.subcategoryId).toBe('id2')
    // No string-fused name anywhere - the two levels are structural, not concatenated prose.
    expect(result.categories.map((category) => category.name)).not.toContain('Main Key`s / 1st row')
  })

  it('does not promote a single stray decorated comment - its decoration is not repeated', () => {
    const file = doc()
    file.version()
    file.header('Aliases: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.alias('rl', 'use rocket launcher', tagged('RL'))
    file.comment(' ##### stray row #####')

    const result = file.restore()

    // The category the tag states still mints, exactly as ever; the stray decorated comment mints
    // nothing at all - it is not even a plain section, since its decoration (`#`) occurs on no other
    // line in this file.
    expect(result.categories).toEqual([
      { id: 'weapons', name: 'Weapons', nameKey: 'config.controls.categories.weapons' },
    ])
    expect(result.categories.some((category) => category.subcategories)).toBe(false)
  })

  it('leaves an existing category name containing " / " alone - no retroactive splitting', () => {
    const file = doc()
    file.version()
    file.header('Aliases: Old Name / Sub', formatMetaTag({ cat: 'their-cat-id' }))
    file.alias('rl', 'use rocket launcher', tagged('RL'))

    const result = file.restore()

    // A category a colleague's earlier import already fused into one name (story 042-era behaviour,
    // or a hand-typed name) is just a category whose name happens to contain " / " - read back
    // verbatim, never guessed apart into a category + sub-category.
    expect(result.categories).toEqual([{ id: 'their-cat-id', name: 'Old Name / Sub' }])
  })

  // Story 053 D4: the motivating shape - a `dm.cfg`-style file with no `[q2l …]` tag anywhere at all
  // (a genuinely foreign config), a top-level header recognised the ordinary way (`brackets` style,
  // same as AC8's own pinned fixture), and two repeated `#####`-decorated row headers beneath it.
  // AC8's own fixture (a single `1st row` banner, decoration seen once) is deliberately left
  // untouched by this - see the "produces exactly what `buildImportedActions` produces today" test
  // above, still green - this is the case where the decoration genuinely repeats.
  it('imports a wholly foreign dm.cfg-shaped file as one category with real sub-categories', () => {
    const file = doc('dm.cfg')
    file.comment(' ----- [ Main Key`s ] -----')
    file.comment(' ##### 1st row #####')
    file.alias('drop_shotgun', 'drop shotgun; say_team dropped sg; wave 1')
    file.bind('KP_END', 'drop_shotgun')
    file.comment(' ##### 2nd row #####')
    file.alias('gg', 'say gg')
    file.bind('KP_DOWNARROW', 'gg')

    const result = file.restore()

    expect(result.categories).toHaveLength(1)
    const [category] = result.categories
    expect(category!.name).toBe('Main Key`s')
    expect(category!.name).not.toContain('/')
    expect(category!.subcategories?.map((sub) => sub.name)).toEqual(['1st row', '2nd row'])

    const dropShotgun = result.actions.find((action) => action.aliasName === 'drop_shotgun')
    const gg = result.actions.find((action) => action.aliasName === 'gg')
    expect(dropShotgun!.categoryId).toBe(category!.id)
    expect(gg!.categoryId).toBe(category!.id)
    expect(dropShotgun!.subcategoryId).toBe(category!.subcategories![0]!.id)
    expect(gg!.subcategoryId).toBe(category!.subcategories![1]!.id)
    expect(result.metadataVersion).toBeNull()
  })

  // Story 053 D4, review finding 1: the same file as the case above, but with the top-level header
  // in the decoration the story, AC6 and `dm.cfg` itself actually use - `.: Main Key`s :.`, a
  // mirrored punctuation wrap - instead of a dash-decorated banner this writer would have drawn
  // itself. That header matches neither `BANNER_RULE` nor `CATEGORY_TITLE_PREFIX`, so it opened no
  // section at all and left the `#####` markers below it with no category-shaped parent to attach to:
  // the whole file fell back to `buildImportedActions`' content guess (one `Weapons` category, no
  // sub-categories). `mirroredWrapTitle` is what recognises it now.
  it('imports a foreign file whose top-level header is a mirrored punctuation wrap', () => {
    const file = doc('dm.cfg')
    file.comment(' .: Main Key`s :.')
    file.comment(' ##### 1st row #####')
    file.alias('row1a', 'use blaster')
    file.bind('1', 'row1a')
    file.comment(' ##### 2nd row #####')
    file.alias('row2a', 'use rocket launcher')
    file.bind('q', 'row2a')

    const result = file.restore()

    expect(result.categories).toHaveLength(1)
    const [category] = result.categories
    // The decoration is stripped the way every other header's is - the name is what the file says,
    // never the drawing around it.
    expect(category!.name).toBe('Main Key`s')
    expect(category!.subcategories?.map((sub) => sub.name)).toEqual(['1st row', '2nd row'])

    const row1 = result.actions.find((action) => action.aliasName === 'row1a')
    const row2 = result.actions.find((action) => action.aliasName === 'row2a')
    expect(row1!.categoryId).toBe(category!.id)
    expect(row2!.categoryId).toBe(category!.id)
    expect(row1!.subcategoryId).toBe(category!.subcategories![0]!.id)
    expect(row2!.subcategoryId).toBe(category!.subcategories![1]!.id)
    // AC6's own words: a real second level, not a name with a slash in it.
    expect(category!.name).not.toContain('/')
  })

  // The mirrored wrap is a *recognition* rule and nothing more: it opens the same untagged `plain`
  // section a `--- Upper Row ---` banner opens, one level, no promotion, no name fusion - and, like
  // that one, mints a category only because an entry is filed under it.
  it('reads a mirrored-wrap header on its own as one plain category, no sub-categories', () => {
    const file = doc()
    file.version()
    file.comment(' <<: Upper Row :>>')
    file.bind('KP_END', 'gg', tagged('GG'))

    const result = file.restore()

    expect(result.categories.map((category) => category.name)).toEqual(['Upper Row'])
    expect(result.categories.some((category) => category.subcategories)).toBe(false)
    expect(result.actions[0]!.subcategoryId).toBeUndefined()
  })

  it('mints nothing for a section no entry is filed under', () => {
    const file = doc()
    file.version()
    file.header('Mouse')
    file.cvar('sensitivity', '4.5')
    file.header('Aliases: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.alias('rl', 'use rocket launcher', tagged('RL'))

    // The `Mouse` cvar-group banner mints nothing (no entry is filed under it); the one section that
    // does hold an entry mints exactly one category - story 052 D4, where a template id is minted
    // like any other rather than adopted invisibly.
    expect(file.restore().categories).toEqual([
      { id: 'weapons', name: 'Weapons', nameKey: 'config.controls.categories.weapons' },
    ])
  })

  it('files a tagged line that sits under no header at all in one fallback drawer, and says so', () => {
    const file = doc()
    file.version()
    file.bind('q', 'ssg_sg', tagged('SSG'))
    file.bind('e', 'rl', tagged('RL'))

    const result = file.restore()

    // One shared fallback drawer, minted after the first entry's own id.
    expect(result.categories).toEqual([{ id: 'id2', name: 'Imported' }])
    expect(result.actions.map((action) => action.categoryId)).toEqual(['id2', 'id2'])
    // The warning names the entry by what the text identified it as - the bind value, since these
    // lines have no alias line of their own.
    expect(result.warnings).toEqual([
      { reason: 'entry-section-unknown', file: 'q2l-profile-src.cfg', line: 2, subject: 'ssg_sg' },
      { reason: 'entry-section-unknown', file: 'q2l-profile-src.cfg', line: 3, subject: 'rl' },
    ])
  })
})

describe('restoreProfileParts - a file with no metadata at all', () => {
  it('produces exactly what `buildImportedActions` produces today', () => {
    // AC8 is a no-regression criterion, so the untagged path must not go through new code. Compared
    // against the 041 function directly, with an identical id factory, so a divergence cannot hide.
    const file = doc('dmalias.cfg')
    file.comment(' ----- [ Main Key`s ] -----')
    file.comment(' --- 1st row ---')
    file.alias('drop_shotgun', 'drop shotgun; say_team dropped sg; wave 1')
    file.alias('gg', 'say gg')
    file.alias('blaster_settings', '')
    file.alias('cali', 'bind KP_END drop_shotgun; bind KP_DOWNARROW gg')
    file.bind('KP_END', 'drop_shotgun')
    file.bind('c', 'cali')
    file.cvar('sensitivity', '4.5')

    const input = file.input({ newId: idFactory(), layerAliases: ['cali'] })
    const restored = restoreProfileParts(input)
    const expected = buildImportedActions({
      aliases: input.aliases.map(({ name, body, file: from, line }) => ({
        name,
        body,
        file: from,
        line,
      })),
      binds: Object.fromEntries(input.binds.map((bind) => [bind.key, bind.command])),
      layerAliases: ['cali'],
      newId: idFactory(),
    })

    expect(restored.actions).toEqual(expected.actions)
    expect(restored.categories).toEqual(expected.categories)
    expect(restored.layers).toEqual(expected.layers)
    expect(restored.ambiguous).toEqual(expected.ambiguous)
    expect(restored.warnings).toEqual([])
    expect(restored.metadataVersion).toBeNull()
  })

  it('still reports an ownership sentinel it found on the way past', () => {
    const file = doc('autoexec.cfg')
    file.sentinel('profile-7')
    file.alias('gg', 'say gg')

    expect(file.restore().sourceProfileId).toBe('profile-7')
  })
})

/**
 * Story 045, D7 - the two-part entry kinds and the `wait` command kind, read back out of a
 * launcher-written file with no `k` tag to say what kind an entry is (story 050 removed it). Every
 * case here is written the way `render.ts`/`alias-render.ts` really write the family: the state
 * lines carry the entry's one display prose plus their own `lbl`, the dispatch line carries the
 * plain tag, and a bind line points at what `bindValueFor` mirrors (the dispatch for a toggle, the
 * `+` half verbatim for a pair).
 */
