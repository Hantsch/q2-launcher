import { describe, expect, it } from 'vitest'
import type { ConfigAction, ConfigProfile } from '../modules/config'
import { aliasNameFor, renderActionAlias } from './alias-render'
import { bindValueFor } from './action-mirror'
import { generateLayerAliases } from './alt-layers'
import { PROFILE_FIXTURES } from './profile-fixtures'
import { renderProfileFile } from './render'
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
        // `kind`/`bindValueFor`/`aliasNameFor`, never the `q2l_a_` prefix.
        const exempt =
          action!.kind === 'alias' || bindValueFor(action!) === aliasNameFor(action!)
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
})
