import { describe, expect, it } from 'vitest'
import { actionKeySlots } from '@shared/config/action-slots'
import { aliasNameFor } from '@shared/config/alias-render'
import { renderProfileFile } from '@shared/config/render'
import { beyondLatin1NamesProfile } from '@shared/config/fixtures/profiles'
import {
  normalize,
  reimportProfile,
  findFixture,
  sortedEntryShapes,
  categoryNames,
  useRoundTripRoot,
} from './helpers'

useRoundTripRoot()

describe('an unbound entry with no commands at all', () => {
  it('"Unbound entries with no commands": three `//bind` lines, three entries, none merged', async () => {
    const profile = findFixture('Unbound entries with no commands')
    const { profile2, text1 } = await reimportProfile(profile)

    // The premise. Two of the three unbound lines are byte-identical in their code half - `//bind ""`
    // is what `render.ts#unboundCommand` writes for an entry with no commands, which is most of what
    // `STANDARD_TEMPLATE` seeds - so the only thing telling them apart in the file is their own
    // prose and their position.
    const unbound = text1.split('\n').filter((line) => line.startsWith('//bind '))
    expect(unbound).toHaveLength(3)
    expect(unbound[0]).toMatch(/^\/\/bind ""\s+\/\/ Crouch \[q2l\]$/)
    expect(unbound[1]).toMatch(/^\/\/bind "\+moveleft"\s+\/\/ Strafe left \[q2l cid=moveleft\]$/)
    expect(unbound[2]).toMatch(/^\/\/bind ""\s+\/\/ Sprint \[q2l\]$/)
    // All three under one `Entries: Movement` header, i.e. read back through one category scope.
    expect(text1).toContain('Entries: Movement')

    // Three entries back, not one and not two: an empty command list comes back empty rather than
    // being folded into the neighbour that does have one.
    expect(profile2.actions).toHaveLength(3)
    expect(sortedEntryShapes(profile2)).toEqual(sortedEntryShapes(profile))
    const byName = new Map(profile2.actions!.map((entry) => [entry.name, entry]))
    expect(byName.get('Crouch')!.commands).toEqual([])
    expect(byName.get('Sprint')!.commands).toEqual([])
    expect(byName.get('Strafe left')!.commands).toEqual([{ kind: 'raw', text: '+moveleft' }])
    for (const entry of profile2.actions!) expect(actionKeySlots(entry)).toEqual([])
  })
})

describe("display names that look like this writer's own section banners", () => {
  it('"Names that look like section banners": no fabricated section, no re-filed entry, one prefix stripped', async () => {
    const profile = findFixture('Names that look like section banners')
    const { profile2, text1 } = await reimportProfile(profile)

    // The premise, three lines of it. A comment-only unbound line whose prose is a *reserved bucket
    // title* behind a *reserved prefix*; a comment-only anchor line whose prose carries a reserved
    // prefix and a banner rule; and a category whose own name is a reserved prefix, so its section
    // banner reads `Aliases: Binds: Movement`.
    expect(text1).toMatch(/^\/\/bind ""\s+\/\/ Binds: Other \[q2l\]$/m)
    expect(text1).toMatch(/^\/\/ Entries: Movement --- extra \[q2l /m)
    expect(text1).toContain('Aliases: Binds: Movement [q2l cat=cat-banner ord=0]')

    // Two categories, both the profile's own, with the *one* title prefix taken back off - not two,
    // which would rename the category, and not zero, which would grow one.
    expect(categoryNames(profile2)).toEqual(['Binds: Movement', 'After'])
    // Nothing minted from a display name: no `Other` bucket category, no category named after an
    // entry.
    expect(categoryNames(profile2)).not.toContain('Other')
    expect(categoryNames(profile2)).not.toContain('Binds: Other')

    // All four entries, each still in its own drawer - a fabricated section boundary inside the
    // first category would show up here as `Wave`'s or `Aliases: Weapons`' category changing.
    expect(profile2.actions).toHaveLength(4)
    expect(sortedEntryShapes(profile2)).toEqual(sortedEntryShapes(profile))
    expect(normalize(renderProfileFile(profile2))).toBe(normalize(text1))
  })
})

describe('two categories with the same display name', () => {
  it('"Duplicate category names": two drawers, not one, each with its own entry', async () => {
    const profile = findFixture('Duplicate category names')
    const { profile2, text1 } = await reimportProfile(profile)

    // The premise: two sections whose banners differ in nothing but the `cat=` id (and the `ord`
    // that follows from it).
    expect(text1).toContain('Aliases: Combat [q2l cat=cat-combat-a ord=0]')
    expect(text1).toContain('Aliases: Combat [q2l cat=cat-combat-b ord=1]')

    // A name-keyed category registry would return one category here and quietly move the second
    // entry into the first one's drawer.
    expect(categoryNames(profile2)).toEqual(['Combat', 'Combat'])
    expect(new Set(profile2.categories!.map((category) => category.id)).size).toBe(2)
    expect(profile2.actions).toHaveLength(2)
    expect(
      [...profile2.actions!]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((entry) => [entry.name, entry.categoryId] as const),
    ).toEqual([
      ['Fire blaster', profile2.categories![0]!.id],
      ['Fire shotgun', profile2.categories![1]!.id],
    ])
  })
})

describe('a real category named "Other" next to the trailing "other" bucket', () => {
  it('"A real category named Other": the real one survives, the bucket stays a bucket', async () => {
    const profile = findFixture('A real category named Other')
    const { profile2, text1 } = await reimportProfile(profile)

    // The premise, and the reason for `sectionHeaderStyle: 'plain'`: the file carries *two* sections
    // titled `Aliases: Other`, one tagged (the user's real category) and one not (`render.ts`'s
    // trailing bucket for the orphaned entry) - and under `plain` style neither carries any
    // decoration for `BANNER_RULE` to tell them apart by.
    const otherBanners = text1.split('\n').filter((line) => line.startsWith('// Aliases: Other'))
    expect(otherBanners).toEqual([
      '// Aliases: Other [q2l cat=cat-other ord=0]',
      '// Aliases: Other',
    ])

    // Exactly the two categories the profile has: the real `Other` was not swallowed by the reserved
    // title, and the untagged bucket did not mint a third.
    expect(categoryNames(profile2)).toEqual(['Other', 'Kept'])
    expect(profile2.actions).toHaveLength(3)
    expect(sortedEntryShapes(profile2)).toEqual(sortedEntryShapes(profile))
    // And the orphan still matches nothing, which is what keeps it in the trailing bucket on the
    // *next* render too (`categoryRegistry`'s `'other'` case - an id handed out but never registered).
    const orphan = profile2.actions!.find((entry) => entry.name === 'Orphaned')!
    expect(profile2.categories!.some((category) => category.id === orphan.categoryId)).toBe(false)
    expect(normalize(renderProfileFile(profile2))).toBe(normalize(text1))
  })
})

describe('non-ASCII display and category names', () => {
  it('"Non-ASCII (latin-1) names": every name survives byte for byte, unbound line included', async () => {
    const profile = findFixture('Non-ASCII (latin-1) names')
    const { profile2, text1 } = await reimportProfile(profile)

    // The premise: the high-bit characters really are in the file, on the category banner, on a code
    // line's trailing comment, on an unbound line and on an anchor line - the two comment-only kinds
    // being the ones where the display name is the file's *only* copy of itself.
    expect(text1).toContain(profile.categories![0]!.name)
    expect(text1).toMatch(/^bind w\s+\S+\s+\/\/ Vorwärts \[q2l\]$/m)
    expect(text1).toMatch(/^\/\/bind ""\s+\/\/ Rückwärts ñ \[q2l\]$/m)
    expect(text1).toMatch(/^\/\/ Über-Sprung ß \[q2l /m)

    expect(categoryNames(profile2)).toEqual([profile.categories![0]!.name])
    expect(sortedEntryShapes(profile2)).toEqual(sortedEntryShapes(profile))
  })

  /**
   * The deliberate other side of the latin-1 line, and a fixture the corpus loops must not carry -
   * see `beyondLatin1NamesProfile`'s own doc comment.
   *
   * `cfg-layout.ts#sanitizeComment` drops every code point above `0xFF` rather than writing it
   * mangled, because the file is encoded latin1. That is a **write-time** loss and it predates this
   * story; none of the writer changed it. What this case has to say is
   * therefore not "the name survives" - it does not - but the two things that are actually this
   * story's business: the new unbound line loses characters the same way every older line kind does
   * (rather than, say, truncating at the first dropped one), and the loss happens **once**, so
   * everything after the first write is a true fixed point with no further erosion and no entry
   * merged or dropped by the shortening.
   */
  it('"Names beyond latin-1": dropped once at write time, stable and lossless from there on', async () => {
    const { profile2, text1 } = await reimportProfile(beyondLatin1NamesProfile)

    // The characters never reach the file at all - not as `?`, not as mojibake, not as a truncation
    // point. Everything around them, the trailing half of each name included, is kept.
    expect(text1).not.toMatch(/[^ -ÿ]/)
    expect(text1).toContain('Aliases: Move  group')
    expect(text1).toMatch(/^bind SPACE\s+\S+\s+\/\/ Jump  up \[q2l\]$/m)
    expect(text1).toMatch(/^\/\/bind ""\s+\/\/ Rocket  dance \[q2l\]$/m)

    // Both entries come back, distinct, with the shortened spelling the file states - and the
    // category with them.
    expect(categoryNames(profile2)).toEqual(['Move  group'])
    expect(profile2.actions!.map((entry) => entry.name).sort()).toEqual([
      'Jump  up',
      'Rocket  dance',
    ])
    expect(profile2.actions!.find((entry) => entry.name === 'Rocket  dance')!.commands).toEqual([])

    // Once, not on every pass: the second render is the same file as the first, and a third pass
    // changes neither the file nor the names again.
    expect(normalize(renderProfileFile(profile2))).toBe(normalize(text1))
    const { profile2: profile3, text1: text2 } = await reimportProfile(profile2)
    expect(normalize(text2)).toBe(normalize(text1))
    expect(profile3.actions!.map((entry) => entry.name).sort()).toEqual([
      'Jump  up',
      'Rocket  dance',
    ])
  })
})

describe('an unbound entry whose derived alias name collides with another', () => {
  it('"Unbound entries whose alias slug collides": four entries, two collisions, no merge and no alias line', async () => {
    const profile = findFixture('Unbound entries whose alias slug collides')
    const { profile2, text1 } = await reimportProfile(profile)

    // The premise, part one: the four display names really do collapse to two derived alias names.
    expect(aliasNameFor(profile.actions![0]!)).toBe(aliasNameFor(profile.actions![1]!))
    expect(aliasNameFor(profile.actions![2]!)).toBe(aliasNameFor(profile.actions![3]!))
    // Part two, and what separates this from `collidingAliasNameProfile`'s genuinely lossy shape: not
    // one of the four emits an `alias` line, so the collision lives purely in the model. Nothing is
    // shadowed in-engine, and nothing may therefore be folded on the way back either.
    expect(text1).not.toMatch(/^alias /m)
    expect(text1).toMatch(/^bind a\s+"\+moveleft"\s+\/\/ Strafe left \[q2l cid=moveleft\]$/m)
    expect(text1).toMatch(/^\/\/bind "\+moveright"\s+\/\/ Strafe right \[q2l cid=moveright\]$/m)
    expect(text1.split('\n').filter((line) => line.startsWith('//bind ""'))).toHaveLength(2)

    // Four entries, four names, four command lists - the prefix relationship inside each pair
    // (`Strafe left` is a strict prefix of `Strafe left!`) does not pair them.
    expect(profile2.actions).toHaveLength(4)
    expect(sortedEntryShapes(profile2)).toEqual(sortedEntryShapes(profile))
    expect(normalize(renderProfileFile(profile2))).toBe(normalize(text1))
  })
})
