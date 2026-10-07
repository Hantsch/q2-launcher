import { describe, expect, it } from 'vitest'
import { ALL_CVARS } from '@shared/config/catalog/cvar-catalog'
import { STRICTEST_LINE_BUDGET, renderProfileFile } from './render'
import {
  profile,
  action,
  testProfileHeader,
  keySlots,
  setLines,
  setName,
} from './render.test-helpers'

/**
 * Story 048 D2 - the rendered file carries a `set` line for *every* cvar in `ALL_CVARS`, so it
 * states the complete intended configuration and `exec`ing it is idempotent no matter what ran
 * before (`config.cfg`, an `autoexec.cfg`, another profile, a mod).
 *
 * The failure mode this block exists for is a silent clobber: two `set` lines for one cvar, the
 * catalogue default rendering *after* the user's real value. The engine executes the file top to
 * bottom and the last `set` on a cvar wins, so such a pair does not look broken in the file and
 * does not fail a layout assertion - it just quietly throws the user's setting away in-game. The
 * differently-cased-stored-key case below is exactly that trap, since `findCvar` matches
 * case-insensitively while a plain `Object.keys` walk does not.
 */
describe('every catalogue cvar is written', () => {
  /** The cvar name of every `set` line, lowercased - the granularity a duplicate has to be checked
   * at, since `sensitivity` and `Sensitivity` are one cvar to `findCvar` and to the catalogue. */
  function setNamesLower(rendered: string): string[] {
    return setLines(rendered).map((line) => setName(line).toLowerCase())
  }

  it('writes one line for every catalogue cvar, and no cvar twice', () => {
    const names = setNamesLower(renderProfileFile(profile({ cvars: {} })))

    // Counted against the real array, not against a number in this file: a cvar added to the
    // catalogue has to fail here even though `TEST_PROFILE_CVAR_DEFAULTS`' literal knows nothing
    // about it.
    expect(names).toHaveLength(ALL_CVARS.length)
    expect([...names].sort()).toEqual(ALL_CVARS.map((def) => def.name.toLowerCase()).sort())
  })

  it('writes each catalogue cvar at its own default when the profile stored nothing for it', () => {
    const rendered = renderProfileFile(profile({ cvars: {} }))
    const written = new Map(
      setLines(rendered).map((line) => [setName(line), /"([^"]*)"$/.exec(line)![1]!]),
    )

    for (const def of ALL_CVARS) expect(written.get(def.name)).toBe(def.default)
  })

  /**
   * The named risk of this deliverable, asserted head-on. A profile that stored `Sensitivity`
   * (reachable through an import that keeps a file's own casing) must produce *one* line, carrying
   * the stored value - not a second one at the catalogue default that would win at exec time.
   */
  it('writes a differently-cased stored cvar exactly once, with the stored value and no default line', () => {
    const rendered = renderProfileFile(profile({ id: 'cased', cvars: { Sensitivity: '9' } }))

    expect(setLines(rendered).filter((line) => /^set sensitivity\b/i.test(line))).toEqual([
      'set Sensitivity "9"',
    ])
    // `sensitivity`'s catalogue default is 4; it must appear nowhere in the file, in any casing.
    expect(rendered).not.toMatch(/^set sensitivity +"4"$/im)
    // And the file still carries every catalogue cvar exactly once overall.
    expect(setNamesLower(rendered)).toHaveLength(ALL_CVARS.length)
    expect(new Set(setNamesLower(rendered)).size).toBe(ALL_CVARS.length)
  })

  it('keeps exactly one line per cvar when the profile stores several spellings of several cvars', () => {
    const rendered = renderProfileFile(
      profile({
        id: 'many-spellings',
        cvars: { Sensitivity: '9', sensitivity: '3', FOV: '110', fov: '95', CL_RUN: '0' },
      }),
    )

    expect(new Set(setNamesLower(rendered)).size).toBe(setNamesLower(rendered).length)
    // Largest stored spelling wins - the one that already rendered last, and so already won at
    // exec time, before this deliverable collapsed the pair.
    expect(setLines(rendered)).toContain('set sensitivity "3"')
    expect(setLines(rendered)).toContain('set fov         "95"')
    // A single stored spelling wins whatever its casing, and keeps that casing.
    expect(setLines(rendered)).toContain('set CL_RUN      "0"')
  })

  it('falls back to the catalogue default for a stored value that is empty or whitespace only', () => {
    const blank = renderProfileFile(
      profile({ id: 'blank', cvars: { fov: '', sensitivity: '   ', crosshair: '0' } }),
    )

    // Byte-identical to a profile that never stored the two blank keys at all: `writeValueFor`
    // treats "nothing there" and "not stored" as the same thing, and the stored spelling of both
    // happens to be the catalogue's own.
    expect(blank).toBe(renderProfileFile(profile({ id: 'blank', cvars: { crosshair: '0' } })))
    expect(setLines(blank)).toContain('set fov         "100"')
    expect(setLines(blank)).toContain('set sensitivity "4"')
    expect(setLines(blank)).toContain('set crosshair   "0"')
  })

  it('leaves an unrecognized stored cvar in the Other section, verbatim and never defaulted', () => {
    const lines = renderProfileFile(
      profile({
        id: 'unknown-cvars',
        cvars: { zz_unknown: 'kept', gl_frobnicate: '7', q_empty: '' },
      }),
    ).split('\n')
    const start = lines.findIndex((line) => line.startsWith('// --- Other '))

    expect(start).toBeGreaterThan(-1)
    // Alphabetical inside "Other" (never `Object.keys` insertion order), aligned among themselves
    // only, and `q_empty` keeps its empty value - the default substitution is for catalogue cvars,
    // and an unrecognized name has no default to substitute.
    expect(lines.slice(start + 1, start + 4)).toEqual([
      'set gl_frobnicate "7"',
      'set q_empty       ""',
      'set zz_unknown    "kept"',
    ])
    expect(lines[start + 4]).toBe('')
  })

  it('renders byte-identically on a second render, with every cvar now emitted', () => {
    const p = profile({
      id: 'stable',
      cvars: { Sensitivity: '9', sensitivity: '3', zz_unknown: 'kept', vid_gamma: '1.0' },
      actions: [
        action({ id: 'st-1', name: 'One', keys: keySlots({ key: 'q' }), aliasName: 'one_e' }),
      ],
      binds: { q: 'one_e' },
    })

    expect(renderProfileFile(p)).toBe(renderProfileFile(p))
  })

  it('keeps every cvar line inside the engine line budget with the whole catalogue written', () => {
    for (const line of renderProfileFile(profile({ cvars: {} })).split('\n')) {
      expect(line.length).toBeLessThan(STRICTEST_LINE_BUDGET)
    }
  })
})

/**
 * Story 051 D2 - the writer emits the header as a small four-line banner (rule / name / rule /
 * right-aligned tag) instead of a `sentinelLine()` prefix plus a five-line block carrying the old
 * hand-edit sentence. Each case here pins one bullet of the deliverable's own "Accepted when" list.
 */
describe('the header block is a small banner', () => {
  it('starts the file with exactly the four header lines, and nothing before them', () => {
    const p = profile({ id: 'header-shape', cvars: {}, binds: {} })
    const lines = renderProfileFile(p).split('\n')

    expect(lines.slice(0, 4)).toEqual(testProfileHeader('header-shape'))
  })

  it('contains the profile id exactly once, only inside the header tag', () => {
    const p = profile({
      id: 'only-in-tag',
      actions: [
        action({ id: 'a-1', name: 'One', keys: keySlots({ key: 'q' }), aliasName: 'one_e' }),
      ],
      binds: { q: 'one_e' },
    })
    const rendered = renderProfileFile(p)
    const lines = rendered.split('\n')

    expect(lines[3]).toBe(testProfileHeader('only-in-tag')[3])
    expect(rendered.split('only-in-tag').length - 1).toBe(1)
  })

  it('never writes "hand-edited", "metadata", "version" or "generated", case-insensitively', () => {
    const p = profile({
      id: 'no-banned-words',
      cvars: { sensitivity: '3' },
      binds: { q: '+forward' },
      layers: [
        { id: 'l1', name: 'Drops', mode: 'hold', triggerKey: 'ALT', overrides: { '1': 'drop rl' } },
      ],
    })
    const rendered = renderProfileFile(p).toLowerCase()

    for (const word of ['hand-edited', 'metadata', 'version', 'generated']) {
      expect(rendered).not.toContain(word)
    }
  })

  it('renders the header frame as pure ASCII, even with a non-ASCII (latin1) profile name', () => {
    // The name line carries the user's own prose (latin1-safe, not ASCII-only - see the round-trip
    // tests) and is deliberately excluded here; the *frame* - both rules and the tag line - is what
    // this AC pins as ASCII-only, same as every other decoration this writer emits.
    const p = profile({ id: 'ascii-frame', name: 'Bjørn', cvars: {}, binds: {} })
    const [topRule, , bottomRule, tagLine] = renderProfileFile(p).split('\n')

    for (const line of [topRule!, bottomRule!, tagLine!]) {
      for (const ch of line) expect(ch.charCodeAt(0)).toBeLessThanOrEqual(0x7f)
    }
  })

  it('renders byte-identically twice in a row', () => {
    const p = profile({
      id: 'idempotent-header',
      cvars: { sensitivity: '3' },
      binds: { q: '+forward' },
    })

    expect(renderProfileFile(p)).toBe(renderProfileFile(p))
  })

  it('neutralises a profile named literally "[q2l id=x]" on the name line', () => {
    const p = profile({ id: 'neutral-name', name: '[q2l id=x]', cvars: {}, binds: {} })
    const lines = renderProfileFile(p).split('\n')

    expect(lines[1]).toBe('//  (q2l id=x]')
  })

  it('falls back to a left-aligned tag line when the tag alone exceeds BANNER_WIDTH - 3', () => {
    const id = 'x'.repeat(200)
    const p = profile({ id, cvars: {}, binds: {} })
    const lines = renderProfileFile(p).split('\n')

    expect(lines[3]).toBe(`//  [q2l v=1 id=${id}]`)
  })
})
