import { describe, expect, it } from 'vitest'
import type { ConfigProfile } from '@shared/modules/config'
import { generateLayerAliases } from '@shared/config/alt-layers'
import { renderProfileFile } from '@shared/config/render'
import { ROUND_TRIP_FIXTURES } from '@shared/config/fixtures/profiles'
import { normalize, slotsOf, reimportProfile, findFixture, installRoundTripRoot } from './helpers'

installRoundTripRoot()

describe('an entry bound only through a modifier keeps its identity', () => {
  for (const name of ['Modifier-only catalogue entry', 'Self-mirroring alias']) {
    it(`"${name}": name, kind, categoryId, catalogId and its one modified key slot all survive`, async () => {
      const profile = findFixture(name)
      const original = profile.actions![0]!
      const { profile2 } = await reimportProfile(profile)

      // Before the fix this was `[]`: the entry had no alias line (its alias is dropped) and no base
      // bind line (a modified slot lives in the ALT layer), so no line in the file carried its tag.
      expect(profile2.actions).toHaveLength(1)
      const restored = profile2.actions![0]!
      expect(restored.name).toBe(original.name)
      expect(restored.kind).toBe(original.kind)
      expect(restored.categoryId).toBe(original.categoryId)
      expect(restored.catalogId).toBe(original.catalogId)
      // One slot, still modified, still the same key - and no second slot invented for it.
      expect(slotsOf(restored)).toEqual(slotsOf(original))
      expect(slotsOf(restored)).toHaveLength(1)
      // The command itself comes back out of the layer override the anchor names, so the entry still
      // renders (and binds) identically rather than coming back as an empty nameplate.
      expect(restored.commands).toEqual(original.commands)
      // The id is minted locally, never adopted from the file.
      expect(restored.id).not.toBe(original.id)
    })
  }
})

describe('slot assignment does not depend on layer array order', () => {
  it('two constructions of one profile, layers in opposite order, restore identically', async () => {
    const altFirst = findFixture('Two-slot two-modifier entry')
    const ctrlFirst = findFixture('Two-slot two-modifier entry (layers reversed)')

    // Same logical profile: one entry, r/ALT in slot 1 and t/CTRL in slot 2, two layers.
    expect(slotsOf(ctrlFirst.actions![0]!)).toEqual(slotsOf(altFirst.actions![0]!))
    expect(ctrlFirst.layers!.map((layer) => layer.triggerKey)).toEqual(
      [...altFirst.layers!].reverse().map((layer) => layer.triggerKey),
    )

    const slots = async (profile: ConfigProfile) => {
      const { profile2 } = await reimportProfile(profile)
      return profile2.actions!.map((entry) => ({ name: entry.name, slots: slotsOf(entry) }))
    }

    const fromAltFirst = await slots(altFirst)
    const fromCtrlFirst = await slots(ctrlFirst)

    expect(fromCtrlFirst).toEqual(fromAltFirst)
    // And the order really comes from the file - the anchor lines, in the order the writer emitted
    // them - not from whichever layer section happened to come first, which for this profile is also
    // the original assignment.
    expect(fromAltFirst).toEqual([{ name: 'Reload weapon', slots: ['ALT+r', 'CTRL+t'] }])
  })
})

describe('both slots modified plus an alias line keeps its slot assignment', () => {
  /** The one entry's two slots as they came back, for one fixture. */
  const slots = async (profile: ConfigProfile) => {
    const { profile2 } = await reimportProfile(profile)
    expect(profile2.actions).toHaveLength(1)
    const entry = profile2.actions![0]!
    return { slots: slotsOf(entry), aliasName: entry.aliasName }
  }

  it('the anti-alphabetical assignment (t/CTRL first, r/ALT second) is not swapped', async () => {
    // Before the fix the anchor gate was per action, not per slot: this entry HAS a line (its alias
    // line, kept because it carries an own alias name), but that line records no key or modifier at
    // all, so both slots fell through to the (modifier, key) fallback - which sorts ALT first and
    // therefore handed `r`/ALT the first slot.
    expect(await slots(findFixture('Own alias name, both slots modified'))).toEqual({
      slots: ['CTRL+t', 'ALT+r'],
      aliasName: 'rail_combo',
    })
  })

  it('the mirrored assignment (r/ALT first, t/CTRL second) is not swapped either', async () => {
    // The same shape with its two slots exchanged: a "fix" that merely inverted the guess would
    // break exactly here.
    expect(
      await slots(findFixture('Own alias name, both slots modified (mirrored slots)')),
    ).toEqual({
      slots: ['ALT+r', 'CTRL+t'],
      aliasName: 'rail_combo',
    })
  })

  it('does not depend on the order the two layer sections appear in', async () => {
    expect(
      await slots(findFixture('Own alias name, both slots modified (layers reversed)')),
    ).toEqual(await slots(findFixture('Own alias name, both slots modified')))
  })
})

describe('an anchored entry keeps its own alias name', () => {
  it('"Own alias name on an anchored entry": aliasName survives, and the second render is the same file', async () => {
    const profile = findFixture('Own alias name on an anchored entry')
    const original = profile.actions![0]!
    const { profile2, text1 } = await reimportProfile(profile)

    expect(profile2.actions).toHaveLength(1)
    const restored = profile2.actions![0]!
    // The whole point: with no alias line (dropped as a self-mirror) and no bind line (the slot is
    // modified), the anchor's `an` field is the only place this name can live.
    expect(restored.aliasName).toBe(original.aliasName)
    expect(restored.name).toBe(original.name)
    expect(slotsOf(restored)).toEqual(slotsOf(original))
    expect(restored.commands).toEqual(original.commands)

    // Before the fix the second render dropped the anchor and grew a real `alias next_weapon
    // weapnext` line instead - a different file, i.e. not a fixed point.
    const text2 = renderProfileFile(profile2)
    expect(text2).not.toContain('alias next_weapon')
    expect(normalize(text2)).toBe(normalize(text1))
  })
})

describe('a `---` in a display name is not read as a section header', () => {
  it('"Anchor display name containing a banner rule": both entries keep their category', async () => {
    const profile = findFixture('Anchor display name containing a banner rule')
    const { profile2, text1 } = await reimportProfile(profile)

    // The anchor line really does carry a banner rule inside its prose - if this ever stopped being
    // true the rest of the test would pass for the wrong reason.
    expect(text1).toMatch(/^\/\/ Strafe --- left \[q2l /m)

    expect(profile2.actions).toHaveLength(2)
    const byName = new Map(profile2.actions!.map((entry) => [entry.name, entry]))
    // Before the fix the FIRST anchor was read as an untagged banner as well, minting a category
    // named `Strafe --- left` and re-filing the second entry (the next line in the same section)
    // under it.
    expect(byName.get('Strafe --- left')!.categoryId).toBe('movement')
    expect(byName.get('Strafe right')!.categoryId).toBe('movement')
    // `movement` is minted like any other category (keeping its id), so what this
    // pins is that it is the *only* one - no second category named after somebody's display name.
    expect(profile2.categories).toEqual([
      { id: 'movement', name: 'Movement', nameKey: 'config.controls.categories.movement' },
    ])

    // ...and therefore the second render is the same file, with no section header named after that
    // display name (a header is the only line that carries a `cat=` tag).
    const text2 = renderProfileFile(profile2)
    expect(text2).not.toMatch(/^\/\/.*Strafe --- left.*\[q2l cat=/m)
    expect(normalize(text2)).toBe(normalize(text1))
  })
})

describe('a layer\'s own trigger bind does not leak into "Other binds" on reimport', () => {
  const triggeredFixtureNames = [
    'Hold layer',
    'Two-slot entry with a layer override',
    'Two-slot two-modifier entry',
  ]

  for (const name of triggeredFixtureNames) {
    it(`"${name}": the reimported profile gains the physical trigger bind, but it never renders unowned`, async () => {
      const profile = ROUND_TRIP_FIXTURES.find((p) => p.name === name)!
      const { profile2, text1 } = await reimportProfile(profile)
      const text2 = renderProfileFile(profile2)

      for (const layer of profile.layers ?? []) {
        const { triggerBind } = generateLayerAliases(layer, profile.binds)
        expect(triggerBind).not.toBeNull()
        if (!triggerBind) continue
        // The original profile never carried this key in `profile.binds` at all (the trigger bind
        // is generated, not stored) - re-importing the rendered file legitimately picks it up as a
        // real, physical bind.
        expect(profile.binds[triggerBind.key]).toBeUndefined()
        expect(profile2.binds[triggerBind.key]).toBe(triggerBind.command)
      }

      // The gap this D found and closed: that newly-physical bind must not render a second time,
      // unowned, in an "Other binds" section - the fixed point holds with no special-casing.
      expect(text2).not.toContain('Other binds')
      expect(normalize(text2)).toBe(normalize(text1))
    })
  }
})

describe('slot identity comes from file order, uncapped', () => {
  it('"Hand-added third key": three bind lines on one value come back as three slots, no field involved', async () => {
    const profile = findFixture('Hand-added third key')
    const { profile2, text1 } = await reimportProfile(profile)

    // Three physical bind lines, all running the same value, each carrying only `cid` - no `e=`, no
    // `slot=`. Without this the rest of the case could pass on a two-key entry.
    const bindLines = text1.split('\n').filter((line) => /^bind \S+\s+"drop_rockets"/.test(line))
    expect(bindLines).toHaveLength(3)
    for (const line of bindLines) {
      expect(line).toContain('[q2l cid=drop-rockets]')
    }

    expect(profile2.actions).toHaveLength(1)
    // Slot order is the file's line order (the writer sorts a section's bind lines by key), which is
    // f, g, h - not the g, h, f the fixture was constructed with. That reordering is the story's own
    // rule ("first occurrence is slot 1"), and it is why the third key survives at all: the pre-050
    // cap of two would have dropped one of these three or reported a slot conflict.
    expect(slotsOf(profile2.actions![0]!)).toEqual(['f', 'g', 'h'])
    expect(profile2.actions![0]!.catalogId).toBe('drop-rockets')
  })

  it('"Third slot carries a modifier": bind-line claims come before the anchor claim', async () => {
    const { profile2 } = await reimportProfile(findFixture('Third slot carries a modifier'))

    expect(profile2.actions).toHaveLength(1)
    // Two plain keys off their bind lines, then the modified one off its anchor line - the claim
    // order `buildEntry` documents, on an entry that exercises both claim paths at once.
    expect(slotsOf(profile2.actions![0]!)).toEqual(['j', 'k', 'CTRL+l'])
  })

  it('"Modified slot 1 next to a plain slot 2": both slots survive, swapped, and the file holds still', async () => {
    const profile = findFixture('Modified slot 1 next to a plain slot 2')
    expect(slotsOf(profile.actions![0]!)).toEqual(['ALT+r', 't'])

    const { profile2, text1 } = await reimportProfile(profile)
    expect(profile2.actions).toHaveLength(1)
    // The documented consequence, asserted rather than hoped for: the plain slot's `bind` line is
    // claimed before the modified slot's anchor, so the two exchange places exactly once. Nothing is
    // lost - both keys and the modifier are all still here.
    expect(slotsOf(profile2.actions![0]!)).toEqual(['t', 'ALT+r'])

    // And the swap is a one-off, not a drift: the second render is the same file, and a third render
    // (from the re-restored profile) is too - the flipped order is itself a fixed point.
    const text2 = renderProfileFile(profile2)
    expect(normalize(text2)).toBe(normalize(text1))
    const { profile2: profile3 } = await reimportProfile(profile2)
    expect(slotsOf(profile3.actions![0]!)).toEqual(['t', 'ALT+r'])
  })

  it('"Two bind lines on one value": paired into one entry with two keys, with no alias line at all (AC4)', async () => {
    const profile = findFixture('Two bind lines on one value')
    const { profile2, text1 } = await reimportProfile(profile)

    // The file really does hold two bind lines and NO alias line for this entry - the pairing has
    // nothing but the shared bind value to work from.
    expect(text1).toMatch(/^bind UPARROW\s+"\+forward"\s+\/\/ Forward \[q2l cid=forward\]$/m)
    expect(text1).toMatch(/^bind w\s+"\+forward"\s+\/\/ Forward \[q2l cid=forward\]$/m)
    expect(text1).not.toContain('alias')

    expect(profile2.actions).toHaveLength(1)
    expect(slotsOf(profile2.actions![0]!)).toEqual(['UPARROW', 'w'])
    expect(profile2.actions![0]!.commands).toEqual([{ kind: 'raw', text: '+forward' }])
  })

  it('"Anchor-only entry with two anchors": two anchors, one entry, both slots and the alias name intact', async () => {
    const profile = findFixture('Anchor-only entry with two anchors')
    const original = profile.actions![0]!
    const { profile2, text1 } = await reimportProfile(profile)

    // No `bind` and no `alias` line for this entry anywhere: its two anchor lines and the layer
    // overrides they name are its entire presence in the file. `an=` is the only place its own alias
    // name can live, which is why the tag cut kept that key.
    expect(text1).toContain('// Next weapon [q2l an=weapnext key=MWHEELUP mod=ALT]')
    expect(text1).toContain('// Next weapon [q2l an=weapnext key=MWHEELDOWN mod=CTRL]')
    expect(text1).not.toMatch(/^alias weapnext/m)

    // One row, not two: the second anchor found the group the first one created (by prose, since
    // neither carries a `cid`) instead of splitting off.
    expect(profile2.actions).toHaveLength(1)
    const restored = profile2.actions![0]!
    expect(slotsOf(restored)).toEqual(slotsOf(original))
    expect(restored.aliasName).toBe('weapnext')
    expect(restored.name).toBe('Next weapon')
    expect(restored.commands).toEqual(original.commands)
  })

  it('"Marker-tag-only entry pair": a fieldless entry line carries the bare [q2l] and stays owned', async () => {
    const profile = findFixture('Marker-tag-only entry pair')
    const { profile2, text1 } = await reimportProfile(profile)

    // The marker is load-bearing: it is the only thing left that tells these lines from a raw bind a
    // user typed and commented themselves.
    expect(text1).toMatch(/^bind j\s+"pick_blaster"\s+\/\/ Pick blaster \[q2l\]$/m)
    expect(text1).toMatch(/^alias pick_blaster use blaster\s+\/\/ Pick blaster \[q2l\]$/m)

    // Two entries, one key each - and neither line ended up unowned in an "Other binds" section,
    // which is what the missing marker would have cost.
    expect(profile2.actions!.map((entry) => [entry.name, slotsOf(entry)])).toEqual([
      ['Pick blaster', ['j']],
      ['Pick shotgun', ['k']],
    ])
    expect(renderProfileFile(profile2)).not.toContain('Other binds')
  })
})
