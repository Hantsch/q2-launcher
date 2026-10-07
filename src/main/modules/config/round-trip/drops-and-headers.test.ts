import { describe, expect, it } from 'vitest'
import type { ConfigProfile } from '@shared/modules/config'
import { aliasNameFor, derivedAliasName } from '@shared/config/aliases/alias-render'
import {
  HAND_EDIT_SENTENCE,
  OWNERSHIP_MARKER,
  renderProfileFile,
  sentinelLine,
} from '@shared/config/render/render'
import { isLauncherOwnedFile, readOwnershipStamp } from '@shared/config/render/file-ownership'
import { META_FORMAT_VERSION, formatMetaTag } from '@shared/config/profile/profile-metadata'
import {
  blankProfileNameProfile,
  bodyProseWithIdProfile,
  buildFixtureProfile,
  forgedTagProfileNameProfile,
} from '@shared/config/fixtures/profiles'
import { recoverProfileName } from '../rebuild'
import {
  reimport,
  normalize,
  slotsOf,
  reimportProfile,
  findFixture,
  countConfigLines,
  expectEveryLineSurvivesRerender,
  headerOf,
  preservedLines,
  rerenderFromFile,
  installRoundTripRoot,
} from './helpers.test-helpers'

installRoundTripRoot()

describe('a profile of drops is a fixed point under the `drop_<slug>` naming', () => {
  const dropsProfile = buildFixtureProfile({
    name: 'Drops with ammo, a message and extras',
    actions: [
      {
        // A renamed Weapon-dropping row: the shape whose name this D actually moves
        // (`rail_gun` -> `drop_rail_gun`), with ammo, a team message and an extra `wave 1` after it.
        id: 'd2-rail',
        categoryId: 'drops',
        catalogId: 'dropWeapon:railgun',
        name: 'Rail Gun',
        kind: 'bind',
        keys: [{ key: 'r' }],
        commands: [
          { kind: 'raw', text: 'drop railgun' },
          { kind: 'raw', text: 'drop slugs' },
          { kind: 'message', channel: 'say_team', text: 'Dropped [ Rail Gun ] %l' },
          { kind: 'raw', text: 'wave 1' },
        ],
      },
      {
        // No ammo of its own (`drop_tech`'s case), message only.
        id: 'd2-tech',
        categoryId: 'drops',
        catalogId: 'dropMisc:rebreather',
        name: 'Rebreather',
        kind: 'bind',
        keys: [{ key: 't' }],
        commands: [
          { kind: 'raw', text: 'drop rebreather' },
          { kind: 'message', channel: 'say_team', text: 'Dropped a rebreather' },
        ],
      },
      {
        // A template-named ammo row, i.e. a name that already begins with `drop_`: it must come out
        // exactly as it did before this story, not as `drop_drop_shells`.
        id: 'd2-shells',
        categoryId: 'drops',
        catalogId: 'dropAmmo:shells',
        name: 'drop shells',
        kind: 'alias',
        commands: [
          { kind: 'raw', text: 'drop shells' },
          { kind: 'raw', text: 'drop shells' },
          { kind: 'raw', text: 'wave 1' },
        ],
      },
    ],
  })

  it('renders all three as `drop_<slug>`, recovers the names, and re-renders the same file', async () => {
    const { profile2, text1 } = await reimportProfile(dropsProfile)

    // The premise: the new naming really is in the file, extras and all - without this the fixed
    // point below would hold over the old, display-name-derived names just as happily.
    expect(text1).toMatch(
      /^alias drop_rail_gun\s+"drop railgun; drop slugs; say_team Dropped \[ Rail Gun \] %l; wave 1"/m,
    )
    expect(text1).toMatch(
      /^alias drop_rebreather\s+"drop rebreather; say_team Dropped a rebreather"/m,
    )
    // The already-`drop_` name is untouched, in both directions.
    expect(text1).toMatch(/^alias drop_shells\s+"drop shells; drop shells; wave 1"/m)
    expect(text1).not.toContain('drop_drop_')
    expect(text1).not.toMatch(/^alias rail_gun /m)

    // The names come back as the entries' own `aliasName` - the carry-over the fixed point rests on.
    // (The *display* names are the catalogue's own labels rather than the fixture's: a `cid=`-tagged
    // line carries the catalogue label as its prose, which is unchanged by this story and is exactly
    // why the alias name cannot be re-derived on the way back - see the assertion below it.)
    const byName = new Map(profile2.actions!.map((entry) => [entry.name, entry]))
    expect([...byName.keys()].sort()).toEqual(['Railgun', 'Rebreather', 'Shells'])
    expect(byName.get('Railgun')!.aliasName).toBe('drop_rail_gun')
    expect(byName.get('Rebreather')!.aliasName).toBe('drop_rebreather')
    expect(byName.get('Shells')!.aliasName).toBe('drop_shells')

    // What the carry-over is worth here: deriving the name again from the restored entry would give
    // a *different* `drop_` name, so this shape would not be a fixed point without `aliasName`.
    expect(derivedAliasName(byName.get('Railgun')!)).toBe('drop_railgun')
    expect(aliasNameFor(byName.get('Railgun')!)).toBe('drop_rail_gun')

    // Ammo, message and the extra `wave 1` all survive as the commands they were (AC 6), so the
    // toggles the writer splices have the same body to work on after a reload as before it.
    for (const original of dropsProfile.actions!) {
      const restored = profile2.actions!.find(
        (entry) => entry.aliasName === aliasNameFor(original),
      )!
      expect(restored.commands).toEqual(original.commands)
    }
    expect(slotsOf(byName.get('Railgun')!)).toEqual(['r'])

    // The property itself, and one more pass to show it settles rather than merely alternating.
    expect(normalize(renderProfileFile(profile2))).toBe(normalize(text1))
    const { text1: text2 } = await reimportProfile(profile2)
    expect(normalize(text2)).toBe(normalize(text1))
  })
})

describe('a legacy-shape file re-renders into the banner shape', () => {
  /**
   * A file exactly as the S10 build wrote it, built out of a current render so the two differ in
   * *nothing but the header*: the sentinel line, then the old five-line block (`=` rule / name +
   * `[q2l v=1]` / the hand-edit sentence / `=` rule), then the same body.
   *
   * Assembled from the real render's own rule and name lines rather than from hand-typed literals,
   * so it cannot drift from what `banner()` draws - and with `sentinelLine`/`HAND_EDIT_SENTENCE`,
   * the two exports kept alive for exactly this read path.
   */
  function legacyShapeOf(profile: ConfigProfile): { legacy: string; current: string } {
    const current = renderProfileFile(profile)
    const [rule, nameLine] = headerOf(current)
    const legacy = [
      sentinelLine(profile.id),
      rule!,
      `${nameLine!} ${formatMetaTag({ v: String(META_FORMAT_VERSION) })}`,
      `//  ${HAND_EDIT_SENTENCE}`,
      rule!,
      ...current.split('\n').slice(4),
    ].join('\n')
    return { legacy, current }
  }

  it('keeps its id and name, is still recognised as owned, and comes out in the new shape', async () => {
    const profile = findFixture('Marker-tag-only entry pair')
    const { legacy, current } = legacyShapeOf(profile)

    // The premise: this really is the old shape - a sentinel on line 1, the tag riding on the name
    // line, the hand-edit sentence, and no `id` field anywhere.
    expect(legacy.startsWith(OWNERSHIP_MARKER)).toBe(true)
    expect(legacy).toContain(`//  ${HAND_EDIT_SENTENCE}`)
    expect(legacy).not.toContain('id=')
    // the first half, read by the module: an old file is still the launcher's own file.
    expect(isLauncherOwnedFile(legacy)).toBe(true)
    expect(readOwnershipStamp(legacy)).toEqual({ id: profile.id, version: '', shape: 'sentinel' })
    expect(recoverProfileName(legacy)).toBe(profile.name)

    const { result, restored, rerendered } = await rerenderFromFile(legacy)

    // The import half: ownership resolves to the same profile (this is what `import.ts`'s
    // `ownWrittenFile` asks), and the five header lines are understood rather than listed back at
    // the user as things the launcher did not recognise.
    expect(restored.sourceProfileId).toBe(profile.id)
    expect(restored.metadataVersion).toBe(META_FORMAT_VERSION)
    for (const line of legacy.split('\n').slice(0, 5)) {
      expect(preservedLines(result, restored)).not.toContain(line)
    }

    // the second half: the next save writes the new shape - four lines, the same id, the same
    // name, and no sentinel line left anywhere in the file.
    expect(headerOf(rerendered)).toEqual(headerOf(current))
    expect(rerendered).not.toContain(OWNERSHIP_MARKER)
    expect(rerendered).not.toContain(HAND_EDIT_SENTENCE)
    expect(readOwnershipStamp(rerendered)).toEqual({
      id: profile.id,
      version: String(META_FORMAT_VERSION),
      shape: 'banner',
    })
    expect(recoverProfileName(rerendered)).toBe(profile.name)

    // And nothing else moved: the file it re-renders into is the one the current writer would have
    // written for this profile all along, and every line the old file carried is still in it.
    expect(normalize(rerendered)).toBe(normalize(current))
    expectEveryLineSurvivesRerender(result, rerendered)
  })

  it('the converted file is itself a fixed point - the conversion happens once', async () => {
    // A one-way conversion that kept converting would rewrite the file on every start, which is the
    // "changed outside the launcher" noise the writer exists to prevent.
    const { legacy } = legacyShapeOf(findFixture('Hand-added third key'))
    const first = await rerenderFromFile(legacy)
    const second = await rerenderFromFile(first.rerendered)
    expect(normalize(second.rerendered)).toBe(normalize(first.rerendered))
  })
})

describe('hand-edited header blocks', () => {
  /** The healthy render every case below mangles, plus what a clean read of it produces - so each
   * case can state what its edit cost *relative to* the undamaged file rather than in absolutes. */
  async function healthy() {
    const profile = findFixture('Marker-tag-only entry pair')
    const text = renderProfileFile(profile)
    const before = await reimport(text)
    const clean = await rerenderFromFile(text)
    return { profile, text, before, clean }
  }

  /** Every claim that holds for *all* of these edits: nothing throws, no config line is lost, no
   * entry or category is invented or dropped, and the re-render is a well-formed, owned banner
   * header again rather than a second broken one. */
  function expectRepairedAndLossless(
    clean: Awaited<ReturnType<typeof rerenderFromFile>>,
    mangledResult: Awaited<ReturnType<typeof rerenderFromFile>>,
  ): void {
    expect(mangledResult.restored.actions.map((entry) => entry.name)).toEqual(
      clean.restored.actions.map((entry) => entry.name),
    )
    // No line was read as a section header that is not one - a fabricated category is how a
    // mis-read header line would show up.
    expect(mangledResult.restored.categories.map((category) => category.name)).toEqual(
      clean.restored.categories.map((category) => category.name),
    )
    expectEveryLineSurvivesRerender(mangledResult.result, mangledResult.rerendered)
    expect(headerOf(mangledResult.rerendered)).toHaveLength(4)
    expect(isLauncherOwnedFile(mangledResult.rerendered)).toBe(true)
    expect(readOwnershipStamp(mangledResult.rerendered)?.shape).toBe('banner')
  }

  it('the tag line deleted: ownership is gone, the rest is not, and the next save restores it', async () => {
    const { text, before, clean } = await healthy()
    const mangled = text
      .split('\n')
      .filter((_line, index) => index !== 3)
      .join('\n')
    expect(mangled).not.toBe(text)

    const mangledResult = await rerenderFromFile(mangled)

    // The honest consequence, and the Test Plan's own step 6: with the tag gone there is nothing in
    // the file that says whose it is, so it is not launcher-owned any more and the three orphaned
    // decoration lines are listed as unrecognised - which is correct, not a defect.
    expect(readOwnershipStamp(mangled)).toBeNull()
    expect(mangledResult.restored.sourceProfileId).toBeNull()
    expect(preservedLines(mangledResult.result, mangledResult.restored)).toEqual(
      expect.arrayContaining(headerOf(text).slice(0, 3)),
    )
    // One comment-only line fewer, and not one config line fewer.
    expect(countConfigLines(mangledResult.result)).toBe(countConfigLines(before) - 1)
    // The name is on the line after the first rule either way, so a rebuild still recovers it - and
    // the file it writes back carries a fresh, complete stamp instead of staying half-headed.
    expect(recoverProfileName(mangled)).toBe(recoverProfileName(text))
    expectRepairedAndLossless(clean, mangledResult)
  })

  it('`id=` stripped from the tag: reads as a pre-051 header, not as a broken one', async () => {
    const { text, before, clean } = await healthy()
    // `[q2l v=1 id=…]` -> `[q2l v=1]`, which is exactly the header tag the S10 build wrote - so this
    // edit does not produce a malformed tag, it produces an *older* one, and the version marker has
    // to go on working while ownership falls back to "no stamp here".
    const mangled = text.replace(/\[q2l v=(\d+) id=[^\]\s]+\]/, '[q2l v=$1]')
    expect(mangled).not.toBe(text)

    const mangledResult = await rerenderFromFile(mangled)

    expect(readOwnershipStamp(mangled)).toBeNull()
    expect(mangledResult.restored.sourceProfileId).toBeNull()
    expect(mangledResult.restored.metadataVersion).toBe(META_FORMAT_VERSION)
    // No line lost at all this time (nothing was deleted), and no warning: a tag without `id` is a
    // legal tag, not a mangled one.
    expect(countConfigLines(mangledResult.result)).toBe(countConfigLines(before))
    expect(mangledResult.restored.warnings.filter((w) => w.reason.startsWith('tag-'))).toEqual([])
    expectRepairedAndLossless(clean, mangledResult)
  })

  it('both `=` rules deleted: the id survives, the name does not, and nothing is invented', async () => {
    const { profile, text, before, clean } = await healthy()
    const mangled = text
      .split('\n')
      .filter((_line, index) => index !== 0 && index !== 2)
      .join('\n')
    expect(mangled).not.toBe(text)

    const mangledResult = await rerenderFromFile(mangled)

    // Ownership rides on the tag alone (the writer scans for a tag, never for the frame around it), so it is
    // untouched by losing the decoration - which is the whole reason the id moved into the tag.
    expect(readOwnershipStamp(mangled)).toEqual({
      id: profile.id,
      version: String(META_FORMAT_VERSION),
      shape: 'banner',
    })
    expect(mangledResult.restored.sourceProfileId).toBe(profile.id)
    // The name, on the other hand, is identified by the sandwich and by nothing else: with both
    // rules gone, that line is arbitrary prose again. It is therefore neither recovered as a name
    // nor consumed as decoration - it stays visible as an unrecognised line, which is the safe
    // direction to fail in (a guess here would rename the profile from a stray comment).
    expect(recoverProfileName(mangled)).toBeNull()
    expect(preservedLines(mangledResult.result, mangledResult.restored)).toContain(
      headerOf(text)[1],
    )
    // ...and, critically, that line is not read as a section header either: no category is minted
    // from it, and the entries stay where they were.
    expect(countConfigLines(mangledResult.result)).toBe(countConfigLines(before) - 2)
    expectRepairedAndLossless(clean, mangledResult)
    expect(readOwnershipStamp(mangledResult.rerendered)?.id).toBe(profile.id)
  })

  it('the name line hand-renamed: the new name is adopted, the id is not touched', async () => {
    const { profile, text, before, clean } = await healthy()
    const renamed = '//  Duel config - do not delete'
    const mangled = text.replace(headerOf(text)[1]!, renamed)
    expect(mangled).not.toBe(text)

    const mangledResult = await rerenderFromFile(mangled)

    // `rebuild.ts`' own rule: the header carries the name as the user typed it, and a user who
    // renames the profile *in the header* means it. The identity is a different field and does not
    // move with it.
    expect(recoverProfileName(mangled)).toBe('Duel config - do not delete')
    expect(readOwnershipStamp(mangled)?.id).toBe(profile.id)
    expect(mangledResult.restored.sourceProfileId).toBe(profile.id)
    // The sandwich identifies the name line by its two rules, not by its text, so a renamed line is
    // still consumed - a hand-renamed profile must not start listing its own header back at the user.
    expect(preservedLines(mangledResult.result, mangledResult.restored)).not.toContain(renamed)
    expect(countConfigLines(mangledResult.result)).toBe(countConfigLines(before))

    // The next save writes the new name, keeps the id, and changes nothing below the header.
    expect(headerOf(mangledResult.rerendered)[1]).toBe(renamed)
    expect(readOwnershipStamp(mangledResult.rerendered)?.id).toBe(profile.id)
    const body = (value: string): string => value.split('\n').slice(4).join('\n')
    expect(normalize(body(mangledResult.rerendered))).toBe(normalize(body(text)))
    expectRepairedAndLossless(clean, mangledResult)
  })

  it('a body comment carrying a full `[q2l v=… id=…]` stamp never outvotes the header', async () => {
    const { profile, text, before, clean } = await healthy()
    // The forgery a player can type by hand and `neutralizeProse` cannot prevent (it only guards
    // prose the *writer* emits): a real, well-formed ownership stamp on an ordinary entry line, far
    // below the header - naming somebody else's profile.
    const forged = 'f0f0f0f0-dead-4000-8000-000000000001'
    const mangled = text.replace(
      /^(bind k\s+"pick_shotgun"\s+\/\/ Pick shotgun \[q2l)\]$/m,
      `$1 v=${META_FORMAT_VERSION} id=${forged}]`,
    )
    expect(mangled).not.toBe(text)
    expect(mangled).toContain(`id=${forged}`)

    const mangledResult = await rerenderFromFile(mangled)

    // Two independent bounds keep this inert, and both are asserted because either alone would let
    // the other rot: `readOwnershipStamp` never looks past `HEADER_SCAN_LINES`, and `scanComments`
    // only takes an `id` off the *first* `v`-carrying line, which the header already is.
    expect(readOwnershipStamp(mangled)?.id).toBe(profile.id)
    expect(mangledResult.restored.sourceProfileId).toBe(profile.id)
    expect(countConfigLines(mangledResult.result)).toBe(countConfigLines(before))
    // The forged fields are not carried forward into the next render either - an entry line's tag is
    // rebuilt from the entry, so the forgery dies at the first save.
    expect(mangledResult.rerendered).not.toContain(forged)
    expect(readOwnershipStamp(mangledResult.rerendered)?.id).toBe(profile.id)
    expectRepairedAndLossless(clean, mangledResult)
  })
})

describe('profile names the header has to survive', () => {
  it('a whitespace-only name still renders one stable header line', async () => {
    const text1 = renderProfileFile(blankProfileNameProfile)
    const header = headerOf(text1)

    // Decisions say the name line is emitted `trimEnd()`ed precisely so that "an empty
    // or whitespace-only name would [not] write `//  ` - a trailing-whitespace line, and a risk to
    // the byte-identical fixed point". `render.ts#buildHeaderBlock` trims the *name*
    // (`bannerText(profile.name).trimEnd()`) and `cfg-layout.ts#banner`'s `=` branch trims its own
    // composed `//  ${line}` too, the same way its `dashes` branch already did ("no line this writer
    // emits ends in whitespace that has nothing after it"). So a blank name renders a bare `//`. The
    // trim does work for every non-empty name too (`'My Profile   '` -> `//  My Profile`).
    expect(header[1]).toBe('//')
    for (const line of [header[0], header[2], header[3]]) expect(line).toBe(line!.trimEnd())

    const { result, restored, rerendered } = await rerenderFromFile(text1)

    // The empty name line is still consumed: the sandwich identifies it by the two rules around it,
    // which is exactly why it is allowed to be empty in the first place.
    expect(preservedLines(result, restored)).not.toContain(header[1])
    expect(restored.sourceProfileId).toBe(blankProfileNameProfile.id)
    // Nothing to recover, so a rebuild falls back to the file name rather than adopting a blank -
    // stated here because it is the visible consequence of allowing the empty line at all.
    expect(recoverProfileName(text1)).toBeNull()
    expect(rerendered.split('\n')[1]).toBe('//  Rebuilt from a nameless header')

    // And the profile itself (name included, as the store still holds it) is a fixed point.
    const { profile2 } = await reimportProfile(blankProfileNameProfile)
    expect(normalize(renderProfileFile(profile2))).toBe(normalize(text1))
  })

  it('a profile named `[q2l …]` is written inert and never read as a second stamp', async () => {
    const profile = forgedTagProfileNameProfile
    const text1 = renderProfileFile(profile)
    const header = headerOf(text1)

    // `neutralizeProse` rewrites the sigil on the way out, so the name line cannot parse as a tag at
    // all - and the block therefore contains exactly one `[q2l`, the real stamp on its last line.
    expect(header[1]).toContain('(q2l v=1 id=1a4b1d3c-0000-4000-8000-abcdefabcdef]')
    expect(header[1]).not.toContain('[q2l')
    expect(header.filter((line) => line.includes('[q2l'))).toEqual([header[3]])

    // The forged id sits *above* the real one, and `readOwnershipStamp` returns the first stamp it
    // finds in line order - so a name that still spelled `[q2l` would hand this file somebody else's
    // identity, which is the whole point of neutralising it.
    expect(readOwnershipStamp(text1)).toEqual({
      id: profile.id,
      version: String(META_FORMAT_VERSION),
      shape: 'banner',
    })

    const { result, restored, rerendered } = await rerenderFromFile(text1)
    expect(restored.sourceProfileId).toBe(profile.id)
    expect(restored.sourceProfileId).not.toBe('1a4b1d3c-0000-4000-8000-abcdefabcdef')
    // The neutralised spelling is what a rebuild recovers as the name, so it survives verbatim and
    // the header line is understood rather than preserved.
    expect(recoverProfileName(text1)).toBe(header[1]!.slice(4))
    expect(preservedLines(result, restored)).not.toContain(header[1])
    expect(headerOf(rerendered)[1]).toBe(header[1])
    expectEveryLineSurvivesRerender(result, rerendered)
  })

  it('`id=` in ordinary body prose is prose, on every line kind that carries a name', async () => {
    const profile = bodyProseWithIdProfile
    const { profile2, text1 } = await reimportProfile(profile)

    // The premise: the literal really is in the file, on a section banner, on a bound entry's
    // trailing comment and on a comment-only unbound line - the three places a display name lives.
    expect(text1).toContain('Servers id=7')
    expect(text1).toMatch(/^bind F6\s+\S+\s+\/\/ Join id=42 \[q2l\]$/m)
    expect(text1).toMatch(/^\/\/bind ""\s+\/\/ Spare id=43 \[q2l\]$/m)

    // None of it is ownership: the stamp is the header's, and it is the only one.
    expect(readOwnershipStamp(text1)?.id).toBe(profile.id)
    expect(text1.split('\n').filter((line) => /\[q2l[^\]]*\bid=/.test(line))).toEqual([
      headerOf(text1)[3],
    ])

    // ...and none of it moved an entry or minted a category either.
    expect(profile2.categories!.map((category) => category.name)).toEqual(['Servers id=7'])
    expect(profile2.actions!.map((entry) => entry.name)).toEqual(['Join id=42', 'Spare id=43'])
    expect(normalize(renderProfileFile(profile2))).toBe(normalize(text1))
  })
})
