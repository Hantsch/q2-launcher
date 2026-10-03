import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { ConfigProfile } from '@shared/modules/config'
import { renderProfileFile } from '@shared/config/render/render'
import { ROUND_TRIP_FIXTURES } from '@shared/config/fixtures/profiles'
import { adoptRendered, setLines, installRoundTripRoot } from './helpers'

installRoundTripRoot()

describe("adopting the launcher's own file back does not inflate profile.cvars", () => {
  for (const profile of ROUND_TRIP_FIXTURES) {
    it(`"${profile.name}": the adopted record re-renders the same file, with no cvar it did not store`, async () => {
      const { adopted, text1 } = await adoptRendered(profile)

      // The file really does state the catalogue explicitly - without this the rest of the case
      // would pass for the wrong reason (nothing to strip).
      expect(text1).toMatch(/^set sensitivity\s+"4"$/m)

      // Not one key appeared that the profile did not already store, and not one stored value
      // changed on the way back in. Every fixture carries `cvars: {}` today, so this currently says
      // "all ~30 catalogue lines were stripped again"; written as the general property so a fixture
      // that gains a cvar tomorrow is still held to it.
      for (const [name, value] of Object.entries(adopted.cvars)) {
        expect(profile.cvars[name]).toBe(value)
      }
      expect(Object.keys(adopted.cvars).length).toBeLessThanOrEqual(
        Object.keys(profile.cvars).length,
      )

      // ...and the cvar block the adopted record re-renders is byte-for-byte the one it was adopted
      // from: a stripped catalogue cvar renders from the same `def.default` the first render wrote.
      //
      // The *whole* file is compared by the fixed-point loop at the top of this file; it is not
      // repeated here because `adoptFromFile` commits through `ProfilesStore.commit`, whose
      // `adoptRawBinds` pass ("actions is the only authority for a catalogue bind"
      // invariant) can legitimately mint an entry for a raw bind the file carries - visible on the
      // "Hold layer" fixture, unrelated to cvars, and unchanged by this deliverable. The two
      // purpose-built cases below do assert the whole file, byte for byte.
      expect(setLines(renderProfileFile(adopted))).toEqual(setLines(text1))
    })
  }
})

describe('which cvars survive an adopt, by shape', () => {
  /** Every shape the strip has to tell apart, in one profile. No actions/binds - this case is about
   * the cvar block alone. */
  function cvarShapes(cvars: Record<string, string>): ConfigProfile {
    return {
      id: randomUUID(),
      name: 'Cvar shapes',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      cvars,
      binds: {},
      assignments: [],
    }
  }

  it('keeps genuine deviations (own casing included) and unknown cvars, drops restated defaults', async () => {
    const profile = cvarShapes({
      // A real deviation: `sensitivity`'s catalogue default is '4'.
      sensitivity: '3',
      // A deviation stored under the user's own casing - `crosshair`'s default is '1'. The writer
      // emits it under the stored spelling, so the strip must recognise it case-insensitively
      // (`findCvar`'s rule) and still hand the key back verbatim.
      Crosshair: '2',
      // Stored, but equal to the catalogue default ('0'): a file cannot express the difference
      // between "the user picked the default" and "the writer restated it", so this is the one
      // shape that legitimately does not survive.
      cl_gun: '0',
      // Stored empty = unset (the rule), rendered at the default, and not stored again.
      m_pitch: '',
      // Not in the catalogue at all: written to "Other", never a candidate for stripping.
      my_own_cvar: 'keep me',
    })

    const { adopted, text1 } = await adoptRendered(profile)

    expect(adopted.cvars).toEqual({ sensitivity: '3', Crosshair: '2', my_own_cvar: 'keep me' })
    // And the file the adopted record re-renders is byte-for-byte the one it was adopted from: the
    // three survivors are written from the stored values, the two dropped ones from the identical
    // catalogue defaults the first render already wrote.
    expect(renderProfileFile(adopted)).toBe(text1)
  })

  it('a value that is the default in a different spelling normalizes once and then holds still', async () => {
    // `sensitivity`'s default is '4'; '4.0' is the same number, so the numeric-aware rule (the
    // sprint's own decision: write value and strip comparison are numeric-/toggle-normalized) drops
    // it. The stored *spelling* is therefore lost - a one-off normalization to the canonical
    // default, not a growing file: the very next round is a true fixed point.
    const first = await adoptRendered(cvarShapes({ sensitivity: '4.0' }))
    expect(first.text1).toMatch(/^set sensitivity\s+"4\.0"$/m)
    expect(first.adopted.cvars).toEqual({})

    const text2 = renderProfileFile(first.adopted)
    expect(text2).not.toBe(first.text1)
    expect(text2).toMatch(/^set sensitivity\s+"4"$/m)

    const second = await adoptRendered(first.adopted)
    expect(second.adopted.cvars).toEqual({})
    expect(renderProfileFile(second.adopted)).toBe(text2)
  })
})
