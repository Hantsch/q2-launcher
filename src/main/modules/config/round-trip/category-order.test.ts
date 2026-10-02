import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { ConfigAction, ConfigProfile } from '@shared/modules/config'
import { renderProfileFile } from '@shared/config/render'
import { restoreProfileParts } from '@shared/config/profile-restore'
import {
  blockDisjointCategoryOrderProfile,
  buildFixtureProfile,
  scrambledCategoryOrderProfile,
  scrambledCvarSectionOrderProfile,
  scrambledSubcategoryOrderProfile,
} from '@shared/config/fixtures/profiles'
import { toRestoreInput } from '../import'
import {
  reimport,
  normalize,
  slotsOf,
  reimportProfile,
  findFixture,
  countConfigLines,
  expectEveryLineSurvivesRerender,
  restoreFromText,
  sortedEntryShapes,
  categoryNames,
  useRoundTripRoot,
} from './helpers'

useRoundTripRoot()

describe('sub-categories come back off the file', () => {
  /** The restored profile's sub-category names per category, and each entry's `(category,
   * sub-category)` pair - by *name*, since every id in a restored profile is freshly minted. */
  const shapeOf = (profile: ConfigProfile) => {
    const categories = new Map(
      (profile.categories ?? []).map((category) => [category.id, category]),
    )
    const nameOf = (action: ConfigAction): [string, string | null] => {
      const category = categories.get(action.categoryId)
      const sub = category?.subcategories?.find((entry) => entry.id === action.subcategoryId)
      return [category?.name ?? `<orphan:${action.categoryId}>`, sub?.name ?? null]
    }
    return {
      subcategories: (profile.categories ?? []).map((category) => [
        category.name,
        (category.subcategories ?? []).map((sub) => sub.name),
      ]),
      entries: (profile.actions ?? []).map((action) => [action.name, ...nameOf(action)]),
    }
  }

  it('"Category with two sub-categories": both levels, in order, with the ungrouped run intact', async () => {
    const profile = findFixture('Category with two sub-categories')
    const { profile2, text1 } = await reimportProfile(profile)

    // The file really does carry the second level as its own banner, in all three of the writer's
    // per-category blocks - without this the rest of the case could pass over a flat file.
    expect(text1.match(/^\/\/ --- Use weapon \[q2l sub=\S+\] -+$/gm)).toHaveLength(3)
    expect(text1.match(/^\/\/ --- Cycling \[q2l sub=\S+\] -+$/gm)).toHaveLength(3)

    expect(shapeOf(profile2)).toEqual({
      subcategories: [['Weapons', ['Use weapon', 'Cycling']]],
      entries: [
        // The ungrouped run first, exactly as the writer laid it out - the reader takes the file's
        // order, not the fixture's declaration order.
        ['Rail gun', 'Weapons', null],
        ['Fire', 'Weapons', 'Use weapon'],
        ['Blaster', 'Weapons', 'Use weapon'],
        ['Next weapon', 'Weapons', 'Cycling'],
      ],
    })
    //: the file's own `sub=` values are adopted - well-formed and unique within
    // the file - same rule as a restored category's, so the next render writes the same tags back.
    expect(profile2.categories![0]!.subcategories!.map((sub) => sub.id)).toEqual([
      'sub-use',
      'sub-cycle',
    ])
  })

  it('"Empty sub-category next to a populated one": the empty one survives with nothing under it', async () => {
    const profile = findFixture('Empty sub-category next to a populated one')
    const { profile2, text1 } = await reimportProfile(profile)

    // `Spare` really is empty in the file: each of its three banners is followed by another banner
    // (or by nothing at all), never by content. This is the shape lazy registration cannot see.
    const lines = text1.split('\n')
    const spareBanners = lines.flatMap((line, index) =>
      /^\/\/ --- Spare \[q2l sub=\S+\] -+$/.test(line) ? [index] : [],
    )
    expect(spareBanners).toHaveLength(3)
    for (const at of spareBanners) {
      const next = lines.slice(at + 1).find((line) => line.trim().length > 0)
      expect(next === undefined || next.startsWith('// ---')).toBe(true)
    }

    expect(shapeOf(profile2)).toEqual({
      subcategories: [['Movement', ['Strafing', 'Spare']]],
      entries: [
        ['Forward', 'Movement', null],
        ['Strafe left', 'Movement', 'Strafing'],
      ],
    })
  })

  it('"Two categories with sub-categories and a modifier slot": an anchored entry keeps its sub-category', async () => {
    const profile = findFixture('Two categories with sub-categories and a modifier slot')
    const { profile2, text1 } = await reimportProfile(profile)

    // The modifier-bound entry's only line is an anchor - a comment-only line sitting directly under
    // a sub-banner, which is a comment-only line too. Telling those two apart is the whole risk.
    expect(text1).toMatch(/^\/\/ Drop rockets \[q2l cid=drop-rockets key=r mod=ALT\]$/m)

    expect(shapeOf(profile2)).toEqual({
      subcategories: [
        ['Drops', ['Ammunition']],
        ['My stuff', ['Chat', 'Later']],
      ],
      // File order, which is section order: Drops first (its entry rides on an anchor line in the
      // `Entries: Drops` section), then My stuff's own ungrouped run before its `Chat` bucket - the
      // writer's "ungrouped entries first" rule read straight back off the file.
      entries: [
        ['Drop rockets', 'Drops', 'Ammunition'],
        ['Salute', 'My stuff', null],
        ['Taunt', 'My stuff', 'Chat'],
      ],
    })
    expect(slotsOf(profile2.actions!.find((entry) => entry.name === 'Drop rockets')!)).toEqual([
      'ALT+r',
    ])
  })

  /**
   * The story's own "hand-deleted `sub=`" case (the acceptance): a sub-banner whose tag a user
   * removed in the Raw File tab is no longer a sub-banner at all, and has to degrade to what it
   * still visibly is - an ordinary untagged section header - rather than throwing, swallowing the
   * lines beneath it, or being guessed back into the second level. Guessing is the job and
   * heuristic; this is what happens until then, stated rather than left to chance.
   */
  it('a hand-deleted `sub=` tag degrades to a plain category, loses no line, and settles', async () => {
    const text = renderProfileFile(findFixture('Empty sub-category next to a populated one'))
    // Every occurrence of the one sub-banner, in all three blocks - a user deleting a tag they found
    // noisy deletes it wherever they see it, and deleting only one copy would just split the entry
    // across two sections for the ordinary reason (a line belongs to the header above it).
    const mangled = text.replace(/ \[q2l sub=sub-strafe\]/g, '')
    expect(mangled).not.toBe(text)
    expect(mangled).toMatch(/^\/\/ --- Strafing -+$/m)

    const before = await reimport(text)
    const { result: after, restored, rerendered } = await restoreFromText(mangled)
    expect(countConfigLines(after)).toBe(countConfigLines(before))
    expectEveryLineSurvivesRerender(after, rerendered)

    // Degraded to a category of its own, named from the banner's own title, with the entry that sat
    // under it inside it and no `subcategoryId` left over pointing at nothing. The sub-category whose
    // tag is still intact is untouched.
    expect(restored.categories.map((category) => category.name)).toEqual(['Movement', 'Strafing'])
    expect(restored.categories[0]!.subcategories!.map((sub) => sub.name)).toEqual(['Spare'])
    expect(restored.categories[1]!.subcategories).toBeUndefined()
    const strafe = restored.actions.find((entry) => entry.name === 'Strafe left')!
    expect(strafe.categoryId).toBe(restored.categories[1]!.id)
    expect(strafe.subcategoryId).toBeUndefined()

    // And the degraded reading is itself a fixed point: whatever it settled on, it stays there
    // instead of drifting one category further on every reload.
    const { rerendered: third } = await restoreFromText(rerendered)
    expect(normalize(third)).toBe(normalize(rerendered))
  })
})

describe('category sections follow the profile, not a built-in list', () => {
  /** Categories deliberately out of template order, with one former built-in renamed and one
   * ordinary custom category wedged in front of the rest. */
  const categories = [
    { id: 'cat-mine', name: 'My stuff' },
    { id: 'drops', name: 'Drops' },
    { id: 'movement', name: 'Movement', nameKey: 'config.controls.categories.movement' },
  ]

  const reordered = buildFixtureProfile({
    name: 'Reordered and renamed categories',
    categories,
    actions: [
      {
        id: 'd4-move',
        categoryId: 'movement',
        name: 'Strafe left',
        kind: 'bind',
        commands: [{ kind: 'raw', text: '+moveleft' }],
        keys: [{ key: 'a' }],
        aliasName: 'strafe_l',
      },
      {
        id: 'd4-drop',
        categoryId: 'drops',
        name: 'Drop RL',
        kind: 'bind',
        commands: [{ kind: 'raw', text: 'drop rocket launcher' }],
        keys: [{ key: 'r' }],
        aliasName: 'drop_rl',
      },
      {
        id: 'd4-mine',
        categoryId: 'cat-mine',
        name: 'Wave',
        kind: 'bind',
        commands: [{ kind: 'raw', text: 'wave 1' }],
        keys: [{ key: 'g' }],
        aliasName: 'wave_g',
      },
    ],
  })

  /** The category banners of one kind of section, in file order, decoration stripped. */
  function sectionTitles(text: string, prefix: string): string[] {
    return text
      .split('\n')
      .filter((line) => line.includes(`--- ${prefix}: `))
      .map((line) =>
        line
          .slice(line.indexOf(`${prefix}: `) + prefix.length + 2)
          .replace(/\s*(\[q2l .*)?-+$/, '')
          .trim(),
      )
  }

  it('writes the sections in profile.categories order, under the profile`s own names', async () => {
    const { profile2, text1 } = await reimportProfile(reordered)

    // Not movement/weapons/drops first, and "Drops" rather than the template's "Weapon dropping".
    expect(sectionTitles(text1, 'Aliases')).toEqual(['My stuff', 'Drops', 'Movement'])
    expect(sectionTitles(text1, 'Binds')).toEqual(['My stuff', 'Drops', 'Movement'])

    // The read-back profile carries those same categories, in the same order, with the rename kept
    // and `nameKey` re-attached only where the name is still the template's English default.
    expect(profile2.categories!.map((category) => category.name)).toEqual([
      'My stuff',
      'Drops',
      'Movement',
    ])
    expect(profile2.categories!.map((category) => category.nameKey)).toEqual([
      undefined,
      undefined,
      'config.controls.categories.movement',
    ])
    // Template ids keep their id (so a seed, a `cat=` tag and a migration all mean one drawer);
    // a category of the file's own making gets a local one.
    expect(profile2.categories!.map((category) => category.id).slice(1)).toEqual([
      'drops',
      'movement',
    ])

    // Every entry is still in its own category, and the file is a fixed point - nothing reordered,
    // nothing swept into "Other".
    // (`cat-mine` is re-minted locally on read - a foreign category id means nothing here, which is
    // unchanged by this D - so it is checked against the restored category rather than literally.)
    expect(profile2.actions!.map((entry) => [entry.name, entry.categoryId] as const)).toEqual([
      ['Wave', profile2.categories![0]!.id],
      ['Drop RL', 'drops'],
      ['Strafe left', 'movement'],
    ])
    expect(text1).not.toContain('Aliases: Other')
    expect(normalize(renderProfileFile(profile2))).toBe(normalize(text1))
  })

  it('writes no section for a category the profile does not have', async () => {
    // AC 7's import half, on the writer: an imported-only profile has one category, so the file has
    // one category section - no Movement/Weapons/Weapon dropping alongside it.
    const importedOnly = buildFixtureProfile({
      name: 'Imported only',
      categories: [{ id: 'cat-imported', name: 'Imported' }],
      actions: [
        {
          id: 'd4-imported',
          categoryId: 'cat-imported',
          name: 'Cali',
          kind: 'alias',
          commands: [{ kind: 'raw', text: 'wave 2' }],
          aliasName: 'cali',
        },
      ],
    })

    const { profile2, text1 } = await reimportProfile(importedOnly)

    expect(sectionTitles(text1, 'Aliases')).toEqual(['Imported'])
    expect(text1).not.toMatch(/\[q2l cat=(movement|weapons|drops)\]/)
    expect(profile2.categories!.map((category) => category.name)).toEqual(['Imported'])
    expect(normalize(renderProfileFile(profile2))).toBe(normalize(text1))
  })
})

describe('a scrambled category order survives the round trip', () => {
  it('"Scrambled category order": the file section order is the profile order, and comes back as it', async () => {
    const { profile2, text1 } = await reimportProfile(scrambledCategoryOrderProfile)

    // The premise: the writer half works - the file's sections really are in the profile's own
    // scrambled order, not template order and not alphabetical.
    const banners = text1
      .split('\n')
      .filter((line) => line.includes('--- Binds: '))
      .map((line) =>
        line
          .slice(line.indexOf('Binds: ') + 'Binds: '.length)
          .replace(/\s*(\[q2l .*)?-+$/, '')
          .trim(),
      )
    expect(banners).toEqual(['Weapon dropping', 'Zulu', 'Bewegung', 'Alpha', 'Weapons'])

    // The reader half: the same order has to come back, or the next render moves the sections.
    expect(categoryNames(profile2)).toEqual([
      'Weapon dropping',
      'Zulu',
      'Bewegung',
      'Alpha',
      'Weapons',
    ])
    expect(sortedEntryShapes(profile2)).toEqual(sortedEntryShapes(scrambledCategoryOrderProfile))
    expect(normalize(renderProfileFile(profile2))).toBe(normalize(text1))
  })

  /**
   * and the case the merge of the three section blocks provably cannot decide:
   * `Alpha`'s entries are all unbound (an `Entries:` section and nothing else) and `Bravo`'s one
   * entry is a catalogue-backed bound row (a `Binds:` section and nothing else), so the two never
   * appear in a comparable pair of headers - and the writer emits every `Binds:` section before every
   * `Entries:` one, so the layout alone reads `Bravo, Alpha` whichever way round the profile has
   * them. The order is recorded in the header's `ord` field for exactly this reason
   * (`render.ts#categoryOrdinals`).
   */
  it('"Block-disjoint category order": the profile order survives a layout that states the opposite', async () => {
    const profile = blockDisjointCategoryOrderProfile
    const { profile2, text1 } = await reimportProfile(profile)

    // The premise, both halves. One: the two categories really do share no section block.
    expect(text1).not.toContain('Aliases: Alpha')
    expect(text1).not.toContain('Aliases: Bravo')
    expect(text1).not.toContain('Binds: Alpha')
    expect(text1).not.toContain('Entries: Bravo')
    // Two: the one section each has puts them in the file the wrong way round - `Bravo`'s bind
    // section physically precedes `Alpha`'s entries section, though the profile has Alpha first.
    expect(text1.indexOf('Binds: Bravo')).toBeGreaterThan(-1)
    expect(text1.indexOf('Entries: Alpha')).toBeGreaterThan(text1.indexOf('Binds: Bravo'))
    // And the field that says so anyway, on the headers themselves.
    expect(text1).toContain('// --- Binds: Bravo [q2l cat=cat-bravo ord=1]')
    expect(text1).toContain('// --- Entries: Alpha [q2l cat=cat-alpha ord=0]')

    // The claim: the rail comes back in the profile's order, not the file layout's.
    expect(categoryNames(profile2)).toEqual(['Alpha', 'Bravo'])
    expect(sortedEntryShapes(profile2)).toEqual(sortedEntryShapes(profile))
    expect(normalize(renderProfileFile(profile2))).toBe(normalize(text1))

    // Why the fixed point above cannot stand in for that assertion, and why the fix had to be a
    // writer-side field rather than a cleverer reader: without `ord` the same profile with its two
    // categories swapped renders the *same bytes*, so no reader could have told the two apart. With
    // it, the two files differ - which is what makes the order recoverable at all.
    const swapped = { ...profile, categories: [...profile.categories!].reverse() }
    expect(normalize(renderProfileFile(swapped))).not.toBe(normalize(text1))
    expect(normalize(renderProfileFile(swapped).replace(/ ord=\d+/g, ''))).toBe(
      normalize(text1.replace(/ ord=\d+/g, '')),
    )
  })

  /**
   * A file written before `ord` existed (or one a player edited the field out of) still restores -
   * it simply falls back to what the section layout states, exactly as this reader did before the
   * field was added. Pinned rather than assumed: `orderByFileSections` runs its block merge first and
   * only re-sorts by `ord`, so a file with no ordinals must come out of it untouched.
   */
  it('an ord-less file falls back to the section layout instead of failing', async () => {
    const text = renderProfileFile(blockDisjointCategoryOrderProfile).replace(/ ord=\d+/g, '')
    const result = await reimport(text)
    const restored = restoreProfileParts(toRestoreInput(result, [], randomUUID))

    expect(text).not.toContain('ord=')
    // The layout's own order - the honest answer for a file that records nothing else, and the one
    // this reader gave before the field existed.
    expect(restored.categories.map((category) => category.name)).toEqual(['Bravo', 'Alpha'])
    // Nothing else degrades with it: both categories are back, with their entries.
    expect(restored.actions).toHaveLength(3)
    expect(restored.warnings.filter((warning) => warning.reason === 'tag-unknown-keys')).toEqual([])
  })
})

describe('a scrambled sub-category / cvar-section order survives the round trip', () => {
  it('"Scrambled sub-category order": the sub-categories come back in the profile\'s own order, not file-discovery order', async () => {
    const { profile2, text1 } = await reimportProfile(scrambledSubcategoryOrderProfile)

    // The premise: the file's sub-banners really are in the scrambled order the profile declared,
    // not creation order and not alphabetical. Each of the writer's per-category blocks
    // (`Aliases:`/`Binds:`/`Entries:`) repeats the same sub-banner sequence once for its own rows, so
    // dedupe by first appearance rather than asserting the raw (repeating) list.
    const banners = text1
      .split('\n')
      .filter((line) => line.startsWith('// --- ') && line.includes('[q2l sub='))
      .map((line) =>
        line
          .slice('// --- '.length)
          .replace(/\s*\[q2l .*$/, '')
          .trim(),
      )
    expect([...new Set(banners)]).toEqual(['Cycling', 'Ammo', 'Beta'])

    // The reader half: `category.subcategories` has to come back in that same order, or the next
    // render moves the sub-banners.
    expect(profile2.categories).toHaveLength(1)
    expect(profile2.categories![0]!.subcategories!.map((sub) => sub.name)).toEqual([
      'Cycling',
      'Ammo',
      'Beta',
    ])
    expect(sortedEntryShapes(profile2)).toEqual(sortedEntryShapes(scrambledSubcategoryOrderProfile))
    expect(normalize(renderProfileFile(profile2))).toBe(normalize(text1))
  })

  it('"Scrambled cvar section and sub-section order": both levels come back in the profile\'s own order', async () => {
    const { profile2, text1 } = await reimportProfile(scrambledCvarSectionOrderProfile)

    // The premise: `Network` really is written before `Player`, and `Look` before `Move` inside it.
    // Every fixture also carries the reserved, untagged-by-name `Defaults` bucket
    // (`profile.writeCatalogDefaults` defaults to `true`, and this fixture's `cvars` do not name
    // every catalogue cvar) trailing after the real sections, which is not what this case is about.
    const banners = text1
      .split('\n')
      .filter(
        (line) =>
          line.startsWith('// --- ') &&
          (line.includes('[q2l cvs=') || line.includes('[q2l cvsub=')),
      )
      .map((line) =>
        line
          .slice('// --- '.length)
          .replace(/\s*\[q2l .*$/, '')
          .trim(),
      )
      .filter((name) => name !== 'Defaults')
    expect(banners).toEqual(['Network', 'Player', 'Look', 'Move'])

    // The reader half.
    expect(profile2.cvarSections!.map((section) => section.name)).toEqual(['Network', 'Player'])
    expect(
      profile2
        .cvarSections!.find((section) => section.name === 'Player')!
        .subsections!.map((sub) => sub.name),
    ).toEqual(['Look', 'Move'])
    expect(normalize(renderProfileFile(profile2))).toBe(normalize(text1))
  })
})
