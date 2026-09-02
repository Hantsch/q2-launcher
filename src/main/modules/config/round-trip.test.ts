import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ConfigProfile } from '@shared/modules/config'
import { generateLayerAliases } from '@shared/config/alt-layers'
import { renderProfileFile } from '@shared/config/render'
import { restoreProfileParts } from '@shared/config/profile-restore'
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
 * - `canonicalizeRefs` - the ownership sentinel's profile id and every `e=`/`cat=`/`layer=` tag
 *   value are opaque, freshly-minted identifiers by construction (a fresh `newId()` per restored
 *   entry/category/layer): their literal value carries no more meaning than `profile.id` does, only
 *   the *grouping* they express matters, which first-appearance canonicalisation preserves.
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

/** Replaces every opaque, freshly-minted identifier with a canonical, first-appearance-indexed
 * token: the ownership sentinel's profile id, and every `e=`/`cat=`/`layer=` tag value. */
function canonicalizeRefs(text: string): string {
  const maps: Record<string, Map<string, string>> = {
    sentinel: new Map(),
    e: new Map(),
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
  out = out.replace(/\b(e|cat|layer)=([^\s\]]+)/g, (_m, key: string, value: string) =>
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
  return text.replace(/^(\/\/ --- .*) -{2,}$/gm, '$1')
}

function normalize(text: string): string {
  return stripBannerDashPadding(canonicalizeRefs(text))
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
 * The two defects the story 042 hard-tier review found that the fixed-point loop above cannot see on
 * its own: it compares RENDERED TEXT, so any state the writer never emits is lost with no failing
 * assertion, and any state the restore reassigns *consistently* re-renders as a valid file - just not
 * the same profile. Both are asserted here against the restored objects instead.
 */
describe('closed gap: an entry bound only through a modifier keeps its identity (review Bug 1)', () => {
  for (const name of ['Modifier-only catalogue entry', 'Self-mirroring alias']) {
    it(`"${name}": name, kind, categoryId, catalogId, key and keyModifier all survive`, async () => {
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
      expect(restored.key).toBe(original.key)
      expect(restored.keyModifier).toBe(original.keyModifier)
      expect(restored.secondaryKey).toBeUndefined()
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

    // Same logical profile: one entry, r/ALT primary and t/CTRL secondary, two layers.
    expect(ctrlFirst.actions![0]!.key).toBe(altFirst.actions![0]!.key)
    expect(ctrlFirst.layers!.map((layer) => layer.triggerKey)).toEqual(
      [...altFirst.layers!].reverse().map((layer) => layer.triggerKey),
    )

    const slots = async (profile: ConfigProfile) => {
      const { profile2 } = await reimportProfile(profile)
      return profile2.actions!.map((entry) => ({
        name: entry.name,
        key: entry.key,
        keyModifier: entry.keyModifier,
        secondaryKey: entry.secondaryKey,
        secondaryKeyModifier: entry.secondaryKeyModifier,
      }))
    }

    const fromAltFirst = await slots(altFirst)
    const fromCtrlFirst = await slots(ctrlFirst)

    expect(fromCtrlFirst).toEqual(fromAltFirst)
    // And the stable order really is (modifier, key), not "whatever the array said" - which for this
    // profile also happens to be the original assignment.
    expect(fromAltFirst).toEqual([
      {
        name: 'Reload weapon',
        key: 'r',
        keyModifier: 'ALT',
        secondaryKey: 't',
        secondaryKeyModifier: 'CTRL',
      },
    ])
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
    return {
      key: entry.key,
      keyModifier: entry.keyModifier,
      secondaryKey: entry.secondaryKey,
      secondaryKeyModifier: entry.secondaryKeyModifier,
      aliasName: entry.aliasName,
    }
  }

  it('the anti-alphabetical assignment (t/CTRL primary, r/ALT secondary) is not swapped', async () => {
    // Before the fix the anchor gate was per action, not per slot: this entry HAS a line (its alias
    // line, kept because it carries an own alias name), but that line records no `slot`/`mod`, so
    // both slots fell through to the (modifier, key) fallback - which sorts ALT first and therefore
    // handed `r`/ALT the primary slot.
    expect(await slots(findFixture('Own alias name, both slots modified'))).toEqual({
      key: 't',
      keyModifier: 'CTRL',
      secondaryKey: 'r',
      secondaryKeyModifier: 'ALT',
      aliasName: 'rail_combo',
    })
  })

  it('the mirrored assignment (r/ALT primary, t/CTRL secondary) is not swapped either', async () => {
    // The same shape with its two slots exchanged: a "fix" that merely inverted the guess would
    // break exactly here.
    expect(await slots(findFixture('Own alias name, both slots modified (mirrored slots)'))).toEqual({
      key: 'r',
      keyModifier: 'ALT',
      secondaryKey: 't',
      secondaryKeyModifier: 'CTRL',
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
    expect(restored.key).toBe(original.key)
    expect(restored.keyModifier).toBe(original.keyModifier)
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

// ---------------------------------------------------------------------------
// Adversarial mangling: hand-corrupt the rendered text, re-import, and confirm
// no line is dropped, nothing throws, and a warning is produced (not silence).
// ---------------------------------------------------------------------------

function findFixture(name: string): ConfigProfile {
  const found = ROUND_TRIP_FIXTURES.find((p) => p.name === name)
  if (!found) throw new Error(`no fixture named "${name}"`)
  return found
}

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

describe('adversarial mangling (story 042 D9 - not accepted on a green diff read)', () => {
  it('two-slot entry with a layer override: deleting the [q2l ...] tail from the base bind line', async () => {
    const profile = findFixture('Two-slot entry with a layer override')
    const text = renderProfileFile(profile)
    const mangled = text.replace(/^(bind i\s+"use_item")\s*\/\/.*$/m, '$1')
    expect(mangled).not.toBe(text)

    const before = await reimport(text)
    const after = await reimport(mangled)
    expect(after.binds.i).toBe('use_item')
    expect(countConfigLines(after)).toBe(countConfigLines(before))

    const restored = restoreProfileParts(toRestoreInput(after, [], randomUUID))
    // The bind survives verbatim in `result.binds` (an unowned bind now, since its tag - the only
    // thing that could have attributed it to the "Use item" entry - is gone): no config line is
    // lost. The entry itself is rebuilt from its alias line, and recovers a key slot ONLY through
    // `restoreModifierSlots`' unrelated ALT-layer path (its `u`/ALT override still names this
    // entry's `bindValueFor`) - `key: 'i'` is genuinely gone, degraded to "no attribution", exactly
    // the "costs the entry, never the bind" contract `profile-restore.ts`'s own doc comment states.
    const entry = restored.actions.find((a) => a.name === 'Use item')
    expect(entry).toBeDefined()
    expect(entry!.key).not.toBe('i')
    expect(entry!.key === 'u' || entry!.secondaryKey === 'u').toBe(true)
  })

  it('two-slot-two-modifier entry: truncating the alias line\'s tag mid-way ([q2l e=)', async () => {
    const profile = findFixture('Two-slot two-modifier entry')
    const text = renderProfileFile(profile)
    const mangled = text.replace(/\[q2l e=[0-9a-f]+ k=bind\]/, '[q2l e=')
    expect(mangled).not.toBe(text)

    const before = await reimport(text)
    const after = await reimport(mangled)
    expect(countConfigLines(after)).toBe(countConfigLines(before))
    expect(after.aliases.some((a) => a.name === 'reload_weapon')).toBe(true)

    const restored = restoreProfileParts(toRestoreInput(after, [], randomUUID))
    expect(restored.warnings.some((w) => w.reason === 'tag-malformed')).toBe(true)
  })

  it('collision-forced pair: [q2l v=999] unknown future version in the header', async () => {
    const profile = findFixture('Colliding entry refs')
    const text = renderProfileFile(profile)
    const mangled = text.replace(/\[q2l v=\d+\]/, '[q2l v=999]')
    expect(mangled).not.toBe(text)

    const after = await reimport(mangled)
    const restored = restoreProfileParts(toRestoreInput(after, [], randomUUID))
    expect(restored.actions.map((a) => a.name).sort()).toEqual(['Collider A', 'Collider B'])
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

  it('a bind line tag claiming a kind that contradicts the physical bind line itself', async () => {
    const profile = findFixture('Two-slot entry with a layer override')
    const text = renderProfileFile(profile)
    // Claim `k=alias` on the entry's own alias-line tag (the field `resolveKind` actually reads
    // first, when an alias line exists) while the entry is still physically `bind`-ed on key `i` -
    // the one shape `resolveKind` explicitly refuses: an alias entry is never bound.
    const mangled = text.replace(/(alias use_item invuse\s*\/\/[^[]*\[q2l e=[0-9a-f]+ )k=bind/, '$1k=alias')
    expect(mangled).not.toBe(text)

    const before = await reimport(text)
    const after = await reimport(mangled)
    expect(after.binds.i).toBe('use_item')
    expect(countConfigLines(after)).toBe(countConfigLines(before))

    const restored = restoreProfileParts(toRestoreInput(after, [], randomUUID))
    const entry = restored.actions.find((a) => a.key === 'i')
    expect(entry).toBeDefined()
    expect(entry!.kind).not.toBe('alias')
    expect(restored.warnings.some((w) => w.reason === 'tag-kind-contradicted')).toBe(true)
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
