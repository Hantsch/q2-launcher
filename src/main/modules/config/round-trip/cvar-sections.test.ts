import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { ConfigProfile } from '@shared/modules/config'
import { renderProfileFile } from '@shared/config/render/render'
import { formatMetaTag } from '@shared/config/profile/profile-metadata'
import { restoreProfileParts } from '@shared/config/profile/profile-restore'
import {
  CVAR_SECTION_ADVERSARIAL_FIXTURES,
  LONG_CVAR_SECTION_NAME,
  cvarInTwoSectionsProfile,
  cvarSectionNamedLikeCategoryProfile,
  danglingCvarReferenceProfile,
  emptyCvarSectionProfile,
  hostileCvarSectionNamesProfile,
  literalOtherCvarSectionProfile,
  mixedCatalogueCvarSectionProfile,
  unplacedCatalogueDefaultsOffProfile,
} from '@shared/config/fixtures/profiles'
import { toRestoreInput } from '../import'
import {
  reimport,
  normalize,
  reimportProfile,
  expectEveryLineSurvivesRerender,
  restoreFromText,
  setLines,
  bannerAt,
  cvarPlacements,
  cvarNames,
  KNOWN_UNWRITTEN_CVARS,
  installRoundTripRoot,
} from './helpers.test-helpers'

installRoundTripRoot()

describe('cvar sections survive the round trip', () => {
  /** Two sections, one with a sub-section, over a mix of catalogue and unknown cvars - plus one
   * catalogue cvar (`cl_gun`) deliberately left in no section at all, so "unplaced is never an
   * error" is exercised alongside the placed ones. */
  function sectioned(overrides: Partial<ConfigProfile> = {}): ConfigProfile {
    return {
      id: randomUUID(),
      name: 'Sectioned cvars',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      cvars: { sensitivity: '3', Crosshair: '2', my_own_cvar: 'keep me', cl_gun: '1' },
      binds: {},
      assignments: [],
      cvarSections: [
        {
          id: 'aim',
          name: 'Aim',
          cvars: ['sensitivity', 'm_pitch'],
          subsections: [{ id: 'aim-extra', name: 'Fine tuning', cvars: ['Crosshair'] }],
        },
        { id: 'mine', name: 'My own', cvars: ['my_own_cvar'] },
      ],
      ...overrides,
    }
  }

  /** A section list as `{ name, cvars, subsections }`, ids dropped - a section an adversarial
   * fixture leaves untagged is minted per read, the placements are the subject. */
  function shapeOf(sections: ConfigProfile['cvarSections']): unknown {
    return (sections ?? []).map((section) => ({
      name: section.name,
      cvars: section.cvars,
      subsections: (section.subsections ?? []).map((sub) => ({ name: sub.name, cvars: sub.cvars })),
    }))
  }

  it('reads every section, sub-section and placement back, and is a fixed point (toggle on)', async () => {
    const profile = sectioned()
    const { profile2, text1 } = await reimportProfile(profile)

    // The risky case is really being exercised: the file states the whole catalogue under the
    // reserved `Defaults` banner, tag and all.
    expect(text1).toContain(`Defaults ${formatMetaTag({ cvs: 'defaults' })}`)
    expect(text1).toMatch(/^set cl_run\s+"1"$/m)

    // Placements come back exactly as the profile stated them...
    expect(shapeOf(profile2.cvarSections)).toEqual(shapeOf(profile.cvarSections))
    // ...and not one entry was invented for either reserved bucket.
    expect(profile2.cvarSections!.map((section) => section.name)).toEqual(['Aim', 'My own'])

    // The ~30 catalogue cvars the `Defaults` bucket restates stay UNPLACED - the one state that
    // re-renders the same bucket rather than a new section holding a copy of it.
    const placed = profile2.cvarSections!.flatMap((section) => [
      ...section.cvars,
      ...(section.subsections ?? []).flatMap((sub) => sub.cvars),
    ])
    expect(placed).not.toContain('cl_run')
    expect(placed).not.toContain('cl_gun')

    // And the whole file holds still.
    expect(normalize(renderProfileFile(profile2))).toBe(normalize(text1))
  })

  it('is a fixed point with the always-write toggle off, where there is no Defaults bucket at all', async () => {
    const profile = sectioned({ writeCatalogDefaults: false })
    const { profile2, text1 } = await reimportProfile(profile)

    expect(text1).not.toContain('Defaults')
    expect(text1).not.toMatch(/^set cl_run\s/m)
    expect(shapeOf(profile2.cvarSections)).toEqual(shapeOf(profile.cvarSections))
    expect(normalize(renderProfileFile(profile2))).toBe(normalize(text1))
  })

  it('keeps a renamed section the same section - the tag is the identity, not the banner text', async () => {
    const profile = sectioned()
    const renamed: ConfigProfile = {
      ...profile,
      cvarSections: profile.cvarSections!.map((section) =>
        section.id === 'aim' ? { ...section, name: 'Aiming, renamed' } : section,
      ),
    }
    const { profile2 } = await reimportProfile(renamed)

    expect(profile2.cvarSections!.map((section) => section.name)).toEqual([
      'Aiming, renamed',
      'My own',
    ])
    expect(profile2.cvarSections![0]!.cvars).toEqual(['sensitivity', 'm_pitch'])
  })

  it('degrades a hand-deleted cvs= tag to a section minted from the banner text, never a crash', async () => {
    const profile = sectioned()
    const text1 = renderProfileFile(profile)
    // Exactly what a hand-edit does: the tag goes, the banner text stays.
    const handEdited = text1.replace(` ${formatMetaTag({ cvs: 'mine' })}`, '')
    expect(handEdited).not.toBe(text1)
    expect(handEdited).toContain('My own')

    const result = await reimport(handEdited)
    const restored = restoreProfileParts(toRestoreInput(result, [], randomUUID))

    // Still two sections, still named from the file, still holding the same cvar - the untagged one
    // was minted lazily off its own banner title.
    expect(restored.cvarSections.map((section) => section.name)).toEqual(['Aim', 'My own'])
    expect(restored.cvarSections[1]!.cvars).toEqual(['my_own_cvar'])
    // The value itself was never at risk: it is read from the `set` line, not from the tag.
    expect(result.cvars.my_own_cvar).toBe('keep me')
  })

  it('never mints the reserved Defaults section, even when it is the only section in the file', async () => {
    // A profile with no sections of its own: everything lands in the two reserved buckets.
    const profile = sectioned({ cvarSections: [] })
    const { profile2, text1 } = await reimportProfile(profile)

    expect(text1).toContain(`Defaults ${formatMetaTag({ cvs: 'defaults' })}`)
    expect(text1).toContain('Other')
    expect(profile2.cvarSections).toEqual([])
    expect(normalize(renderProfileFile(profile2))).toBe(normalize(text1))
  })
})

describe('the cvar-section fixed point over hostile profiles', () => {
  for (const profile of CVAR_SECTION_ADVERSARIAL_FIXTURES) {
    it(`"${profile.name}": is a fixed point, and no cvar is duplicated, moved or lost`, async () => {
      const { profile2, text1 } = await reimportProfile(profile)
      const text2 = renderProfileFile(profile2)

      // property itself, over this story's own hostile corpus.
      expect(normalize(text2)).toBe(normalize(text1))

      // ...and once more, so a *second* reload cannot be the one that drifts. The line count is
      // stated separately from byte-equality on purpose: "the file does not grow a line per round
      // trip" is this deliverable's own acceptance wording, and a reader that could only ever add
      // (an invented section, a restated bucket) would show up here first.
      const { profile2: profile3, text1: text2Again } = await reimportProfile(profile2)
      expect(text2Again).toBe(text2)
      const text3 = renderProfileFile(profile3)
      expect(normalize(text3)).toBe(normalize(text2))
      expect(text3.split('\n')).toHaveLength(text1.split('\n').length)

      // No cvar is written twice - not across sections, not across a section and a reserved bucket.
      // The writer's own rule ("a name listed twice is claimed by its first placement") is only
      // meaningful if this holds, and `cvarInTwoSectionsProfile` states the model shape that would
      // break it.
      const names1 = cvarNames(text1)
      expect(names1).toHaveLength(new Set(names1).size)
      expect(cvarNames(text2)).toEqual(names1)

      // No cvar moves between sections, and no value changes.
      expect(cvarPlacements(text2)).toEqual(cvarPlacements(text1))

      // And every value the profile carried really did reach the file, bar the ones this fixture is
      // built to lose - held to the opposite assertion so the allowance cannot outlive its reason.
      const known = KNOWN_UNWRITTEN_CVARS[profile.name] ?? []
      for (const name of Object.keys(profile.cvars)) {
        if (known.includes(name)) {
          expect(
            names1,
            `${name} was expected to be unwritten, but the file carries it`,
          ).not.toContain(name)
          continue
        }
        expect(names1, `${name} is missing from the rendered file`).toContain(name)
      }
    })
  }
})

describe('what the hostile cvar-section fixtures come back as', () => {
  /** A section list as `{ name, cvars, subsections }`, ids dropped - an untagged section's id is
   * minted per read, the placements are the subject. */
  function shapeOf(sections: ConfigProfile['cvarSections']): unknown {
    return (sections ?? []).map((section) => ({
      name: section.name,
      cvars: section.cvars,
      subsections: (section.subsections ?? []).map((sub) => ({ name: sub.name, cvars: sub.cvars })),
    }))
  }

  it('an empty section keeps its banner and comes back empty, rather than looking deleted', async () => {
    const { profile2, text1 } = await reimportProfile(emptyCvarSectionProfile)

    // The premise: the empty section's banner really is written, and really is followed by another
    // banner rather than by content - the shape lazy registration cannot see.
    const lines = text1.split('\n')
    const at = lines.findIndex((line) => line.startsWith('// --- Nothing here yet [q2l cvs='))
    expect(at).toBeGreaterThan(-1)
    const next = lines.slice(at + 1).find((line) => line.trim().length > 0)
    expect(next!.startsWith('// ---')).toBe(true)

    expect(shapeOf(profile2.cvarSections)).toEqual([
      { name: 'Nothing here yet', cvars: [], subsections: [] },
      { name: 'Something', cvars: ['zz_kept'], subsections: [] },
    ])
  })

  it('a section the user named "Other" is a real section, and the reserved bucket is still not one', async () => {
    const { profile2, text1 } = await reimportProfile(literalOtherCvarSectionProfile)

    // Two banners, both titled `Other`, and the tag is the only thing between them.
    const others = text1
      .split('\n')
      .map(bannerAt)
      .filter((banner) => banner?.title === 'Other')
    expect(others.map((banner) => banner!.tag !== null)).toEqual([true, false])

    // Exactly one section, the user's - the reserved bucket minted nothing, and the user's section
    // was not swallowed by the title match.
    expect(shapeOf(profile2.cvarSections)).toEqual([
      { name: 'Other', cvars: ['zz_mine'], subsections: [] },
    ])
    // The leftovers cvar is still in the file and still unplaced, which is what re-renders the same
    // untagged bucket rather than a second section holding a copy of it.
    expect(profile2.cvars.zz_stray).toBe('unplaced')
  })

  it('a cvar section and a bind category of the same name stay in their own namespaces', async () => {
    const { profile2, text1 } = await reimportProfile(cvarSectionNamedLikeCategoryProfile)

    // The premise: one `Movement` banner carries `cvs=`, the other two carry `cat=`. Nothing but
    // the tag distinguishes the first from the rest.
    const movement = text1
      .split('\n')
      .map(bannerAt)
      .filter((banner) => banner?.title.endsWith('Movement'))
    expect(
      movement.map(
        (banner) => `${banner!.title}${banner!.tag!.includes('cvs=') ? ' <cvs>' : ' <cat>'}`,
      ),
    ).toEqual(['Movement <cvs>', 'Aliases: Movement <cat>', 'Binds: Movement <cat>'])

    expect(shapeOf(profile2.cvarSections)).toEqual([
      { name: 'Movement', cvars: ['cl_maxfps'], subsections: [] },
    ])
    expect(profile2.categories!.map((category) => category.name)).toEqual(['Movement'])
    // One entry, in the category - not filed into the cvar section, and no second category minted
    // off the cvar banner's title.
    expect(profile2.actions!.map((action) => action.name)).toEqual(['Forward'])
    expect(profile2.actions![0]!.categoryId).toBe(profile2.categories![0]!.id)
  })

  it('a cvar listed in two sections is written once, under the first, and read back once', async () => {
    const { profile2, text1 } = await reimportProfile(cvarInTwoSectionsProfile)

    // Written exactly once each, and under `First` - the profile's own array order decides, so the
    // choice is deterministic rather than "whichever section the resolver reached first".
    expect(cvarPlacements(text1).get('crosshair')).toBe('First|2')
    expect(cvarPlacements(text1).get('zz_dup')).toBe('First|once')
    expect(setLines(text1).filter((line) => line.startsWith('set crosshair'))).toHaveLength(1)
    expect(setLines(text1).filter((line) => line.startsWith('set zz_dup'))).toHaveLength(1)

    // Both losing placements survive as *sections*, empty - their banners are their only trace and
    // they must not vanish - and neither gained a duplicate entry.
    expect(shapeOf(profile2.cvarSections)).toEqual([
      { name: 'First', cvars: ['crosshair', 'zz_dup'], subsections: [] },
      { name: 'Second', cvars: [], subsections: [{ name: 'Deeper still', cvars: [] }] },
    ])
  })

  it('a section naming a cvar the profile does not have writes nothing for it and invents nothing', async () => {
    const { profile2, text1 } = await reimportProfile(danglingCvarReferenceProfile)

    // No line, no empty-valued placeholder, no mention anywhere at all.
    expect(text1).not.toContain('zz_ghost')
    expect(shapeOf(profile2.cvarSections)).toEqual([
      { name: 'Has a ghost', cvars: ['zz_real'], subsections: [] },
    ])
    expect(Object.keys(profile2.cvars)).not.toContain('zz_ghost')
    expect(profile2.cvars.zz_real).toBe('yes')
  })

  it('a non-ASCII name and a 120-character name both come back whole', async () => {
    // The fixture really is a cap case - `configCvarSectionSchema` allows 120 and no more.
    expect(LONG_CVAR_SECTION_NAME).toHaveLength(120)
    const { profile2, text1 } = await reimportProfile(hostileCvarSectionNamesProfile)

    // Neither name was cut on the way out: the long one's banner carries all 120 characters *and*
    // its tag (`fitProseAndTag` gives the title away first, so a truncation here would be silent).
    expect(text1).toContain('// --- Öffnungswinkel & Mausempfindlichkeit [q2l cvs=')
    expect(text1).toContain(`// --- ${LONG_CVAR_SECTION_NAME} [q2l cvs=`)

    expect(shapeOf(profile2.cvarSections)).toEqual([
      { name: 'Öffnungswinkel & Mausempfindlichkeit', cvars: ['zz_umlaut'], subsections: [] },
      { name: LONG_CVAR_SECTION_NAME, cvars: ['sensitivity'], subsections: [] },
    ])
  })

  it('with the toggle off an unplaced catalogue cvar produces no line, and that stays true', async () => {
    const profile = unplacedCatalogueDefaultsOffProfile
    const { profile2, text1 } = await reimportProfile(profile)

    // No `Defaults` bucket at all, and the placed catalogue cvar still carries its stored value.
    expect(text1).not.toContain('Defaults')
    expect(setLines(text1).map((line) => line.replace(/\s+/g, ' '))).toEqual([
      'set fov "110"',
      'set zz_stray "x"',
    ])

    // The documented trade, stated where it can be seen: the profile stored `cl_gun`, the file does
    // not carry it, so a profile rebuilt from that file does not have it either. `zz_stray` shows
    // this is about the *catalogue* half only - the toggle never gated the `Other` bucket.
    expect(profile.cvars.cl_gun).toBe('0')
    expect(Object.keys(profile2.cvars)).not.toContain('cl_gun')
    expect(profile2.cvars.zz_stray).toBe('x')

    // And nothing reappears on the second render either - the absence is stable, not a value
    // oscillating between "stored" and "default".
    expect(renderProfileFile(profile2)).not.toContain('cl_gun')
    expect(shapeOf(profile2.cvarSections)).toEqual([
      { name: 'Placed', cvars: ['fov'], subsections: [] },
    ])
  })

  it('one section holding a catalogue and a non-catalogue cvar keeps both, in order', async () => {
    const { profile2, text1 } = await reimportProfile(mixedCatalogueCvarSectionProfile)

    // Both under the same banner - the catalogue one resolved through `writeValueFor`, the other
    // straight off `profile.cvars`, and neither diverted into a reserved bucket.
    expect(cvarPlacements(text1).get('cl_maxfps')).toBe('Mixed bag|250')
    expect(cvarPlacements(text1).get('zz_test')).toBe('Mixed bag|hello')

    expect(shapeOf(profile2.cvarSections)).toEqual([
      { name: 'Mixed bag', cvars: ['cl_maxfps', 'zz_test'], subsections: [] },
    ])
  })
})

/**
 * The two cases that cannot start from a `ConfigProfile` at all, because their whole subject is a
 * file this writer did not write.
 */

describe('foreign and hand-moved cvar lines', () => {
  /**
   * A hand-kept `.cfg` in somebody else's house style: no `[q2l ...]` tag anywhere, and its group
   * headers drawn as **mirrored wraps** (`.: Mouse and aiming :.`) - the shape
   * `profile-restore.ts#mirroredWrapTitle` recognises, and the one `docs/fixtures/dm.cfg` really
   * uses. Written out by hand rather than rendered, because a render would carry tags and the point
   * is precisely a file that carries none.
   */
  const FOREIGN_MIRRORED_WRAP_FILE = [
    '// my quake config, kept by hand since 1998',
    '',
    '// .: Mouse and aiming :.',
    'set sensitivity "7"',
    'set zz_smooth "1"',
    '',
    '// .: Video :.',
    'set gl_modulate "2"',
    '',
  ].join('\n')

  it('mints a section per mirrored-wrap banner, and the first parse makes the file a fixed point', async () => {
    const { result, restored, rerendered } = await restoreFromText(FOREIGN_MIRRORED_WRAP_FILE)

    // Two sections, named from the file's own headers, each holding exactly the cvars under it -
    // catalogue (`sensitivity`, `gl_modulate`) and non-catalogue (`zz_smooth`) alike, since a
    // foreign author's grouping does not know the catalogue exists.
    expect(restored.cvarSections.map((section) => [section.name, section.cvars])).toEqual([
      ['Mouse and aiming', ['sensitivity', 'zz_smooth']],
      ['Video', ['gl_modulate']],
    ])
    // Every value survived the trip; nothing was invented for a banner that held nothing.
    expect(result.cvars).toMatchObject({ sensitivity: '7', zz_smooth: '1', gl_modulate: '2' })

    // The re-render states those sections in this writer's own shape, tags and all...
    expect(rerendered).toMatch(/^\/\/ --- Mouse and aiming \[q2l cvs=\S+\] -+$/m)
    expect(rerendered).toMatch(/^\/\/ --- Video \[q2l cvs=\S+\] -+$/m)
    expect(cvarPlacements(rerendered).get('sensitivity')).toBe('Mouse and aiming|7')
    expect(cvarPlacements(rerendered).get('gl_modulate')).toBe('Video|2')

    // ...and from there it holds still: the lazily-minted reading is itself a fixed point rather
    // than a file that gains a section (or re-mints one under a new id) on every reload.
    const second = await restoreFromText(rerendered)
    expect(normalize(second.rerendered)).toBe(normalize(rerendered))
    expect(second.rerendered.split('\n')).toHaveLength(rerendered.split('\n').length)
    const third = await restoreFromText(second.rerendered)
    expect(normalize(third.rerendered)).toBe(normalize(rerendered))
  })

  it('a `set` line hand-moved under a bind-side banner stays unplaced, and settles there', async () => {
    const text = renderProfileFile(cvarSectionNamedLikeCategoryProfile)
    const moved = 'set cl_maxfps "250"'
    const bindsBanner = text.split('\n').find((line) => line.startsWith('// --- Binds: Movement '))!
    expect(text).toContain(moved)

    // Exactly what a hand-edit in the Raw File tab does: the line leaves its own cvar section and
    // lands under a `cat=` banner instead.
    const mangled = text.replace(`${moved}\n`, '').replace(bindsBanner, `${bindsBanner}\n${moved}`)
    expect(mangled).not.toBe(text)

    const { result, restored, rerendered } = await restoreFromText(mangled)

    // the namespace rule: a `set` line under a bind-side banner is unplaced, never the seed of a
    // cvar section named after that category. The cvar section itself still exists (its `cvs=`
    // banner registers eagerly) and is simply empty now.
    expect(restored.cvarSections.map((section) => [section.name, section.cvars])).toEqual([
      ['Movement', []],
    ])
    expect(restored.categories.map((category) => category.name)).toEqual(['Movement'])
    // The value was never at risk - it is read off the `set` line, not off any banner.
    expect(result.cvars.cl_maxfps).toBe('250')
    // Unplaced and the toggle is on, so it re-renders under the reserved `Defaults` bucket, still
    // at its stored value, and never as a second `Movement` anything.
    expect(cvarPlacements(rerendered).get('cl_maxfps')).toBe('Defaults|250')
    expectEveryLineSurvivesRerender(result, rerendered)

    // And the degraded reading settles rather than drifting one section further on each reload.
    const second = await restoreFromText(rerendered)
    expect(normalize(second.rerendered)).toBe(normalize(rerendered))
  })
})
