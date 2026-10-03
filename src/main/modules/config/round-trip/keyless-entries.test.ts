import { describe, expect, it } from 'vitest'
import { actionKeySlots } from '@shared/config/catalog/action-slots'
import { renderProfileFile } from '@shared/config/render/render'
import { buildFixtureProfile } from '@shared/config/fixtures/profiles'
import { normalize, slotsOf, reimportProfile, findFixture, installRoundTripRoot } from './helpers'

installRoundTripRoot()

describe('a fully keyless catalogue entry rides on its unbound line', () => {
  it('"Keyless catalogue entry": the unbound line is written and read back with its command', async () => {
    const profile = findFixture('Keyless catalogue entry')
    const original = profile.actions![0]!
    const { profile2, text1 } = await reimportProfile(profile)

    // No alias line (a continuous catalogue row mirrors as its own bare command) and no bind line
    // (no key) - so the entry's one trace is the commented-out bind in its category's entry section,
    // command and all.
    expect(text1).toMatch(/^\/\/bind "\+moveleft"\s+\/\/ Strafe left \[q2l cid=moveleft\]$/m)

    // And it comes back whole: name, category, catalogue id and - the point of the whole shape -
    // the command the reverted anchor could not carry.
    expect(profile2.actions).toHaveLength(1)
    const restored = profile2.actions![0]!
    expect(restored.name).toBe(original.name)
    expect(restored.catalogId).toBe(original.catalogId)
    expect(restored.categoryId).toBe(original.categoryId)
    expect(restored.commands).toEqual(original.commands)
    expect(actionKeySlots(restored)).toEqual([])

    // ...and the file is a fixed point across that round trip, unbound line included.
    expect(normalize(renderProfileFile(profile2))).toBe(normalize(text1))
  })
})

describe('a keyless entry with a body keeps its empty bind slot', () => {
  /** One keyless bodied Weapons row, plus a keyed sibling and a genuine `kind: 'alias'` entry in
   * the same category - the two neighbours a wrong merge or a wrong split would disturb first. */
  const grenadeRowProfile = buildFixtureProfile({
    name: 'Story 063: keyless grenade row',
    categories: [{ id: 'weapons', name: 'Weapons' }],
    actions: [
      {
        id: 'grenades',
        categoryId: 'weapons',
        name: 'Hand grenades',
        kind: 'bind',
        catalogId: 'weapon:grenades',
        aliasName: 'hand_grenades',
        commands: [{ kind: 'raw', text: 'use grenades' }],
      },
      {
        id: 'rl',
        categoryId: 'weapons',
        name: 'Rocket launcher',
        kind: 'bind',
        aliasName: 'rocket_launcher',
        commands: [{ kind: 'raw', text: 'use rocket launcher' }],
        keys: [{ key: 'r' }],
      },
      {
        id: 'macro',
        categoryId: 'weapons',
        name: 'My macro',
        kind: 'alias',
        aliasName: 'my_macro',
        commands: [{ kind: 'raw', text: 'use blaster' }],
      },
    ],
  })

  it('a keyless bind entry does not turn into an alias entry (story 063 regression)', async () => {
    const { profile2, text1 } = await reimportProfile(grenadeRowProfile)

    // The premise: the file states both halves of the fact - the alias line for the body, the
    // commented-out bind for the empty key slot.
    expect(text1).toMatch(/^alias hand_grenades\s+use grenades\s/m)
    expect(text1).toMatch(/^\/\/bind "hand_grenades"/m)

    // The regression itself, asserted before anything else so a failure names the actual cause:
    // on the un-fixed reader this row came back as `kind: 'alias'` - permanently unbindable.
    const restored = profile2.actions!.find((action) => action.name === 'Hand grenades')!
    expect(restored.kind).toBe('bind')

    // And it is ONE row, not the alias line and the unbound line read as two.
    expect(profile2.actions).toHaveLength(3)
    expect(profile2.actions!.filter((action) => action.name === 'Hand grenades')).toHaveLength(1)
  })

  it('a keyless entry with a body comes back as a bind entry, body intact', async () => {
    const { profile2 } = await reimportProfile(grenadeRowProfile)
    const restored = profile2.actions!.find((action) => action.name === 'Hand grenades')!

    expect(restored.kind).toBe('bind')
    expect(restored.commands).toEqual([{ kind: 'raw', text: 'use grenades' }])
    expect(restored.aliasName).toBe('hand_grenades')
    expect(restored.catalogId).toBe('weapon:grenades')
    // Keyless, and with no key invented for it either - an empty slot is the whole point.
    expect(slotsOf(restored)).toEqual([])
    // Neither neighbour is disturbed: the keyed row keeps its key, and the deliberate alias entry
    // (no unbound line beside it, so no key slot claimed for it) stays an alias entry.
    const keyed = profile2.actions!.find((action) => action.name === 'Rocket launcher')!
    expect(keyed.kind).toBe('bind')
    expect(slotsOf(keyed)).toEqual(['r'])
    const macro = profile2.actions!.find((action) => action.name === 'My macro')!
    expect(macro.kind).toBe('alias')
    expect(macro.commands).toEqual([{ kind: 'raw', text: 'use blaster' }])
    expect(slotsOf(macro)).toEqual([])
  })

  it('the file stays a fixed point across that round trip', async () => {
    const { profile2, text1 } = await reimportProfile(grenadeRowProfile)
    expect(normalize(renderProfileFile(profile2))).toBe(normalize(text1))
  })
})

describe('the writer/reader pair over adversarial keyless shapes', () => {
  it('"Keyless bodied entries (story 063 D3)": all eight entries survive, none merged or split', async () => {
    const { profile2 } = await reimportProfile(findFixture('Keyless bodied entries (story 063 D3)'))
    expect(profile2.actions).toHaveLength(8)
  })

  it("a keyless multi-command entry survives as one `kind: 'bind'` entry, commands intact", async () => {
    const profile = findFixture('Keyless bodied entries (story 063 D3)')
    const original = profile.actions!.find((action) => action.name === 'Grenade multi-throw')!
    const { profile2 } = await reimportProfile(profile)

    const restored = profile2.actions!.find((action) => action.name === 'Grenade multi-throw')!
    expect(restored.kind).toBe('bind')
    expect(restored.commands).toEqual(original.commands)
    expect(slotsOf(restored)).toEqual([])
  })

  it('a keyless entry with an explicit aliasName keeps that exact name, no drift on the second render', async () => {
    const profile = findFixture('Keyless bodied entries (story 063 D3)')
    const original = profile.actions!.find((action) => action.name === 'Explicit alias pin')!
    const { profile2, text1 } = await reimportProfile(profile)

    const restored = profile2.actions!.find((action) => action.name === 'Explicit alias pin')!
    expect(restored.kind).toBe('bind')
    expect(restored.aliasName).toBe('pinned_alias_063')
    expect(restored.commands).toEqual(original.commands)

    // gap B: the alias line already spells this entry's name as code, so its unbound
    // line must not carry a redundant `an=pinned_alias_063` - and since nothing shifted between the
    // two renders, `render(parse(render(p))) === render(p)` holds on the *first* render already, not
    // only from the second one onward.
    expect(text1).toContain('alias pinned_alias_063')
    expect(text1).not.toContain('an=pinned_alias_063')
    expect(normalize(renderProfileFile(profile2))).toBe(normalize(text1))
  })

  it("an entry referenced only by another entry's body keeps its alias line, and both survive", async () => {
    const profile = findFixture('Keyless bodied entries (story 063 D3)')
    const original = profile.actions!.find((action) => action.name === 'Relay macro')!
    const { profile2, text1 } = await reimportProfile(profile)

    // The reference itself: `Relay caller`'s own body is exactly the text that names it.
    expect(text1).toContain('alias relay_macro')
    expect(text1).toContain('relay_macro')

    const relay = profile2.actions!.find((action) => action.name === 'Relay macro')!
    expect(relay.kind).toBe('bind')
    expect(relay.catalogId).toBe(original.catalogId)
    expect(relay.aliasName).toBe('relay_macro')
    expect(relay.commands).toEqual(original.commands)
    expect(slotsOf(relay)).toEqual([])

    const caller = profile2.actions!.find((action) => action.name === 'Relay caller')!
    expect(caller.kind).toBe('bind')
    expect(caller.commands).toEqual([
      { kind: 'raw', text: 'relay_macro' },
      // A `say `-prefixed segment reads back as a `message` command, not a raw one
      // - the object comparison has to expect that shape
      // rather than the raw spelling this fixture was typed with.
      { kind: 'message', channel: 'say', text: 'relaying' },
    ])
    expect(slotsOf(caller)).toEqual(['c'])
  })

  it('an unreferenced continuous entry with no alias line still carries its explicit aliasName as `an`', async () => {
    // The regression gap B's fix must not reopen: with no alias line at all to spell the name as
    // code, the unbound line's `an` field is the only place it survives.
    const profile = findFixture('Keyless bodied entries (story 063 D3)')
    const original = profile.actions!.find((action) => action.name === 'Lone continuous relay')!
    const { profile2, text1 } = await reimportProfile(profile)

    expect(text1).not.toContain('alias lone_relay')
    expect(text1).toContain('an=lone_relay')

    const restored = profile2.actions!.find((action) => action.name === 'Lone continuous relay')!
    expect(restored.kind).toBe('bind')
    expect(restored.aliasName).toBe('lone_relay')
    expect(restored.commands).toEqual(original.commands)
    expect(normalize(renderProfileFile(profile2))).toBe(normalize(text1))
  })

  it('a referenced-only continuous entry stays ONE entry, `//bind` value and alias name differing', async () => {
    // the shape the Plan item 3 asks for, and the one this pass originally
    // dodged by making `Relay macro` multi-command: keyless, catalogue-backed, a single continuous
    // command *and* referenced by another body. `bindValueFor`'s fast path mirrors it onto its own
    // command text, so the file states the join as two different strings and the reader had no name
    // to match on at all - the pair came back as two entries sharing one `catalogId`, an inert
    // `kind: 'alias'` row plus a keyless `kind: 'bind'` one, with the byte fixed point still holding.
    const profile = findFixture('Keyless bodied entries (story 063 D3)')
    const original = profile.actions!.find((action) => action.name === 'Continuous relay')!
    const { profile2, text1 } = await reimportProfile(profile)

    // The premise, both halves of it: the alias line is defined under `cont_relay` (it exists only
    // because the caller's body names it), while the unbound line's own value is `+contrelay` - and
    // it carries no `an`, since the alias line already spells the name as code.
    expect(text1).toMatch(/^alias cont_relay\s+\+contrelay\s/m)
    expect(text1).toMatch(/^\/\/bind "\+contrelay"/m)
    expect(text1).not.toContain('an=cont_relay')

    // ONE entry, not two - asserted by `catalogId`, which is what the split duplicated.
    const carrying = profile2.actions!.filter((action) => action.catalogId === 'weapons:cont-relay')
    expect(carrying).toHaveLength(1)

    const restored = carrying[0]!
    expect(restored.name).toBe(original.name)
    expect(restored.kind).toBe('bind')
    expect(restored.commands).toEqual(original.commands)
    expect(restored.aliasName).toBe('cont_relay')
    expect(restored.categoryId).toBe(original.categoryId)
    expect(slotsOf(restored)).toEqual([])
    // No `kind: 'alias'` twin left over anywhere either.
    expect(profile2.actions!.filter((action) => action.name === 'Continuous relay')).toHaveLength(1)

    // The caller still calls it by the exact name it is defined under, and keeps its own key.
    const caller = profile2.actions!.find((action) => action.name === 'Continuous relay caller')!
    expect(caller.kind).toBe('bind')
    expect(caller.commands).toEqual([{ kind: 'raw', text: 'cont_relay' }])
    expect(slotsOf(caller)).toEqual(['v'])

    // And the fixed point still holds - it did before the fix too (both spellings re-render the same
    // two lines), which is exactly why the object-level assertions above are the ones that carry it.
    expect(normalize(renderProfileFile(profile2))).toBe(normalize(text1))
  })

  it("a genuine `kind: 'alias'` entry beside them stays an alias entry, never gets a key slot", async () => {
    const { profile2, text1 } = await reimportProfile(
      findFixture('Keyless bodied entries (story 063 D3)'),
    )

    // No unbound line for it at all - `isUnboundEntry`'s kind guard, .
    const macroLines = text1.split('\n').filter((line) => line.includes('Deliberate macro'))
    expect(macroLines.every((line) => !line.startsWith('//bind'))).toBe(true)

    const restored = profile2.actions!.find((action) => action.name === 'Deliberate macro')!
    expect(restored.kind).toBe('alias')
    expect(restored.commands).toEqual([
      { kind: 'raw', text: 'use blaster' },
      { kind: 'message', channel: 'say', text: 'switching' },
    ])
    expect(slotsOf(restored)).toEqual([])
  })
})

describe('grenade use rows and drop grenades rows stay four distinct entries', () => {
  it('"Grenade use rows and drop grenades rows (story 063 AC4)": four entries, four distinct catalogIds', async () => {
    const profile = findFixture('Grenade use rows and drop grenades rows (story 063 AC4)')
    const { profile2, text1 } = await reimportProfile(profile)

    expect(profile2.actions).toHaveLength(4)
    const byCatalogId = new Map(profile2.actions!.map((action) => [action.catalogId, action]))
    // Four distinct catalogIds - the writer property itself: a silent collapse to fewer than four (two
    // rows folded into one) fails here even if `toHaveLength(4)` above somehow did not.
    expect(byCatalogId.size).toBe(4)

    const useGrenades = byCatalogId.get('weaponUse:use_grenades')!
    const useGlauncher = byCatalogId.get('weaponUse:use_glauncher')!
    const dropWeapon = byCatalogId.get('dropWeapon:grenades')!
    const dropAmmo = byCatalogId.get('dropAmmo:hgrenades')!
    expect([useGrenades, useGlauncher, dropWeapon, dropAmmo].every(Boolean)).toBe(true)

    for (const action of [useGrenades, useGlauncher, dropWeapon, dropAmmo]) {
      expect(action.kind).toBe('bind')
      // None of the four picked up a key nobody assigned - all four started, and stay, keyless.
      expect(slotsOf(action)).toEqual([])
    }

    expect(useGrenades.commands).toEqual([{ kind: 'raw', text: 'use grenades' }])
    expect(useGlauncher.commands).toEqual([{ kind: 'raw', text: 'use grenade launcher' }])
    expect(dropWeapon.commands).toEqual([{ kind: 'raw', text: 'drop grenades' }])
    expect(dropAmmo.commands).toEqual([{ kind: 'raw', text: 'drop grenades' }])

    expect(normalize(renderProfileFile(profile2))).toBe(normalize(text1))
  })
})
