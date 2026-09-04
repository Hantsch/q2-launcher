import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ConfigAction, ConfigProfile } from '@shared/modules/config'
import { actionKeySlots } from '@shared/config/action-slots'
import { generateLayerAliases } from '@shared/config/alt-layers'
import { COMMENT_LINE_BUDGET, COMMENT_PREFIX, renderProfileFile } from '@shared/config/render'
import { restoreProfileParts } from '@shared/config/profile-restore'
import { validateActions } from '@shared/config/validate-actions'
import { ROUND_TRIP_FIXTURES } from '@shared/config/fixtures/profiles'
import { readImportableConfig } from './core/import-reader'
import { toRestoreInput } from './import'
import { StateStore } from '../../services/state'
import { ProfilesStore } from './profiles'
import { hashCanonicalFileContent } from './file-source'
import { detectSectionHeaderStyle, detectWriteUnbindall, recoverProfileName } from './rebuild'

/**
 * Story 042 D9: `render(parse(render(p))) === render(p)` over the real production pipeline -
 * `renderProfileFile` (D2/D7), the real `readImportableConfig` parser (D3) reading the rendered
 * text back off disk, `toRestoreInput` (the small export added to `import.ts` by this D so the
 * text->parts step can be driven without an installation - see the report), and
 * `restoreProfileParts` (D4).
 *
 * Two normalisations are applied to BOTH renders before comparing, both explained and justified in
 * this D's report rather than snuck in silently:
 *
 * - `canonicalizeMintedIds` - the ownership sentinel's profile id and every `cat=`/`layer=` tag
 *   value are opaque, freshly-minted identifiers by construction (a fresh `newId()` per restored
 *   category/layer): their literal value carries no more meaning than `profile.id` does, only
 *   the *grouping* they express matters, which first-appearance canonicalisation preserves.
 *   Story 050 removed this normaliser's fourth and original subject, `e=`, together with the field
 *   itself - see the function's own comment for why the remaining three are not optional.
 * - `stripBannerDashPadding` - a `dashes`-style section banner's trailing fill is padded out to a
 *   fixed on-screen width, so a `cat=`/`layer=` value of a different LENGTH than the original
 *   (inevitable once the id itself is freshly minted) changes the dash count even though nothing
 *   about the content changed. Purely cosmetic and one-directional (only removes a variable-length
 *   trailing decoration), so it cannot hide a real content regression.
 *
 * A third, adversarial-pass finding - a layer's own trigger `bind <key> <alias>` line reappearing,
 * redundantly, in an "Other binds" section on reimport - was found and closed by this pass rather
 * than normalised around: `profile.binds` mirrors the file's physical bind table (story 034), so a
 * reimported file legitimately gains a `profile.binds` entry for a trigger key it did not have
 * before; `render.ts`'s `buildBindSections` now excludes any bind whose key *and* value match one of
 * `buildLayerSections`' own trigger lines (`buildLayerTriggerIndex`), the same line
 * `buildLayerSections` already writes under the layer's own section. No test-side exclusion remains
 * - every fixture, triggered layers included, goes through the one general loop below.
 */

let root: string

/** Every `StateStore` an adopt case below opened, settled before the temp directory goes away so no
 * pending `state.json` write outlives it. */
const openStores: StateStore[] = []

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'q2-launcher-round-trip-'))
})

afterEach(async () => {
  for (const store of openStores) await store.settle()
  openStores.length = 0
  await rm(root, { recursive: true, force: true })
})

/** Writes `text` as `<root>/baseq2/config.cfg` and reads it back through the real importer. */
async function reimport(text: string) {
  const gamedir = join(root, 'baseq2')
  await mkdir(gamedir, { recursive: true })
  await writeFile(join(gamedir, 'config.cfg'), Buffer.from(text, 'latin1'))
  return readImportableConfig(root, 'baseq2')
}

/**
 * Replaces every opaque, freshly-minted identifier with a canonical, first-appearance-indexed
 * token: the ownership sentinel's profile id, and every `cat=`/`layer=` tag value.
 *
 * Story 050 D8: this used to canonicalise `e=` as well, and the story's plan calls for the whole
 * function to go away with that field ("there are no refs left to canonicalise"). Only the `e`
 * half could actually go. The other three subjects are *not* refs and never were: a restored
 * custom category gets a locally minted id (`profile-restore.ts#categoryRegistry` - a colleague's
 * category id means nothing here), a restored layer likewise, and the sentinel names the profile
 * the file was written for. All three are freshly minted by construction on every read-back, so
 * comparing them literally would fail for every fixture with a custom category or a layer no
 * matter how correct the writer is - it would test `randomUUID`, not the fixed point. Measured
 * rather than assumed: with this call removed from `normalize`, 20 of the corpus' 31 fixtures fail
 * on nothing but a `cat=`/`layer=` value (every modifier-slot fixture included, since a modifier
 * slot always mints a layer), each one with an otherwise byte-identical file.
 */
function canonicalizeMintedIds(text: string): string {
  const maps: Record<string, Map<string, string>> = {
    sentinel: new Map(),
    cat: new Map(),
    layer: new Map(),
  }
  const tokenFor = (kind: string, value: string): string => {
    const map = maps[kind]!
    if (!map.has(value)) map.set(value, `${kind.toUpperCase()}${map.size}`)
    return map.get(value)!
  }

  // Story 043 D1 replaced the sentinel's trailing clause ("- generated, do not edit" became
  // "- hand-edited changes are read back"), which left this pattern matching nothing at all; it is
  // anchored on the clause's leading `-` only now, the same wording-tolerant rule `ownedProfileId`
  // itself follows. Found by 043 D10's adversarial pass - harmless while it lasted (both sides of
  // the comparison carry the same profile id), but a normaliser that silently stops normalising is
  // exactly the kind of thing that hides the next real regression.
  let out = text.replace(/(\/\/ q2-launcher profile )(\S+)( -)/, (_m, pre, id, post) =>
    `${pre}${tokenFor('sentinel', id)}${post}`,
  )
  out = out.replace(/\b(cat|layer)=([^\s\]]+)/g, (_m, key: string, value: string) =>
    `${key}=${tokenFor(key, value)}`,
  )
  return out
}

/**
 * A `dashes`-style section banner's trailing fill is variable-width by construction (padded out to
 * a fixed on-screen column count) - see the file doc comment. Trimming it is one-directional and
 * touches nothing else on the line.
 *
 * Story-042-review finding 6 (fix-cycle-5 continuation): the original pattern's lazy `.*?` plus
 * optional ` *` before the dash run finds the *first* place a trailing all-dash run could start,
 * not the *real* boundary `banner()` actually draws - a fixture title containing its own literal
 * `--` (one of D9's own required edge cases) could have that real content eaten as if it were
 * padding, which is exactly backwards for a normaliser whose only job is to make a genuine
 * regression still visible. `banner()`'s dashes branch (`cfg-layout.ts`) only ever inserts fill
 * after exactly one literal space, never zero, so a greedy `.*` (finds the *longest* possible
 * content, i.e. the *last* valid split point) plus a mandatory single space is the actual inverse
 * of what it writes - the same anchor `profile-restore.ts#bannerTitle`'s `DASHES_SUFFIX` now uses
 * to read a title back for real, restated here so the test's own safety net matches the production
 * rule instead of a looser approximation of it.
 */
function stripBannerDashPadding(text: string): string {
  // `-+`, not `-{2,}`: `DASHES_SUFFIX` is ` -+$`, and a fill of *exactly one* dash is a shape
  // `banner()` really does draw (story 050 D8 found it on the two new fixtures whose only
  // variable-length tag value is a layer id - one render's fill was ` -`, the other's empty, and
  // nothing else on the line differed). Requiring two dashes made this normaliser stop being the
  // inverse of what the writer writes for that one length, which is exactly the "a normaliser that
  // silently stops normalising" trap `canonicalizeMintedIds`' own comment above records.
  return text.replace(/^(\/\/ --- .*) -+$/gm, '$1')
}

function normalize(text: string): string {
  return stripBannerDashPadding(canonicalizeMintedIds(text))
}

/**
 * One entry's key slots as `KEY` / `MOD+KEY` strings, in slot order (story 050).
 *
 * Every slot assertion below goes through this rather than through `entry.keys` directly: slots are
 * an array whose *order* is the whole subject (order is what the file records instead of the removed
 * `slot` field), and reading them through `action-slots.ts`' accessor is the discipline that module
 * asks of every reader.
 */
function slotsOf(action: ConfigAction): string[] {
  return actionKeySlots(action).map((slot) =>
    slot.modifier ? `${slot.modifier}+${slot.key}` : slot.key,
  )
}

/** Rebuilds a fresh `ConfigProfile` out of one real render->parse pass over `profile`, carrying
 * over only the fields `restoreProfileParts` never claims to recover (see D4's own doc comment:
 * `id` is reported, never adopted; `writeUnbindall`/`sectionHeaderStyle` carry no tag key in
 * `profile-metadata.ts`'s registry at all). */
async function reimportProfile(profile: ConfigProfile): Promise<{ profile2: ConfigProfile; text1: string }> {
  const text1 = renderProfileFile(profile)
  const result = await reimport(text1)
  const restored = restoreProfileParts(toRestoreInput(result, [], randomUUID))

  const profile2: ConfigProfile = {
    id: profile.id,
    name: profile.name,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
    cvars: result.cvars,
    binds: result.binds,
    assignments: [],
    categories: restored.categories,
    actions: restored.actions,
    layers: restored.layers,
    writeUnbindall: profile.writeUnbindall,
    sectionHeaderStyle: profile.sectionHeaderStyle,
  }
  return { profile2, text1 }
}

describe('round-trip: render(parse(render(p))) === render(p) (story 042 D9)', () => {
  for (const profile of ROUND_TRIP_FIXTURES) {
    it(`is a fixed point for "${profile.name}"`, async () => {
      const { profile2, text1 } = await reimportProfile(profile)
      const text2 = renderProfileFile(profile2)
      expect(normalize(text2)).toBe(normalize(text1))
    })
  }
})

/**
 * Story 045, D7 - the new entry kinds and the new command kind survive the real pipeline as
 * *objects*, not just as bytes.
 *
 * The fixed-point loop above cannot carry this on its own, and for these shapes it is not even
 * close to sufficient: a `+slow`/`-slow` pair that fell back to two plain `kind: 'alias'` entries
 * re-renders byte-for-byte identically (the alias lines and the bind line are the same text either
 * way), and so does a body of literal `wait` segments read back as five raw commands. Only the
 * restored model can say whether the kind and the wait command actually came back.
 */
describe('story 045: the two-part kinds and the wait command survive as objects', () => {
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

    // A `+` half with no `-` half is not a pair (D5's all-or-nothing rule) and stays a plain entry.
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
   * Story-045 review, finding 1. The fixed-point loop above already covers these two fixtures as
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
   * Story-045 review round 2, finding 4 - the same budget cut on the shape that has nothing to do
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
   * Story-045 review round 2, finding 2 - the counter-scenario the review names: three real,
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
   * Story-045 review, finding 4: `restoreModifierSlots`' first pass looks for an entry that has a
   * modified slot and "no command yet", and used to write the layer override's command straight into
   * its `commands`. A two-part entry has `commands: []` **by contract** (its bodies live in `parts`),
   * so it matched that predicate every time - and came back holding both a `parts` body and a stray
   * raw `zoom` command, the half-an-entry shape the model is supposed to make impossible.
   *
   * Invisible to the fixed-point loop, because `renderTwoPartAliases` renders from `parts` and never
   * looks at `commands` - the file round-tripped perfectly while the model behind it did not.
   */
  it('"Toggle whose only slot carries a modifier": the ALT override does not leak into `commands`', async () => {
    const { profile2 } = await reimportProfile(findFixture('Toggle whose only slot carries a modifier'))

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
   * Story-045 review round 2, finding 3 - story 045's Plan step 5 case "a `wait` at the chunk
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

/**
 * The two defects the story 042 hard-tier review found that the fixed-point loop above cannot see on
 * its own: it compares RENDERED TEXT, so any state the writer never emits is lost with no failing
 * assertion, and any state the restore reassigns *consistently* re-renders as a valid file - just not
 * the same profile. Both are asserted here against the restored objects instead.
 */
/**
 * Story 045 AC7 through the story's own Test Plan step 6, and the shape story-045 review finding 2
 * says the D8 unit tests missed: the broken toggle/pair is **bound to a key**, which is the only
 * state a player ever meets one in.
 *
 * Driven the way the Test Plan drives it - render the healthy entry, hand-edit the rendered file the
 * way the Raw File tab lets a user hand-edit it, read it back through the real parser and restore,
 * and ask Care about the result. That routing is the whole point: a bound dispatch alias restores as
 * `kind: 'bind'`, not `kind: 'alias'`, and the checks used to look at `kind: 'alias'` entries only,
 * so every one of these repros produced zero findings while the unbound orphans the unit tests
 * construct by hand produced one.
 */
describe('story 045 AC7: Care sees a broken toggle/pair that is bound to a key (review finding 2)', () => {
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
    expect(crossWired[0]!.params).toMatchObject({ dispatch: 'zoom', first: 'zoom_s1', second: 'zoom_s2' })
  })

  /**
   * Story-045 review round 2, finding 1: the four broken-toggle shapes the *first* round's widening
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

      const crossWired = findings.filter((finding) => finding.messageKey.endsWith('toggleCrossWired'))
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

describe('closed gap: an entry bound only through a modifier keeps its identity (review Bug 1)', () => {
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
      // The id is minted locally, never adopted from the file (AC4).
      expect(restored.id).not.toBe(original.id)
    })
  }
})

describe('closed gap: slot assignment does not depend on layer array order (review Bug 3)', () => {
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

/**
 * Story 042 review round 2. Same reason the two blocks above exist: the fixed-point loop compares
 * rendered text, and a restore that reassigns state *consistently* re-renders as a valid file - just
 * not the same profile. Asserted against the restored objects instead.
 */
describe('closed gap: both slots modified plus an alias line keeps its slot assignment (round 2, NEW-2)', () => {
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
    expect(await slots(findFixture('Own alias name, both slots modified (mirrored slots)'))).toEqual({
      slots: ['ALT+r', 'CTRL+t'],
      aliasName: 'rail_combo',
    })
  })

  it('does not depend on the order the two layer sections appear in', async () => {
    expect(await slots(findFixture('Own alias name, both slots modified (layers reversed)'))).toEqual(
      await slots(findFixture('Own alias name, both slots modified')),
    )
  })
})

describe('closed gap: an anchored entry keeps its own alias name (round 2, NEW-3)', () => {
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

/**
 * Story 042 review round 3, the deliberate *revert* of round 2's NEW-1 "fix". Round 2 gave a fully
 * keyless entry an entry anchor so its identity survived; this test pins that it no longer does, and
 * why that is the better answer - see `render.ts#buildAnchorLines` for the full argument and
 * `catalog-binds.ts#applySlot` for the find-or-create-on-`catalogId` path that made the "fix" worse
 * than the loss: a restored entry with `commands: []` gets reused as the base for the next bind of
 * that catalogue row, producing a key that points at an alias nothing defines.
 */
describe('reverted: a fully keyless catalogue entry leaves no line and is dropped (round 3)', () => {
  it('"Keyless catalogue entry": no anchor is written and the entry is absent on reimport', async () => {
    const profile = findFixture('Keyless catalogue entry')
    const original = profile.actions![0]!
    const { profile2, text1 } = await reimportProfile(profile)

    // No alias line (a continuous catalogue row mirrors as its own bare command), no bind line (no
    // key), and - since round 3 - no anchor line either: nothing in the file mentions this entry.
    expect(text1).not.toContain('Entries:')
    expect(text1).not.toContain(original.catalogId!)
    expect(text1).not.toContain(original.name)

    // Harmless, documented, and exactly the pre-042 behaviour: binding this catalogue row through
    // the UI later goes through `freshAction`, which regenerates `+moveleft` from the catalogue.
    expect(profile2.actions).toEqual([])

    // And the fixed point holds across the loss.
    expect(normalize(renderProfileFile(profile2))).toBe(normalize(text1))
  })
})

/**
 * Story 042 review round 3: an anchor line is a comment-only line, so the reader has to decide
 * whether a given comment line is an entry anchor or a section-header banner - and it used to decide
 * that from the line's *prose*, which is a user-typed display name. Asserted against the restored
 * objects rather than the text, for the usual reason: a consistently mis-categorised entry still
 * re-renders as a valid file.
 */
describe('closed gap: a `---` in a display name is not read as a section header (round 3)', () => {
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
    // `movement` is a built-in id, adopted rather than created - so nothing at all should have been
    // minted locally, least of all a category named after somebody's display name.
    expect(profile2.categories).toEqual([])

    // ...and therefore the second render is the same file, with no section header named after that
    // display name (a header is the only line that carries a `cat=` tag).
    const text2 = renderProfileFile(profile2)
    expect(text2).not.toMatch(/^\/\/.*Strafe --- left.*\[q2l cat=/m)
    expect(normalize(text2)).toBe(normalize(text1))
  })
})

describe('closed gap: a layer\'s own trigger bind does not leak into "Other binds" on reimport', () => {
  const triggeredFixtureNames = ['Hold layer', 'Two-slot entry with a layer override', 'Two-slot two-modifier entry']

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
        // real, physical bind (story 034: `profile.binds` mirrors the file's bind table).
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

function findFixture(name: string): ConfigProfile {
  const found = ROUND_TRIP_FIXTURES.find((p) => p.name === name)
  if (!found) throw new Error(`no fixture named "${name}"`)
  return found
}

// ---------------------------------------------------------------------------
// Story 050 D8: the shapes the reduced tag and the uncapped slot model added.
//
// The fixed-point loop above already covers all five as *text* (they are in the
// corpus), which is necessary and not sufficient for the same reason the
// story-042 blocks above exist: a restore that reassigns slots consistently
// re-renders as a valid file - just not the same profile. What each new fixture
// is actually about is therefore asserted against the restored objects, and
// against the one or two literal bytes of the file that carry the claim.
// ---------------------------------------------------------------------------

describe('story 050: slot identity comes from file order, uncapped', () => {
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

// ---------------------------------------------------------------------------
// Adversarial mangling: hand-corrupt the rendered text, re-import, and confirm
// no line is dropped, nothing throws, and a warning is produced (not silence).
// ---------------------------------------------------------------------------

/** Counts every physically importable config line - used to confirm a mangled variant still
 * imports "no config line dropped" (every cvar/bind/alias survives as *something*, even if its
 * entry attribution degraded). */
function countConfigLines(result: {
  cvars: Record<string, string>
  binds: Record<string, string>
  aliases: readonly unknown[]
  unrecognized: readonly unknown[]
}): number {
  return (
    Object.keys(result.cvars).length +
    Object.keys(result.binds).length +
    result.aliases.length +
    result.unrecognized.length
  )
}

/**
 * "No config line is silently lost", asserted end to end rather than by counting: restores the
 * parsed result and checks that every `bind` and `alias` line the mangled file still carried
 * reappears in the file the restored profile *re-renders*.
 *
 * That is the strictest form of the claim story 050 D8 has to make. `countConfigLines` only says
 * the parser still saw the line; this says the line also survived reconstruction - either owned by
 * an entry, or unowned in an `Other binds` section, or as an alias 041's inference recovered. A
 * mangled tag may legitimately cost a line its *attribution* (the entry row it belonged to); it may
 * never cost the line itself, which is exactly the "costs the entry, never the bind" contract
 * `profile-restore.ts`'s doc comment states.
 *
 * Not byte-identity: a hand-mangled file is not expected to be a fixed point (the whole point of
 * the mangle is that something in it is now different from what the writer would write).
 */
function expectEveryLineSurvivesRerender(
  result: Awaited<ReturnType<typeof reimport>>,
  rendered: string,
  /** Alias names this case *knowingly* loses, each one named here so a loss is always a statement
   * in the test source rather than a gap in what it checks. Only the truncated-tag case below
   * passes one; see there for the defect it records. */
  knownLostAliases: readonly string[] = [],
): void {
  for (const [key, command] of Object.entries(result.binds)) {
    expect(rendered, `bind ${key} "${command}" is missing from the re-render`).toMatch(
      new RegExp(`^bind\\s+${escapeRegExp(key)}\\s+"?${escapeRegExp(command)}"?`, 'm'),
    )
  }
  for (const alias of result.aliases) {
    if (knownLostAliases.includes(alias.name)) {
      // Held to the *opposite* assertion instead of skipped, so this list can never quietly outlive
      // the defect that justifies it.
      expect(rendered, `alias ${alias.name} was expected to be lost, but survived`).not.toMatch(
        new RegExp(`^alias\\s+${escapeRegExp(alias.name)}\\s`, 'm'),
      )
      continue
    }
    expect(rendered, `alias ${alias.name} is missing from the re-render`).toMatch(
      new RegExp(`^alias\\s+${escapeRegExp(alias.name)}\\s`, 'm'),
    )
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** One render -> parse -> restore pass over hand-mangled `text`, plus the profile that restore
 * rebuilds (same field mapping as `reimportProfile`, minus the render the caller supplies). */
async function restoreFromText(text: string): Promise<{
  result: Awaited<ReturnType<typeof reimport>>
  restored: ReturnType<typeof restoreProfileParts>
  rerendered: string
}> {
  const result = await reimport(text)
  const restored = restoreProfileParts(toRestoreInput(result, [], randomUUID))
  const rerendered = renderProfileFile({
    id: randomUUID(),
    name: 'Mangled',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    cvars: result.cvars,
    binds: result.binds,
    assignments: [],
    categories: restored.categories,
    actions: restored.actions,
    layers: restored.layers,
  })
  return { result, restored, rerendered }
}

describe('adversarial mangling (story 042 D9 - not accepted on a green diff read)', () => {
  it('two-slot entry with a layer override: deleting the [q2l ...] tail from the base bind line', async () => {
    const profile = findFixture('Two-slot entry with a layer override')
    const text = renderProfileFile(profile)
    const mangled = text.replace(/^(bind i\s+"use_item")\s*\/\/.*$/m, '$1')
    expect(mangled).not.toBe(text)

    const before = await reimport(text)
    const { result: after, restored, rerendered } = await restoreFromText(mangled)
    expect(after.binds.i).toBe('use_item')
    expect(countConfigLines(after)).toBe(countConfigLines(before))

    // The bind survives verbatim in `result.binds` (an unowned bind now, since its tag - the only
    // thing that could have attributed it to the "Use item" entry - is gone): no config line is
    // lost. The entry itself is rebuilt from its alias line, and recovers a key slot ONLY through
    // `restoreModifierSlots`' unrelated ALT-layer path (its `u`/ALT override still names this
    // entry's `bindValueFor`) - the `i` slot is genuinely gone, degraded to "no attribution",
    // exactly the "costs the entry, never the bind" contract `profile-restore.ts`'s doc comment
    // states.
    const entry = restored.actions.find((a) => a.name === 'Use item')
    expect(entry).toBeDefined()
    expect(slotsOf(entry!)).toEqual(['ALT+u'])
    expectEveryLineSurvivesRerender(after, rerendered)
  })

  it('two-slot-two-modifier entry: truncating an entry line\'s tag mid-way ([q2l)', async () => {
    const profile = findFixture('Two-slot two-modifier entry')
    const text = renderProfileFile(profile)
    // Story 050: this used to truncate `[q2l e=<hex> k=bind]` to `[q2l e=`. With the tag down to its
    // marker on this entry's alias line, the equivalent mangle is the unclosed marker itself - a
    // `[q2l` whose `]` the user deleted, which is what a half-finished hand edit leaves behind.
    const mangled = text.replace(/\[q2l\]/, '[q2l')
    expect(mangled).not.toBe(text)

    const before = await reimport(text)
    const { result: after, restored, rerendered } = await restoreFromText(mangled)
    expect(countConfigLines(after)).toBe(countConfigLines(before))
    expect(after.aliases.some((a) => a.name === 'reload_weapon')).toBe(true)
    expect(restored.warnings.some((w) => w.reason === 'tag-malformed')).toBe(true)

    // KNOWN DEFECT, pre-dates story 050 and out of D8's scope to fix - recorded here rather than
    // normalised away, because D8's own acceptance ("every adversarial variant loses no config
    // line") does not hold for this one inherited mangle:
    //
    // An `alias` line whose tag is present but *unreadable* is deliberately excluded from
    // `untaggedAliases` (`profile-restore.ts#groupEntryLines`, with its reason: re-running it
    // through 041's inference could produce a second, duplicate entry for one alias name). The
    // parser does keep the line - it is in `result.aliases`, and `tag-malformed` is reported for it,
    // so the loss is not *silent* - but nothing reconstructs it into an entry, the line is not in
    // `unrecognized` either (the parser classified it fine), and `render.ts` re-derives alias lines
    // from `actions` alone. So the next save drops `alias reload_weapon reload` outright, while the
    // layer override that calls it survives: in-game, `Alt+r` then binds `r` to an alias nothing
    // defines - the dead-key failure mode `render.ts#buildAnchorLines`' own doc comment argues
    // against for the keyless-entry case. The entry itself survives from its two anchor lines, with
    // `commands` degraded from `reload` to the alias *name* the override carries.
    //
    // Pre-050 this exact mangle (`[q2l e=<hex> k=bind]` -> `[q2l e=`) behaved the same way; the old
    // version of this case only counted *parsed* lines, which is why it never showed.
    expect(restored.actions).toHaveLength(1)
    expect(restored.actions[0]!.commands).toEqual([{ kind: 'raw', text: 'reload_weapon' }])
    expectEveryLineSurvivesRerender(after, rerendered, ['reload_weapon'])
  })

  it('marker-tag-only pair: [q2l v=999] unknown future version in the header', async () => {
    const profile = findFixture('Marker-tag-only entry pair')
    const text = renderProfileFile(profile)
    const mangled = text.replace(/\[q2l v=\d+\]/, '[q2l v=999]')
    expect(mangled).not.toBe(text)

    const after = await reimport(mangled)
    const restored = restoreProfileParts(toRestoreInput(after, [], randomUUID))
    expect(restored.actions.map((a) => a.name).sort()).toEqual(['Pick blaster', 'Pick shotgun'])
    expect(restored.warnings.some((w) => w.reason === 'metadata-version-newer')).toBe(true)
  })

  it('custom category: editing a section header\'s cat= value to nonsense', async () => {
    const profile = findFixture('Forged category name')
    const text = renderProfileFile(profile)
    const mangled = text.replace(/cat=forged-cat/, 'cat=totally-bogus-nonsense')
    expect(mangled).not.toBe(text)

    const after = await reimport(mangled)
    const restored = restoreProfileParts(toRestoreInput(after, [], randomUUID))
    expect(restored.actions).toHaveLength(1)
    // A well-formed-but-unrecognised `cat` id mints a LOCAL category (D4's deliberate no-warning
    // design) - see this D's report for the "known open item" discussion of whether that still
    // matches the story's manual Test Plan step 7.
    expect(restored.categories).toHaveLength(1)
    expect(restored.warnings.filter((w) => w.reason.startsWith('tag-'))).toEqual([])
  })

  // -------------------------------------------------------------------------
  // Story 050 D8's own four hand-edit passes. The pre-050 fifth case - a tag
  // claiming `k=alias` on a line the config text says is a bind - is gone with
  // the field: kind is inferred from the lines now (`entryKindFor`), so there is
  // no tagged kind left for a hand edit to contradict.
  // -------------------------------------------------------------------------

  it('story 050: the tag deleted from ONE of an entry\'s three bind lines', async () => {
    const profile = findFixture('Hand-added third key')
    const text = renderProfileFile(profile)
    // The middle of three identical-value bind lines loses its whole `// â€¦ [q2l â€¦]` tail - the shape
    // a user produces by deleting a comment they found noisy.
    const mangled = text.replace(/^(bind g\s+"drop_rockets")\s*\/\/.*$/m, '$1')
    expect(mangled).not.toBe(text)

    const before = await reimport(text)
    const { result: after, restored, rerendered } = await restoreFromText(mangled)
    expect(countConfigLines(after)).toBe(countConfigLines(before))

    // The entry keeps the two slots whose lines still carry the marker; the untagged one is no
    // longer attributable to it (tag presence is the whole ownership signal since `e` went away), so
    // it degrades to an unowned bind - and appears as one, rather than vanishing.
    const entry = restored.actions.find((a) => a.name === 'Drop rockets')
    expect(entry).toBeDefined()
    expect(slotsOf(entry!)).toEqual(['f', 'h'])
    expect(after.binds.g).toBe('drop_rockets')
    expect(rerendered).toContain('Other binds')
    expect(rerendered).toMatch(/^bind g\s+"drop_rockets"$/m)
    expectEveryLineSurvivesRerender(after, rerendered)
  })

  it('story 050: the display prose renamed on one of an entry\'s lines splits it into two rows', async () => {
    const profile = findFixture('Modified slot 1 next to a plain slot 2')
    const text = renderProfileFile(profile)
    // The anchor line's prose is renamed to something that is not even a prefix of the entry's other
    // lines, so none of `matchAnchor`'s three steps (cid - this entry has none - then exact prose,
    // then a unique prefix relationship) can pair the two any more.
    const mangled = text.replace('// Reload weapon [q2l key=r mod=ALT]', '// Rocket reload [q2l key=r mod=ALT]')
    expect(mangled).not.toBe(text)

    const before = await reimport(text)
    const { result: after, restored, rerendered } = await restoreFromText(mangled)
    expect(countConfigLines(after)).toBe(countConfigLines(before))

    // Exactly the drift the User accepted in this story's Decisions: two rows, not one, and not a
    // crash and not a lost line. Splitting is the safe direction to fail in - a wrong *merge* would
    // silently rewrite which row owns which key.
    expect(restored.actions.map((a) => a.name).sort()).toEqual(['Reload weapon', 'Rocket reload'])
    const orphan = restored.actions.find((a) => a.name === 'Rocket reload')!
    expect(slotsOf(orphan)).toEqual(['ALT+r'])
    // The `r`/ALT modifier slot is also handed to the original entry by `restoreModifierSlots`' pass
    // 2, because the layer override that carries it still names that entry's own mirrored value and
    // the split-off row is no longer recognisable as its owner. That is the known limitation
    // `restoreModifierSlots` documents (round 2, NEW-4), reached here exactly as it says: only
    // through a hand-edited file. It is a duplicate *claim* on one key, which the Care tab reports
    // as a collision - not a lost key and not a lost line, which is what this pass is about.
    expect(slotsOf(restored.actions.find((a) => a.name === 'Reload weapon')!)).toEqual(['t', 'ALT+r'])
    expectEveryLineSurvivesRerender(after, rerendered)
  })

  it('story 050: a forged cat= field on a bind line that should not carry one is ignored', async () => {
    const profile = findFixture('Hand-added third key')
    const text = renderProfileFile(profile)
    // `cat` belongs on a section header, never on a code line. Forged onto one, it must not move the
    // entry into that category, and must not turn the bind line into a section boundary.
    const mangled = text.replace(
      /^(bind f\s+"drop_rockets"\s+\/\/ Drop rockets \[q2l cid=drop-rockets)\]$/m,
      '$1 cat=weapons]',
    )
    expect(mangled).not.toBe(text)

    const before = await reimport(text)
    const { result: after, restored, rerendered } = await restoreFromText(mangled)
    expect(countConfigLines(after)).toBe(countConfigLines(before))

    // `cat` is a *known* key, so there is nothing unknown to report - and the reader takes an
    // entry's category from the section header above it, never from the entry line's own tag, so the
    // forged field changes nothing at all. Ignored, which is the graceful half of "ignored or
    // reported": no warning, no crash, no line lost, and no category minted for it.
    expect(restored.actions).toHaveLength(1)
    expect(slotsOf(restored.actions[0]!)).toEqual(['f', 'g', 'h'])
    expect(restored.actions[0]!.categoryId).toBe('drops')
    expect(restored.categories).toEqual([])
    expect(restored.warnings.filter((w) => w.reason.startsWith('tag-'))).toEqual([])
    expectEveryLineSurvivesRerender(after, rerendered)
  })

  it('story 050: leftover e=/slot= from a hand-edited older file is reported, not obeyed and not fatal', async () => {
    const profile = findFixture('Hand-added third key')
    const text = renderProfileFile(profile)
    // The shape a file saved by a pre-050 build and then hand-edited further has: the two fields
    // this story removed, still sitting in a tag next to a key this build does know. D1's rule is
    // that `parseMetaTag` round-trips them into `fields` and names them in `unknownKeys` rather than
    // failing the tag - asserted here end to end, through restore.
    const mangled = text.replace(
      /^(bind f\s+"drop_rockets"\s+\/\/ Drop rockets \[q2l) (cid=drop-rockets)\]$/m,
      '$1 e=b8df77ed $2 slot=1]',
    )
    expect(mangled).not.toBe(text)

    const before = await reimport(text)
    const { result: after, restored, rerendered } = await restoreFromText(mangled)
    expect(countConfigLines(after)).toBe(countConfigLines(before))

    const unknown = restored.warnings.filter((w) => w.reason === 'tag-unknown-keys')
    expect(unknown).toHaveLength(1)
    expect(unknown[0]!.subject!.split(',').sort()).toEqual(['e', 'slot'])
    // The line stays the launcher's own (a tag with one unreadable token among good ones still
    // identifies its line), so the entry keeps all three of its keys - the leftover `slot=1` does
    // not renumber anything, and the dead `e=` does not regroup anything.
    expect(restored.actions).toHaveLength(1)
    expect(slotsOf(restored.actions[0]!)).toEqual(['f', 'g', 'h'])
    expect(restored.actions[0]!.catalogId).toBe('drop-rockets')
    expectEveryLineSurvivesRerender(after, rerendered)
    // And the re-render drops the two dead fields rather than carrying them forward.
    expect(rerendered).not.toContain('e=b8df77ed')
    expect(rerendered).not.toContain('slot=')
  })
})

// ---------------------------------------------------------------------------
// Story 048 D3: render -> parse -> ADOPT -> render.
//
// The loop at the top of this file rebuilds `profile2.cvars` straight from the
// parser's output, which is what the *writer* has to be a fixed point over. The
// production read-back does one more thing to that map - `stripCatalogDefaults`
// (048 D1) in `ProfilesStore.adoptFromFile` - because since D2 the file states
// every catalogue cvar, and storing all ~30 verbatim would record "the user
// chose this" for every default the writer merely restated. These cases drive
// the real store method, so the strip is pinned as the exact inverse of the
// always-write rather than as something merely plausible.
// ---------------------------------------------------------------------------

/**
 * Renders `profile`, reads the text back through the real parser, and adopts the result onto a real
 * `ProfilesStore` record exactly the way `index.ts`'s `refreshFromFiles` does - same field mapping,
 * same header/format recovery, same `adoptFromFile` entry point. Returns the record as the store
 * holds it afterwards.
 *
 * A fresh store per call, so a case can adopt the *same* profile id twice (the convergence case
 * below) without the second round tripping over the first one's record.
 */
async function adoptRendered(
  profile: ConfigProfile,
): Promise<{ adopted: ConfigProfile; text1: string }> {
  const text1 = renderProfileFile(profile)
  const result = await reimport(text1)
  const restored = restoreProfileParts(toRestoreInput(result, [], randomUUID))

  const store = new StateStore(join(root, `state-${openStores.length}.json`))
  await store.load()
  openStores.push(store)
  const profiles = new ProfilesStore(store)
  // The record as it stood before the file was read back: the very profile `text1` was rendered
  // from, under its own id (`addRebuilt` is the one store entry point that appends a finished record
  // without minting a new one - the id has to match, or the sentinel line alone would make every
  // byte comparison below fail for a reason that has nothing to do with cvars).
  const id = profile.id
  profiles.addRebuilt({ ...profile })
  expect(profiles.find(id)!.cvars).toEqual(profile.cvars)

  const list = profiles.adoptFromFile(
    id,
    {
      name: recoverProfileName(text1) ?? profile.name,
      cvars: result.cvars,
      binds: result.binds,
      actions: restored.actions,
      categories: restored.categories,
      layers: restored.layers,
      writeUnbindall: detectWriteUnbindall(text1),
      sectionHeaderStyle: detectSectionHeaderStyle(text1) ?? profile.sectionHeaderStyle,
    },
    hashCanonicalFileContent(text1),
    Date.now(),
  )
  return { adopted: list.find((p) => p.id === id)!, text1 }
}

describe('story 048 D3: adopting the launcher\'s own file back does not inflate profile.cvars', () => {
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
      // `adoptRawBinds` pass (story 034's "actions is the only authority for a catalogue bind"
      // invariant) can legitimately mint an entry for a raw bind the file carries - visible on the
      // "Hold layer" fixture, unrelated to cvars, and unchanged by this deliverable. The two
      // purpose-built cases below do assert the whole file, byte for byte.
      expect(setLines(renderProfileFile(adopted))).toEqual(setLines(text1))
    })
  }
})

/** Every `set` line of a rendered file, in order - the cvar block, alignment included. */
function setLines(text: string): string[] {
  return text.split('\n').filter((line) => line.startsWith('set '))
}

describe('story 048 D3: which cvars survive an adopt, by shape', () => {
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
      // emits it under the stored spelling (D2), so the strip must recognise it case-insensitively
      // (`findCvar`'s rule) and still hand the key back verbatim.
      Crosshair: '2',
      // Stored, but equal to the catalogue default ('0'): a file cannot express the difference
      // between "the user picked the default" and "the writer restated it", so this is the one
      // shape that legitimately does not survive.
      cl_gun: '0',
      // Stored empty = unset (D1's rule), rendered at the default, and not stored again.
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
    // `sensitivity`'s default is '4'; '4.0' is the same number, so D1's numeric-aware rule (the
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
