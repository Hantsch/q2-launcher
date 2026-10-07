import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  COMMENT_LINE_BUDGET,
  COMMENT_PREFIX,
  renderProfileFile,
} from '@shared/config/render/render'
import { restoreProfileParts } from '@shared/config/profile/profile-restore'
import { validateActions } from '@shared/config/validation/validate-actions'
import { ROUND_TRIP_FIXTURES } from '@shared/config/fixtures/profiles'
import { toRestoreInput } from '../import'
import {
  reimport,
  normalize,
  slotsOf,
  reimportProfile,
  findFixture,
  installRoundTripRoot,
} from './helpers.test-helpers'

installRoundTripRoot()

describe('render(parse(render(p))) is a fixed point over the fixture corpus', () => {
  for (const profile of ROUND_TRIP_FIXTURES) {
    it(`is a fixed point for "${profile.name}"`, async () => {
      const { profile2, text1 } = await reimportProfile(profile)
      const text2 = renderProfileFile(profile2)
      expect(normalize(text2)).toBe(normalize(text1))
    })
  }
})

describe('the two-part kinds and the wait command survive as objects', () => {
  it('"Toggle entry with two labelled states": one toggle entry, both parts, both labels, its key', async () => {
    const { profile2 } = await reimportProfile(findFixture('Toggle entry with two labelled states'))

    expect(profile2.actions).toHaveLength(1)
    const entry = profile2.actions![0]!
    expect(entry.kind).toBe('toggle')
    expect(entry.name).toBe('Zoom')
    expect(entry.aliasName).toBe('zoom')
    expect(entry.commands).toEqual([])
    expect(entry.parts).toEqual([
      {
        commands: [
          { kind: 'raw', text: 'fov 30' },
          { kind: 'raw', text: 'sensitivity 1.5' },
        ],
        label: 'In',
        // The state's own rendered name, kept verbatim so a re-render reproduces it rather than
        // deriving a fresh `_s<n>` pair.
        aliasName: 'zoom_s1',
      },
      {
        commands: [{ kind: 'raw', text: 'fov 90' }],
        label: 'Out',
        aliasName: 'zoom_s2',
      },
    ])
    expect(slotsOf(entry)).toEqual(['v'])
  })

  it('"Toggle whose first state is chunk-split": the chunk family folds back into one state body', async () => {
    const profile = findFixture('Toggle whose first state is chunk-split')
    const original = profile.actions![0]!
    const { profile2 } = await reimportProfile(profile)

    expect(profile2.actions).toHaveLength(1)
    const entry = profile2.actions![0]!
    expect(entry.kind).toBe('toggle')
    // Every command of the long state, in order, wait command included - the `_p<n>` split is undone
    // and the `alias long_zoom long_zoom_s2` rewrite that hid in the last chunk is not a command.
    expect(entry.parts![0]!.commands).toEqual(original.parts![0]!.commands)
    expect(entry.parts![0]!.label).toBe('On')
    expect(entry.parts![1]!.label).toBe('Off')
    expect(slotsOf(entry)).toEqual(['b'])
  })

  it('"Press/release entry next to a lone + half": the pair merges, the lone `+zoom` does not', async () => {
    const { profile2 } = await reimportProfile(
      findFixture('Press/release entry next to a lone + half'),
    )

    const pair = profile2.actions!.find((action) => action.kind === 'press-release')
    expect(pair).toBeDefined()
    // The sign-free base name - `+`/`-` are appended at render time, so the halves cannot drift.
    expect(pair!.aliasName).toBe('slow')
    expect(pair!.commands).toEqual([])
    expect(pair!.parts?.map((part) => part.commands)).toEqual([
      [
        { kind: 'raw', text: 'cl_forwardspeed 110' },
        { kind: 'raw', text: 'cl_sidespeed 110' },
      ],
      [
        { kind: 'raw', text: 'cl_forwardspeed 200' },
        { kind: 'raw', text: 'cl_sidespeed 200' },
      ],
    ])
    expect(slotsOf(pair!)).toEqual(['SHIFT'])

    // A `+` half with no `-` half is not a pair (the all-or-nothing rule) and stays a plain entry.
    const lone = profile2.actions!.find((action) => action.aliasName === '+zoom')
    expect(lone?.kind).toBe('alias')
    expect(lone?.parts).toBeUndefined()
  })

  it('"Toggle whose only slot carries a modifier": the anchor line lands on the dispatch, not beside it', async () => {
    // The defect this pins: all three of a toggle's alias lines carry the entry's one display prose,
    // so `matchAnchor`'s "exactly one candidate" rule found three and paired with none - the modified
    // key came back as a second, commandless entry next to the toggle. One entry, one slot, or the
    // recogniser is running too late.
    const { profile2 } = await reimportProfile(
      findFixture('Toggle whose only slot carries a modifier'),
    )

    expect(profile2.actions).toHaveLength(1)
    const entry = profile2.actions![0]!
    expect(entry.kind).toBe('toggle')
    expect(entry.parts?.map((part) => part.label)).toEqual(['In', 'Out'])
    expect(slotsOf(entry)).toEqual(['ALT+v'])
  })

  /**
   * . The fixed-point loop above already covers these two fixtures as
   * *text*; what it cannot say is whether the file still describes one entry. Both assertions below
   * are needed: without the first the fixture could quietly stop truncating anything (a change to a
   * budget, a command width, the chunk threshold) and go on passing while proving nothing.
   */
  for (const [fixture, kind, halves] of [
    ['Press/release entry whose press half outgrows its own display name', 'press-release', 2],
    ['Toggle whose first state outgrows its own display name', 'toggle', 2],
  ] as const) {
    it(`"${fixture}": a prose the line budget cut on one half still merges with the whole one`, async () => {
      const profile = findFixture(fixture)
      const displayName = profile.actions![0]!.name
      const { profile2, text1 } = await reimportProfile(profile)

      // The fixture really does what it says: one line carries the whole display name, and at least
      // one other carries a strictly shorter prefix of it - the cut `fitProseAndTag` made to keep
      // that line's `[q2l]` tag intact.
      const proses = [...text1.matchAll(/^.*?\/\/ (.*?) \[q2l/gm)].map((match) => match[1]!)
      expect(proses).toContain(displayName)
      expect(
        proses.some((prose) => prose.length < displayName.length && displayName.startsWith(prose)),
      ).toBe(true)

      // ... and the entry survives it whole, rather than splitting into two or three plain aliases.
      expect(profile2.actions).toHaveLength(1)
      const entry = profile2.actions![0]!
      expect(entry.kind).toBe(kind)
      // The *whole* name, not the cut one: restoring the truncated spelling would write it onto the
      // short lines too, and the render after that would differ from this one.
      expect(entry.name).toBe(displayName)
      expect(entry.parts).toHaveLength(halves)
      expect(entry.parts![0]!.commands).toEqual(profile.actions![0]!.parts![0]!.commands)
      expect(entry.commands).toEqual([])
    })
  }

  /**
   * the same budget cut on the shape that has nothing to do
   * with the two new kinds: one ordinary bound entry whose alias line lost the tail of its display
   * name while its bind line kept the whole thing.
   */
  it('"Entry whose alias line outgrows its own display name": the whole name comes back, not the cut one', async () => {
    const profile = findFixture('Entry whose alias line outgrows its own display name')
    const displayName = profile.actions![0]!.name
    const { profile2, text1 } = await reimportProfile(profile)

    // The premise: the alias line really is cut and the bind line really is not.
    const aliasProse = /^alias padwalk .*?\/\/ (.*) \[q2l/m.exec(text1)?.[1]
    const bindProse = /^bind n .*?\/\/ (.*) \[q2l/m.exec(text1)?.[1]
    expect(bindProse).toBe(displayName)
    expect(aliasProse!.length).toBeLessThan(displayName.length)
    expect(displayName.startsWith(aliasProse!)).toBe(true)

    expect(profile2.actions).toHaveLength(1)
    expect(profile2.actions![0]!.name).toBe(displayName)
    // And therefore the next render is the same file - restoring the cut spelling would have written
    // it onto the bind line as well.
    expect(renderProfileFile(profile2)).toBe(text1)
  })

  /**
   * the counter-scenario the review names: three real,
   * distinct, never-cut entries called `Slow`, `Slow mo` and `Slow motion walk`, wired like a toggle
   * trio, none of which may merge with any other.
   */
  it('"Three prefix-named entries wired like a toggle": three entries, three names, no toggle', async () => {
    const profile = findFixture('Three prefix-named entries wired like a toggle')
    const { profile2, text1 } = await reimportProfile(profile)

    // The premise, part one: every one of the three lines carries its own whole name, uncut.
    const proses = [...text1.matchAll(/^alias (\S+).*?\/\/ (.*) \[q2l/gm)].map((match) => [
      match[1]!,
      match[2]!,
    ])
    expect(proses).toEqual([
      ['slow', 'Slow motion walk'],
      ['slow_a', 'Slow'],
      ['slow_b', 'Slow mo'],
    ])

    // The premise, part two: the two state lines are cramped enough that the longest of the three
    // names would *not* have fitted on them - which is exactly what the round-1 rule took as
    // licence to merge. Measured the way the writer measures: the line's own `//` offset plus the
    // whole name plus the space and the bare tag it must keep.
    for (const name of ['slow_a', 'slow_b']) {
      const line = text1.split('\n').find((candidate) => candidate.startsWith(`alias ${name} `))!
      expect(
        line.indexOf(COMMENT_PREFIX) + COMMENT_PREFIX.length + 'Slow motion walk [q2l]'.length,
      ).toBeGreaterThan(COMMENT_LINE_BUDGET)
    }

    // And still three plain entries with their three names, no `parts` anywhere, no warning-free
    // silent loss of two of them.
    expect(profile2.actions?.map((entry) => entry.name)).toEqual([
      'Slow motion walk',
      'Slow',
      'Slow mo',
    ])
    expect(profile2.actions?.every((entry) => entry.kind === 'alias')).toBe(true)
    expect(profile2.actions?.some((entry) => entry.parts !== undefined)).toBe(false)
    expect(renderProfileFile(profile2)).toBe(text1)
  })

  /**
   * `restoreModifierSlots`' first pass looks for an entry that has a
   * modified slot and "no command yet", and used to write the layer override's command straight into
   * its `commands`. A two-part entry has `commands: []` **by contract** (its bodies live in `parts`),
   * so it matched that predicate every time - and came back holding both a `parts` body and a stray
   * raw `zoom` command, the half-an-entry shape the model is supposed to make impossible.
   *
   * Invisible to the fixed-point loop, because `renderTwoPartAliases` renders from `parts` and never
   * looks at `commands` - the file round-tripped perfectly while the model behind it did not.
   */
  it('"Toggle whose only slot carries a modifier": the ALT override does not leak into `commands`', async () => {
    const { profile2 } = await reimportProfile(
      findFixture('Toggle whose only slot carries a modifier'),
    )

    expect(profile2.actions).toHaveLength(1)
    const entry = profile2.actions![0]!
    expect(entry.kind).toBe('toggle')
    expect(entry.commands).toEqual([])
    // The content is all in `parts`, where a two-part entry's content belongs.
    expect(entry.parts?.map((part) => part.commands)).toEqual([
      [{ kind: 'raw', text: 'fov 30' }],
      [{ kind: 'raw', text: 'fov 90' }],
    ])
    expect(slotsOf(entry)).toEqual(['ALT+v'])
  })

  it('"Wait chain inside an entry body": both wait commands come back with their frame counts', async () => {
    const profile = findFixture('Wait chain inside an entry body')
    const { profile2 } = await reimportProfile(profile)

    expect(profile2.actions).toHaveLength(1)
    expect(profile2.actions![0]!.commands).toEqual(profile.actions![0]!.commands)
    // Stated outright rather than left to the deep-equal above: three-then-one, not one wait(4) and
    // not four raw commands.
    expect(profile2.actions![0]!.commands.filter((command) => command.kind === 'wait')).toEqual([
      { kind: 'wait', frames: 3 },
      { kind: 'wait', frames: 1 },
    ])
  })

  /**
   * Plan step 5 case "a `wait` at the chunk
   * boundary", driven through the real render -> parse -> restore -> render pipeline.
   *
   * The fixture splits `wait(3)`/`wait(2)` across a `_p<n>` chunk boundary (see its own doc
   * comment). The frame counts are asserted here because the text cannot show them, and the
   * fixed-point assertion is in the loop above - both are needed: collapsing the fold's five
   * literal `wait` segments into one `wait(5)` keeps the *commands* legal while moving the chunk
   * boundary on the next render, so only the two assertions together pin the defect.
   */
  it('"Wait run straddling a chunk boundary": both wait commands keep their own frame count', async () => {
    const profile = findFixture('Wait run straddling a chunk boundary')
    const { profile2, text1 } = await reimportProfile(profile)

    // The fixture really does straddle: the first chunk ends in a `wait`, the second opens with one.
    const chunks = [...text1.matchAll(/^alias (boundary_p\d+) "(.*)"/gm)].map((match) => ({
      name: match[1]!,
      body: match[2]!,
    }))
    expect(chunks.map((chunk) => chunk.name)).toEqual(['boundary_p1', 'boundary_p2'])
    expect(chunks[0]!.body.endsWith('wait')).toBe(true)
    expect(chunks[1]!.body.startsWith('wait')).toBe(true)

    expect(profile2.actions).toHaveLength(1)
    // Three-then-two, not one `wait(5)`: the chunk boundary is where the writer put the command
    // boundary, so the reader has to keep it.
    expect(profile2.actions![0]!.commands.filter((command) => command.kind === 'wait')).toEqual([
      { kind: 'wait', frames: 3 },
      { kind: 'wait', frames: 2 },
    ])
    expect(profile2.actions![0]!.commands).toEqual(profile.actions![0]!.commands)
    // The whole point of keeping them apart: the next render is the same file, byte for byte.
    expect(renderProfileFile(profile2)).toBe(text1)
  })
})

describe('Care sees a broken toggle/pair that is bound to a key', () => {
  /** The rendered fixture, hand-edited by `mangle`, put back through parser + restore + Care. */
  const careFor = async (fixture: string, mangle: (text: string) => string) => {
    const text = mangle(renderProfileFile(findFixture(fixture)))
    const result = await reimport(text)
    const restored = restoreProfileParts(toRestoreInput(result, [], randomUUID))
    return {
      restored,
      findings: validateActions(restored.actions, 'r1q2', {
        binds: result.binds,
        layers: restored.layers,
      }),
    }
  }

  it('a cross-wired toggle whose dispatch is bound reports toggleCrossWired', async () => {
    // Test Plan step 6: "hand-edit so both toggle states reassign to `zoom_s1`" - here state 2
    // reassigns to itself, which is the same defect from the dispatch's point of view: the loop no
    // longer closes back onto state 1.
    const { restored, findings } = await careFor('Toggle entry with two labelled states', (text) =>
      text.replace('"fov 90; alias zoom zoom_s1"', '"fov 90; alias zoom zoom_s2"'),
    )

    // The premise: the trio fell back to plain entries, and the dispatch is the *bound* one - a
    // `kind: 'bind'` entry, invisible to the old `kind: 'alias'`-only scan.
    expect(restored.actions.map((entry) => entry.kind).sort()).toEqual(['alias', 'alias', 'bind'])
    expect(restored.actions.some((entry) => entry.kind === 'toggle')).toBe(false)

    const crossWired = findings.filter((finding) => finding.messageKey.endsWith('toggleCrossWired'))
    expect(crossWired).toHaveLength(1)
    expect(crossWired[0]!.params).toMatchObject({
      dispatch: 'zoom',
      first: 'zoom_s1',
      second: 'zoom_s2',
    })
  })

  /**
   * the four broken-toggle shapes the *first* round's widening
   * still could not see, because the check walked from the dispatch *through* state 1 to find state
   * 2 - so anything wrong with state 1 itself ended the walk instead of producing a finding.
   *
   * Each case is one hand edit of the same rendered fixture, read back through the real parser and
   * restore, exactly like the case above. `dispatch`/`first` are `zoom`/`zoom_s1` throughout; only
   * what the file says about state 2 differs.
   */
  const brokenToggleShapes: [string, (text: string) => string, string][] = [
    // The story's Test Plan step 6, verbatim: "hand-edit so both toggle states reassign to
    // `zoom_s1`". State 1 now hands the dispatch to *itself*, so the walk from state 1 landed back
    // on state 1 and the old check discarded the trio (`second === first`).
    [
      'both states reassign to `zoom_s1` (Test Plan step 6, verbatim)',
      (text) => text.replace('alias zoom zoom_s2"', 'alias zoom zoom_s1"'),
      'zoom_s2',
    ],
    // State 2 is gone: state 1 still hands the dispatch to a name the file no longer defines. The
    // old check looked the name up, found nothing, and moved on.
    [
      'state 2`s line was deleted, so state 1 hands over to nothing',
      (text) => text.replace(/^alias zoom_s2 .*\n/m, ''),
      'zoom_s2',
    ],
    // State 1 hands the dispatch back to the dispatch itself - a loop of one that the old check
    // discarded as `second === dispatch`.
    [
      'state 1 reassigns the dispatch to the dispatch itself',
      (text) => text.replace('alias zoom zoom_s2"', 'alias zoom zoom"'),
      'zoom_s2',
    ],
    // A three-state chain (s1 -> s2 -> s3 -> s1), the third state hand-added the way a user adds a
    // line: untagged. Two states rewriting each other is a toggle; three in a ring is not, and the
    // old check could only ever compare *one* pair.
    [
      'the states form a three-state ring instead of a pair',
      (text) =>
        `${text.replace('fov 90; alias zoom zoom_s1"', 'fov 90; alias zoom zoom_s3"')}alias zoom_s3 "fov 60; alias zoom zoom_s1"\n`,
      'zoom_s2',
    ],
  ]

  for (const [label, mangle, second] of brokenToggleShapes) {
    it(`reports toggleCrossWired when ${label}`, async () => {
      const { restored, findings } = await careFor('Toggle entry with two labelled states', mangle)

      // The premise, as in the case above: the trio fell back to plain entries, none of them a
      // half-built toggle.
      expect(restored.actions.some((entry) => entry.kind === 'toggle')).toBe(false)
      expect(restored.actions.some((entry) => entry.parts !== undefined)).toBe(false)

      const crossWired = findings.filter((finding) =>
        finding.messageKey.endsWith('toggleCrossWired'),
      )
      expect(crossWired).toHaveLength(1)
      expect(crossWired[0]!.level).toBe('warning')
      expect(crossWired[0]!.params).toMatchObject({ dispatch: 'zoom', first: 'zoom_s1', second })
    })
  }

  it('a `+` half whose `-` half was deleted reports pressWithoutRelease even though it is bound', async () => {
    const { restored, findings } = await careFor(
      'Press/release entry next to a lone + half',
      (text) => text.replace(/^alias -slow .*\n/m, ''),
    )

    const half = restored.actions.find((entry) => entry.aliasName === '+slow')
    expect(half?.kind).toBe('bind')
    expect(slotsOf(half!)).toEqual(['SHIFT'])

    const names = findings
      .filter((finding) => finding.messageKey.endsWith('pressWithoutRelease'))
      .map((finding) => finding.params?.['name'])
    expect(names).toContain('+slow')
  })

  it('a `-` half whose `+` half was deleted reports releaseWithoutPress', async () => {
    // The `bind SHIFT "+slow"` line goes with it. Deleting the alias line alone does not leave a
    // release-only shape at all: the bind line is still launcher-tagged, so restore rebuilds an
    // aliasless entry that carries `+slow` as its own name (`ownAliasNameFromBind`) and the `-` half
    // has a partner again - correctly, since the file really does still define that name's binding.
    const { findings } = await careFor('Press/release entry next to a lone + half', (text) =>
      text.replace(/^alias \+slow .*\n/m, '').replace(/^bind SHIFT .*\n/m, ''),
    )

    const names = findings
      .filter((finding) => finding.messageKey.endsWith('releaseWithoutPress'))
      .map((finding) => finding.params?.['name'])
    expect(names).toEqual(['-slow'])
  })
})
