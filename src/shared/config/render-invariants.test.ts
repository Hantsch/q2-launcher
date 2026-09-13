import { describe, expect, it } from 'vitest'
import type { ConfigAction, ConfigProfile } from '../modules/config'
import type { SectionHeaderStyle } from './cfg-layout'
import { actionKeySlots } from './action-slots'
import { aliasNameFor, renderActionAlias, twoPartAliasNames } from './alias-render'
import { bindValueFor } from './action-mirror'
import { generateLayerAliases } from './alt-layers'
import { readOwnershipStamp } from './file-ownership'
import { ROUND_TRIP_FIXTURES } from './fixtures/profiles'
import { KNOWN_META_KEYS, META_FORMAT_VERSION, parseMetaTag } from './profile-metadata'
import { PROFILE_FIXTURES, SELF_REFERENCE_FIXTURES } from './profile-fixtures'
import {
  HAND_EDIT_SENTENCE,
  OWNERSHIP_MARKER,
  renderProfileFile,
  STRICTEST_LINE_BUDGET,
} from './render'
import { validateActions } from './validate-actions'
import { validateStructure } from './validate-structure'

/**
 * Story 038 D3 - the file-level invariant (AC4), asserted over every corpus
 * profile in `profile-fixtures.ts` rather than one hand-built case, and
 * failing loudly with the offending alias name when it does not hold.
 *
 * ## Scope
 *
 * AC4's blanket invariant is read, per the story's Decisions (Sprint), as
 * holding for every alias line the writer generates *for an action* whose
 * mirror does not go through the alias - not for a layer's own generated
 * aliases (`generateLayerAliases`'s dispatch/helper/chunk names). Those have
 * no "source action" at all, and a hold layer's release half (e.g. `-drops`)
 * is legitimately unreferenced by any token in the file text by design - it
 * is only ever invoked by the engine's own `+`/`-` key-release convention,
 * the exact same shape story 038 fixes for actions except the engine, not
 * the writer, is the caller. Every layer-generated name is therefore
 * collected once per profile (`layerGeneratedAliasNames`) and excluded from
 * the per-action check below; anything left over that still cannot be tied
 * back to a known action fails the test rather than being silently skipped.
 *
 * ## The two exemptions
 *
 * Expressed exactly as `actionsWithAliasLine` (`alias-references.ts`)
 * expresses them - `action.kind === 'alias'` (AC6) or `bindValueFor(action)
 * === aliasNameFor(action)` (the User decision covering a keyless/free-form
 * action) - never via the `q2l_a_` prefix, so story 039 (which removes that
 * prefix) cannot silently break this test.
 */

/**
 * Every alias name a profile's layers generate on their own - out of this
 * invariant's scope (see the file doc comment above).
 */
function layerGeneratedAliasNames(profile: ConfigProfile): Set<string> {
  const names = new Set<string>()
  for (const layer of profile.layers ?? []) {
    for (const alias of generateLayerAliases(layer, profile.binds).aliases) {
      names.add(alias.name.toLowerCase())
    }
  }
  return names
}

/** Every candidate reference token on one rendered line, lower-cased. */
function lineTokens(line: string): string[] {
  return line
    .split(/[\s";]+/)
    .filter((token) => token.length > 0)
    .map((token) => token.toLowerCase())
}

/** Does `name` occur as a whole token on any rendered line other than `skipIndex`? */
function appearsElsewhere(lines: string[], skipIndex: number, name: string): boolean {
  const lower = name.toLowerCase()
  return lines.some((line, index) => index !== skipIndex && lineTokens(line).includes(lower))
}

describe('render invariants (story 038 D3, AC4)', () => {
  for (const [fixtureName, profile] of Object.entries(PROFILE_FIXTURES)) {
    it(`"${fixtureName}": no alias line whose name is referenced by nothing else in the file`, () => {
      const rendered = renderProfileFile(profile)
      const lines = rendered.split('\n')
      const layerNames = layerGeneratedAliasNames(profile)
      const actions = profile.actions ?? []

      // Every name `renderActionAlias` would use for a given action, chunk
      // suffixes included - whether or not the writer actually kept that
      // action's line - so a rendered line can always be traced back to the
      // action it came from.
      const actionByAliasName = new Map<string, ConfigAction>()
      for (const action of actions) {
        for (const alias of renderActionAlias(action).aliases) {
          actionByAliasName.set(alias.name.toLowerCase(), action)
        }
      }

      lines.forEach((line, index) => {
        const match = /^alias\s+(\S+)/i.exec(line)
        if (!match) return
        const name = match[1]!
        const lower = name.toLowerCase()

        // Out of scope - a layer's own generated alias, not an action's (see
        // the file doc comment).
        if (layerNames.has(lower)) return

        const action = actionByAliasName.get(lower)
        expect(
          action,
          `"${fixtureName}": rendered "alias ${name}" does not correspond to any known action or layer alias`,
        ).toBeDefined()

        // The two documented exemptions (AC6, User decision) - expressed via
        // `kind`/`bindValueFor`/`aliasNameFor`, never the `q2l_a_` prefix - plus
        // a third one story 045 adds for the same reason the file doc comment
        // already exempts a hold layer's `-drops` half: a `press-release`
        // entry's `-` half is invoked by the engine's own key-release
        // convention and by nothing in the file text, so no token can reference
        // it by design. `twoPartAliasNames` is what the writer names the two
        // halves with, so this cannot drift from what is rendered.
        const exempt =
          action!.kind === 'alias' ||
          bindValueFor(action!) === aliasNameFor(action!) ||
          (action!.kind === 'press-release' &&
            twoPartAliasNames(action!)?.second.toLowerCase() === lower)
        if (exempt) return

        expect(
          appearsElsewhere(lines, index, name),
          `"${fixtureName}": alias "${name}" is defined but referenced by nothing else in the rendered file`,
        ).toBe(true)
      })
    })
  }

  /**
   * AC4's "no new `validateStructure` finding" bullet, read pragmatically
   * (D1/D2 are already in the working tree, so "pre-change" behaviour is not
   * directly re-creatable by running old code): every corpus profile's
   * rendered output is asserted to produce *zero* `validateStructure`
   * findings, so nothing this fix could have introduced - an `aliasCycle`
   * from a dangling reference, a `quoteBroken` line, anything else the
   * validator knows to look for - has anywhere to hide among a pre-existing
   * finding.
   */
  it('validateStructure reports zero findings for every corpus profile', () => {
    for (const [fixtureName, profile] of Object.entries(PROFILE_FIXTURES)) {
      const rendered = renderProfileFile(profile)
      const findings = validateStructure([{ name: 'fixture.cfg', content: rendered }], 'r1q2')

      expect(findings, `"${fixtureName}" produced unexpected validateStructure findings`).toEqual(
        [],
      )
    }
  })

  /**
   * The `chunkedSignedBody` fixture only pins story 039's fourth-pass defect 1
   * (`validate-structure.ts`'s carve-out being scoped to the visited chunk
   * instead of the alias family it belongs to) for as long as it really does
   * split into a `_p<n>` family whose first part opens with `+forward`. Asserted
   * explicitly, so a future change to the line budget cannot quietly turn the
   * zero-findings assertion above into a test of the unsplit case.
   */
  it('the chunkedSignedBody fixture really renders a _p<n> family opening with its own +command', () => {
    const rendered = renderProfileFile(PROFILE_FIXTURES.chunkedSignedBody!)

    expect(rendered).toContain('alias forward_p1 "+forward;')
    // `\s+`, not a single space: story 040 D3 aligns a section's value column, so the family
    // root's shorter `alias forward` head is padded out to the width of its own `_p<n>` parts.
    expect(rendered).toMatch(/^alias forward\s+"forward_p1; forward_p2/m)
  })

  /**
   * Story 039, fourth pass - the User's decision on the multi-command
   * self-reference case. The alias line is kept as authored (every command the
   * user wrote is still in the file), so `validateStructure` legitimately reports
   * an error-level `aliasCycle` for it - and `validate-actions.ts`'s
   * `aliasSelfReference` has to show up *alongside* that, never instead of it:
   * the structural finding describes the rendered file, the Care finding names
   * the entry and the command the user can actually change.
   */
  // -------------------------------------------------------------------------
  // Story 050 D8: the tag-shape invariants, asserted over BOTH corpora - this
  // file's own (`profile-fixtures.ts`) and the round-trip corpus
  // (`fixtures/profiles.ts`, which is where every key-slot shape lives).
  //
  // These are the writer-side half of D8. The reader-side half (parse ->
  // restore -> re-render, and the adversarial hand edits) lives in
  // `src/main/modules/config/round-trip.test.ts` and cannot move here: the
  // parser that turns config text back into lines is `import-reader.ts`, a
  // main-process module, and `src/shared` may not import from main (CLAUDE.md).
  // -------------------------------------------------------------------------

  /** Every `[q2l …]` tag in a rendered file, as the tag text alone. A code line's tag ends the
   * line, a banner's sits inside trailing decoration, so the tail is cut at its own `]` - the same
   * cut `profile-restore.ts#tagEndIndex` makes before handing a comment to the grammar. */
  function tagsIn(rendered: string): { line: string; tag: string }[] {
    const tags: { line: string; tag: string }[] = []
    for (const line of rendered.split('\n')) {
      const sigil = line.lastIndexOf('[q2l')
      if (sigil === -1) continue
      const close = line.indexOf(']', sigil)
      tags.push({ line, tag: line.slice(sigil, close === -1 ? undefined : close + 1) })
    }
    return tags
  }

  /** Could this rendered line have carried even the bare `[q2l]` marker? `attachTaggedComment`
   * needs `<code>  // ` (five characters past the code) plus the tag inside
   * `STRICTEST_LINE_BUDGET - 1`; a five-character marker is the smallest tag there is. */
  function roomForATag(line: string): boolean {
    const code = line.replace(/\s+\/\/.*$/, '')
    return code.length + '  // '.length + '[q2l]'.length <= STRICTEST_LINE_BUDGET - 1
  }

  const ALL_FIXTURES: [string, ConfigProfile][] = [
    ...Object.entries(PROFILE_FIXTURES),
    ...ROUND_TRIP_FIXTURES.map((profile): [string, ConfigProfile] => [profile.name, profile]),
  ]

  it('every tag the writer emits is well-formed and carries only registered keys', () => {
    for (const [fixtureName, profile] of ALL_FIXTURES) {
      const rendered = renderProfileFile(profile)
      const tags = tagsIn(rendered)
      // Every launcher file has at least the header block's `[q2l v=1]`, so an empty list would mean
      // this fixture proves nothing.
      expect(tags.length, `"${fixtureName}" rendered no tag at all`).toBeGreaterThan(0)

      for (const { line, tag } of tags) {
        const parsed = parseMetaTag(tag)
        expect(parsed.malformed, `"${fixtureName}": malformed tag on "${line}"`).toBe(false)
        expect(parsed.unknownKeys, `"${fixtureName}": unregistered key on "${line}"`).toEqual([])
        for (const key of Object.keys(parsed.fields)) {
          expect(KNOWN_META_KEYS as readonly string[], `"${fixtureName}": "${line}"`).toContain(key)
        }
      }
    }
  })

  it('no tag carries a key story 050 removed (AC1: e, k and slot are never written)', () => {
    // The story's first AC, stated directly rather than left implied by the unknown-key check above:
    // those three were registered keys once, so a reintroduction would parse cleanly and pass every
    // other assertion in this file.
    for (const [fixtureName, profile] of ALL_FIXTURES) {
      for (const { line, tag } of tagsIn(renderProfileFile(profile))) {
        const fields = Object.keys(parseMetaTag(tag).fields)
        for (const removed of ['e', 'k', 'slot']) {
          expect(fields, `"${fixtureName}": removed key "${removed}" on "${line}"`).not.toContain(
            removed,
          )
        }
      }
    }
  })

  it('every entry line carries a tag, down to the bare [q2l] marker on a fieldless one', () => {
    // Tag *presence* is the only thing left that tells a launcher-owned line from a raw bind the
    // user typed and commented themselves (story 050's own decision), so a missing marker is not a
    // cosmetic slip: such a line reads back unowned, moves into "Other binds" on the next render,
    // and story 042's fixed point is gone one render later. Asserted per line the writer *must*
    // have emitted, derived from the model through the same two accessors the writer itself uses.
    let checked = 0
    for (const [fixtureName, profile] of ALL_FIXTURES) {
      const rendered = renderProfileFile(profile)
      const lines = rendered.split('\n')
      const layerNames = layerGeneratedAliasNames(profile)

      for (const action of profile.actions ?? []) {
        const value = bindValueFor(action)

        // A slot with no modifier is mirrored into `profile.binds` and gets a real `bind` line -
        // unless the profile's own bind table says something else runs on that key, which is the
        // "the config line wins" case and not this entry's line at all.
        for (const slot of actionKeySlots(action)) {
          if (slot.modifier) continue
          const bound = Object.entries(profile.binds).find(
            ([key]) => key.toLowerCase() === slot.key.toLowerCase(),
          )
          if (!bound || bound[1] !== value) continue
          const bindLine = lines.find((line) =>
            new RegExp(`^bind\\s+${bound[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s`, 'i').test(line),
          )
          expect(bindLine, `"${fixtureName}": no bind line for slot "${slot.key}"`).toBeDefined()
          if (!roomForATag(bindLine!)) {
            // The one documented exception, and it outranks the marker: "the command is the
            // contract, so when command and comment cannot both fit, the comment is what gives"
            // (`cfg-layout.ts#attachTaggedComment`). A command long enough to fill a whole 1024-byte
            // engine line on its own therefore leaves no room for even the bare `[q2l]`, and the
            // comment is dropped WHOLE - which is what is asserted here instead, since a half tag
            // would be worse than none. Under story 050 that costs the line its ownership (tag
            // presence is the ownership signal), so such an entry's key reads back unowned; only
            // `profile-fixtures.ts`' deliberately pathological `chunkSplit` fixture reaches it, and
            // shortening the tag is what made it *less* reachable than it was before this story.
            expect(bindLine!, `"${fixtureName}": a tag was cut instead of dropped`).not.toContain('[q2l')
            continue
          }
          expect(bindLine!, `"${fixtureName}": bind line without a tag`).toContain('[q2l')
          checked++
        }
      }

      // The same for the alias lines: every rendered `alias` line that belongs to an action (a
      // layer's own generated aliases are out of scope, exactly as in the AC4 test above).
      const actionAliasNames = new Set(
        (profile.actions ?? []).flatMap((action) =>
          renderActionAlias(action).aliases.map((alias) => alias.name.toLowerCase()),
        ),
      )
      for (const line of lines) {
        const match = /^alias\s+(\S+)/i.exec(line)
        if (!match) continue
        const name = match[1]!.toLowerCase()
        if (layerNames.has(name) || !actionAliasNames.has(name)) continue
        expect(line, `"${fixtureName}": alias line without a tag`).toContain('[q2l')
        checked++
      }

    }

    // A floor across the whole corpus, not per fixture (a keyless or alias-less fixture
    // legitimately contributes nothing). It is what stops this test passing vacuously, which is not
    // hypothetical: while the two fixture corpora still carried the pre-050 `key`/`secondaryKey`
    // field names, every action in them rendered with no key slots at all - the files came out as
    // bare headers and this loop would have checked exactly zero lines while reporting green.
    expect(checked, 'the fixture corpora rendered almost no entry lines - have they gone inert?')
      .toBeGreaterThan(40)
  })

  // -------------------------------------------------------------------------
  // Story 051 D6: the header block, as a writer-side invariant over BOTH corpora.
  //
  // D2 pins the shape on one profile; what has no home until here is the same
  // statement over every profile the corpora carry - including the three whose
  // *profile-level* fields are adversarial (a blank name, a name spelled like a
  // tag, `id=` all over the body). The header is written from `profile.name` and
  // `profile.id` and from nothing else, so a profile is the only thing that can
  // break it, and a corpus-wide loop is the only way to be sure none of them
  // does. The reader-side half (parse -> restore -> re-render, plus the
  // hand-mangled headers) lives in `round-trip.test.ts`, for the reason the
  // block above already gives: the parser is a main-process module.
  // -------------------------------------------------------------------------
  describe('the header block (story 051 D6)', () => {
    /** The `=` rule `banner(…, { fill: '=' })` draws - the block's first and third line. */
    const HEADER_RULE = /^\/\/ ={10,}$/

    it('every corpus profile renders the four-line banner, tag last and id nowhere else', () => {
      for (const [fixtureName, profile] of ALL_FIXTURES) {
        const rendered = renderProfileFile(profile)
        const [openingRule, nameLine, closingRule, tagLine] = rendered.split('\n')
        const where = `"${fixtureName}"`

        expect(openingRule, `${where}: no opening rule`).toMatch(HEADER_RULE)
        expect(closingRule, `${where}: the two rules differ`).toBe(openingRule)
        expect(nameLine!.startsWith('//'), `${where}: the name line is not a comment`).toBe(true)
        // The tag alone on the block's last line, right-aligned (the User's decision), and carrying
        // exactly the two fields ownership needs - never riding on the name line any more.
        expect(tagLine, `${where}: the tag line is not the tag alone`).toMatch(
          new RegExp(`^// +\\[q2l v=${META_FORMAT_VERSION} id=\\S+\\]$`),
        )
        expect(nameLine, `${where}: a tag on the name line`).not.toContain('[q2l')

        // AC3: the id travels in that one tag and in no other line of the file - not in prose, not
        // in a sentinel, not twice.
        expect(
          rendered.split('\n').filter((line) => line.includes(profile.id)),
          `${where}: the profile id appears outside the header tag`,
        ).toEqual([tagLine])
        expect(rendered, `${where}: a sentinel line`).not.toContain(OWNERSHIP_MARKER)
        expect(rendered, `${where}: the hand-edit sentence`).not.toContain(HAND_EDIT_SENTENCE)

        // AC2: not one word the *writer* puts in this block is a technical one. Deliberately not
        // applied to the name line: that is the player's own text and they may call a profile
        // anything they like ("Hold Layer Generated Body" is a real fixture name), so asserting
        // over it would be a test of the corpus' vocabulary rather than of this writer's.
        expect(
          [openingRule, closingRule, tagLine].join('\n'),
          `${where}: a technical word in the header`,
        ).not.toMatch(/hand-edited|metadata|version|generated/i)

        // AC8: the frame is plain ASCII (the name line may legitimately carry latin-1 - that is the
        // range the whole writer promises, and `sanitizeComment` drops everything above it).
        for (const line of [openingRule, closingRule, tagLine]) {
          expect(line, `${where}: a non-ASCII character in the frame`).toMatch(/^[ -~]*$/)
        }
        expect(nameLine, `${where}: a character beyond latin-1 on the name line`).toMatch(/^[ -ÿ]*$/)

        // The header the launcher writes is one D1 reads back as its own, with the profile's own id
        // - the property every ownership guard in `main/modules/config` rests on.
        expect(readOwnershipStamp(rendered), `${where}: not recognised as launcher-owned`).toEqual({
          id: profile.id,
          version: String(META_FORMAT_VERSION),
          shape: 'banner',
        })

        // AC8's other half: no timestamp, nothing else per-run - two renders of one profile are the
        // same bytes, header included.
        expect(renderProfileFile(profile), `${where}: the render is not deterministic`).toBe(rendered)
      }
    })
  })

  for (const [fixtureName, profile] of Object.entries(SELF_REFERENCE_FIXTURES)) {
    it(`"${fixtureName}": the kept self-referencing line reports aliasCycle *and* aliasSelfReference`, () => {
      const rendered = renderProfileFile(profile)
      const actions = profile.actions ?? []

      // Kept as authored: no command silently lost.
      for (const command of actions.flatMap((action) => action.commands)) {
        if (command.kind !== 'raw') continue
        expect(rendered, `"${fixtureName}": "${command.text}" is missing from the render`).toContain(
          command.text,
        )
      }

      const structure = validateStructure([{ name: 'fixture.cfg', content: rendered }], 'r1q2')
      const cycles = structure.filter((finding) => finding.messageKey.endsWith('aliasCycle'))
      expect(cycles).toHaveLength(1)
      expect(cycles[0]!.level).toBe('error')

      const care = validateActions(actions, 'r1q2', { binds: profile.binds, layers: profile.layers })
      const selfReferences = care.filter((finding) =>
        finding.messageKey.endsWith('aliasSelfReference'),
      )
      expect(selfReferences).toHaveLength(1)
      expect(selfReferences[0]!.level).toBe('warning')
    })
  }

  // -------------------------------------------------------------------------
  // Story 053 D2: the writer's second bucketing level (a category's ungrouped
  // run, then one banner-and-body block per sub-category, emitted even for an
  // empty one) - asserted directly on a fixture built for this shape, since
  // none of the corpora above carry `subcategories` yet (that only starts
  // once D3's `profile-restore.ts` can read a sub-banner back, so this
  // fixture stays local to this test rather than joining `profile-fixtures.ts`).
  // -------------------------------------------------------------------------
  describe('sub-category bucketing and banner emission (story 053 D2)', () => {
    const ungroupedAction: ConfigAction = {
      id: 'sub-a-ungrouped',
      categoryId: 'weapons',
      name: 'Ungrouped Entry',
      kind: 'bind',
      commands: [{ kind: 'raw', text: 'centerview' }],
      keys: [{ key: 'v' }],
    }
    const useWeaponAction: ConfigAction = {
      id: 'sub-a-use',
      categoryId: 'weapons',
      subcategoryId: 'use',
      name: 'Use SSG',
      kind: 'bind',
      commands: [{ kind: 'raw', text: 'use shotgun' }],
      keys: [{ key: 'q' }],
    }
    const cyclingAction: ConfigAction = {
      id: 'sub-a-cycling',
      categoryId: 'weapons',
      subcategoryId: 'cycling',
      name: 'Weapon next',
      kind: 'bind',
      commands: [{ kind: 'raw', text: 'weapnext' }],
      keys: [{ key: 'mwheelup' }],
    }
    // A dangling `subcategoryId` - matches none of the category's `subcategories` - falls into the
    // ungrouped run, mirroring how a dangling `categoryId` falls into `groupByCategory`'s "other"
    // bucket (Decisions (Sprint)).
    const danglingSubAction: ConfigAction = {
      id: 'sub-a-dangling',
      categoryId: 'weapons',
      subcategoryId: 'does-not-exist',
      name: 'Dangling Sub',
      kind: 'bind',
      commands: [{ kind: 'raw', text: '+strafe' }],
      keys: [{ key: 'j' }],
    }

    function subcategoryProfile(style: SectionHeaderStyle): ConfigProfile {
      const actions = [ungroupedAction, useWeaponAction, cyclingAction, danglingSubAction]
      return {
        id: 'fixture-subcategories',
        name: 'Sub-category Fixture',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        cvars: {},
        binds: Object.fromEntries(
          actions.flatMap((action) => actionKeySlots(action).map((slot) => [slot.key, bindValueFor(action)])),
        ),
        assignments: [],
        sectionHeaderStyle: style,
        categories: [
          {
            id: 'weapons',
            name: 'Weapons',
            subcategories: [
              { id: 'use', name: 'Use weapon' },
              { id: 'cycling', name: 'Cycling' },
              // Never claimed by any action - the "empty sub-category still writes its banner" case.
              { id: 'empty', name: 'Empty Sub' },
            ],
          },
        ],
        actions,
      }
    }

    /** Every sub-banner and category-banner line, in file order, for the `Binds: Weapons` section
     * only - the section this test asserts structure over. */
    function bindsWeaponsSectionLines(rendered: string): string[] {
      const lines = rendered.split('\n')
      const start = lines.findIndex((line) => line.includes('Binds: Weapons'))
      expect(start, 'no "Binds: Weapons" section header found').toBeGreaterThanOrEqual(0)
      // The next blank line (`joinBlocks`' own separator) ends the section - or end of file.
      let end = lines.indexOf('', start)
      if (end === -1) end = lines.length
      return lines.slice(start, end)
    }

    for (const style of ['dashes', 'brackets', 'plain'] as const) {
      it(`renders category header -> ungrouped rows -> sub-banner + rows, in profile order (${style} style)`, () => {
        const rendered = renderProfileFile(subcategoryProfile(style))
        const section = bindsWeaponsSectionLines(rendered)

        const categoryHeaderIndex = section.findIndex((line) => line.includes('Binds: Weapons'))
        const ungroupedIndex = section.findIndex((line) => line.includes('bind v '))
        const danglingIndex = section.findIndex((line) => line.includes('bind j '))
        const useBannerIndex = section.findIndex((line) => line.includes('[q2l sub=use]'))
        const useRowIndex = section.findIndex((line) => line.includes('bind q '))
        const cyclingBannerIndex = section.findIndex((line) => line.includes('[q2l sub=cycling]'))
        const cyclingRowIndex = section.findIndex((line) => line.includes('bind mwheelup '))
        const emptyBannerIndex = section.findIndex((line) => line.includes('[q2l sub=empty]'))

        // Every index has to actually be found (never -1) before the ordering comparison below
        // means anything.
        for (const [label, index] of Object.entries({
          categoryHeaderIndex,
          ungroupedIndex,
          danglingIndex,
          useBannerIndex,
          useRowIndex,
          cyclingBannerIndex,
          cyclingRowIndex,
          emptyBannerIndex,
        })) {
          expect(index, `"${label}" not found in the ${style}-style Binds: Weapons section`).toBeGreaterThanOrEqual(0)
        }

        // Category header, then the ungrouped run (profile order: the untagged entry, then the
        // dangling-subcategory one), then each sub-category's own banner immediately followed by
        // its row, in `category.subcategories` order - and the empty sub-category's banner still
        // appears, with nothing of its own between it and the end of the section.
        expect(categoryHeaderIndex).toBeLessThan(ungroupedIndex)
        expect(ungroupedIndex).toBeLessThan(danglingIndex)
        expect(danglingIndex).toBeLessThan(useBannerIndex)
        expect(useBannerIndex).toBeLessThan(useRowIndex)
        expect(useRowIndex).toBeLessThan(cyclingBannerIndex)
        expect(cyclingBannerIndex).toBeLessThan(cyclingRowIndex)
        expect(cyclingRowIndex).toBeLessThan(emptyBannerIndex)
        // The empty sub-category's banner is the section's last line - nothing follows it.
        expect(emptyBannerIndex).toBe(section.length - 1)

        // No stray `cat=`/`ord=` on a sub-banner: the parent category is derivable from the
        // section it sits in (story 050's minimum-tag rule).
        expect(section[useBannerIndex]).not.toContain('cat=')
        expect(section[cyclingBannerIndex]).not.toContain('cat=')
        expect(section[emptyBannerIndex]).not.toContain('cat=')
      })
    }

    it('an unrecognised subcategoryId falls into the ungrouped run, not its own bucket', () => {
      const rendered = renderProfileFile(subcategoryProfile('dashes'))
      expect(rendered).not.toContain('sub=does-not-exist')
    })
  })
})
