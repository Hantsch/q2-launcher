/**
 * Constructed `ConfigProfile` fixtures for the story 042 D9 round-trip property test
 * (`src/main/modules/config/round-trip.test.ts`) and its adversarial-mangling pass.
 *
 * Every fixture is built through `buildFixtureProfile`, which derives `binds`/`layers.overrides`
 * from `actions` the same way the real save path does (`applyActionBindMirror`/
 * `applyActionLayerMirror`) - a fixture whose mirror maps were hand-typed out of sync with its
 * actions would test nothing real, since `render.ts` reads `profile.binds`/`layer.overrides`
 * directly rather than re-deriving them from `actions` at render time.
 *
 * Pure, like every other file under `src/shared`: no `node:*`, no DOM, no electron.
 */

import type { AltLayer } from '@shared/config/alt-layers'
import { applyActionBindMirror } from '@shared/config/action-mirror'
import { applyActionLayerMirror } from '@shared/config/modifier-layers'
import type {
  ConfigAction,
  ConfigActionCategory,
  ConfigProfile,
} from '@shared/modules/config'

let counter = 0
/** Deterministic id factory - fixtures need no randomness, only distinctness. */
function nextId(prefix: string): () => string {
  return () => `${prefix}-${(counter++).toString(36)}`
}

export interface FixtureProfileInput {
  name: string
  actions: ConfigAction[]
  categories?: ConfigActionCategory[]
  /** Layers with `overrides: {}` - `buildFixtureProfile` derives modifier-layer overrides from
   * `actions` itself; a layer passed here with no modifier-carrying action is kept as-is (e.g. the
   * hold/toggle layer fixtures below, whose "overrides" are ordinary key remaps, not story 016
   * modifier slots). */
  layers?: AltLayer[]
  cvars?: Record<string, string>
  writeUnbindall?: boolean
  sectionHeaderStyle?: 'dashes' | 'brackets' | 'plain'
}

/**
 * Assembles one fixture `ConfigProfile`: `binds` mirrored from `actions` via
 * `applyActionBindMirror`, and every *modifier*-triggered layer's `overrides` mirrored via
 * `applyActionLayerMirror` (non-modifier layers - the hold/toggle fixtures, whose trigger is a
 * plain key - are passed through as given, since that mirror only ever touches ALT/CTRL/SHIFT
 * layers).
 */
export function buildFixtureProfile(input: FixtureProfileInput): ConfigProfile {
  const id = nextId('profile')()
  const baseBinds = applyActionBindMirror({}, input.actions)
  const layers = applyActionLayerMirror(input.layers ?? [], input.actions, nextId('layer'))

  return {
    id,
    name: input.name,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    cvars: input.cvars ?? {},
    binds: baseBinds,
    assignments: [],
    categories: input.categories ?? [],
    actions: input.actions,
    layers,
    writeUnbindall: input.writeUnbindall ?? true,
    sectionHeaderStyle: input.sectionHeaderStyle ?? 'dashes',
  }
}

function action(overrides: Partial<ConfigAction> & Pick<ConfigAction, 'name' | 'kind' | 'commands'>): ConfigAction {
  return {
    id: nextId('action')(),
    categoryId: 'movement',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Individual fixtures, each named for the one thing it is deliberately built
// to exercise (see the D9 requirement list).
// ---------------------------------------------------------------------------

/**
 * A self-mirroring alias (`alias weapnext weapnext`, dropped outright by `isSelfMirroringAlias`)
 * whose only key slot carries a **modifier** - so the entry has no alias line *and* no base bind
 * line, and its whole presence in the file is one override inside the ALT layer.
 *
 * Rebuilt for exactly that (story 042 review fix). The original version of this fixture used
 * `kind: 'alias'` and an unmodified key, which meant nothing at all was mirrored anywhere: the
 * profile rendered to a bare header plus `unbindall`, so the file it produced could not exercise the
 * "no alias line and no base bind line" case its own doc comment claimed, and the D9 fixed-point
 * property held over an empty file. What keeps this entry's identity now is the anchor line
 * `render.ts#buildAnchorLines` emits for its modified slot.
 */
export const selfMirroringAliasProfile: ConfigProfile = buildFixtureProfile({
  name: 'Self-mirroring alias',
  actions: [
    action({
      // `kind: 'bind'`, not `'alias'`: an alias entry is never bound and never mirrored into a layer
      // (story 019), so a modifier on one is stale data with no representation in the file at all.
      name: 'weapnext',
      kind: 'bind',
      commands: [{ kind: 'raw', text: 'weapnext' }],
      key: 'MWHEELUP',
      keyModifier: 'ALT',
      categoryId: 'weapons',
    }),
  ],
})

/**
 * Story 016's headline case, and the story 042 review's Bug 1 repro: a catalogue-backed continuous
 * command bound **only** through a modifier (`Alt+W` -> `+forward`).
 *
 * It has no alias line (a continuous catalogue row mirrors as its own bare `+forward`, so story
 * 034/038 drops the line) and no base bind line (a modified slot is mirrored into the ALT layer, not
 * into `profile.binds`), so before the review fix its name, `kind`, `categoryId` and `catalogId` were
 * silently gone on every re-import - `restoreProfileParts` returned `actions: []` for it - while the
 * rendered text still round-tripped, which is why the fixed-point property test never saw it.
 */
export const modifierOnlyCatalogueProfile: ConfigProfile = buildFixtureProfile({
  name: 'Modifier-only catalogue entry',
  actions: [
    action({
      name: 'Forward',
      kind: 'bind',
      commands: [{ kind: 'raw', text: '+forward' }],
      catalogId: 'forward',
      key: 'w',
      keyModifier: 'ALT',
      categoryId: 'movement',
    }),
  ],
})

/** A two-key, two-different-modifier entry: `key`=`r`/ALT, `secondaryKey`=`t`/CTRL - both mirror
 * slots land in two different modifier layers at once. */
export const twoSlotTwoModifierProfile: ConfigProfile = buildFixtureProfile({
  name: 'Two-slot two-modifier entry',
  actions: [
    action({
      name: 'Reload weapon',
      kind: 'bind',
      commands: [{ kind: 'raw', text: 'reload' }],
      key: 'r',
      keyModifier: 'ALT',
      secondaryKey: 't',
      secondaryKeyModifier: 'CTRL',
      categoryId: 'weapons',
    }),
  ],
})

/**
 * The very same logical profile as `twoSlotTwoModifierProfile`, with its two layers in the opposite
 * array order - the story 042 review's Bug 3 repro.
 *
 * Neither slot of that entry has a bind line (both carry a modifier), and a layer's override body
 * carries no per-override tag, so nothing in the file says which of the two keys was the *primary*.
 * Restore used to take that from whichever layer happened to come first in `profile.layers`, so
 * these two constructions - one profile, two array orders - restored with `key` and `secondaryKey`
 * swapped. `profile-restore.ts#modifierOverridesInStableOrder` now fixes the order to
 * (modifier, key), which is a pure function of the file's content; `round-trip.test.ts` asserts both
 * constructions restore identically.
 */
export const twoSlotTwoModifierLayersReversedProfile: ConfigProfile = (() => {
  const profile = buildFixtureProfile({
    name: 'Two-slot two-modifier entry (layers reversed)',
    actions: [
      action({
        name: 'Reload weapon',
        kind: 'bind',
        commands: [{ kind: 'raw', text: 'reload' }],
        key: 'r',
        keyModifier: 'ALT',
        secondaryKey: 't',
        secondaryKeyModifier: 'CTRL',
        categoryId: 'weapons',
      }),
    ],
  })
  return { ...profile, layers: [...(profile.layers ?? [])].reverse() }
})()

/**
 * Story 042 review round 2, NEW-2: an entry that **keeps its alias line** (it carries an own alias
 * name, so its mirror goes through the alias) while **both** its key slots are modified - `t`/CTRL as
 * the primary, `r`/ALT as the secondary, no base bind for either.
 *
 * The alias line records the entry but carries no `slot`/`mod` at all, so before the fix the
 * per-action anchor gate ("this action already has a line") skipped the anchors entirely and both
 * slots fell through to `restoreModifierSlots`' stable-but-guessed (modifier, key) fallback. That
 * fallback sorts ALT before CTRL, so this assignment - deliberately the *anti*-alphabetical one -
 * came back with primary and secondary silently swapped. `ownAliasBothSlotsModifiedAlphabeticalProfile`
 * is the mirror-image assignment, so a fix that merely inverted the guess fails too.
 */
export const ownAliasBothSlotsModifiedProfile: ConfigProfile = buildFixtureProfile({
  name: 'Own alias name, both slots modified',
  actions: [
    action({
      name: 'Rail combo',
      kind: 'bind',
      commands: [{ kind: 'raw', text: 'use railgun' }, { kind: 'raw', text: 'say_team rail out' }],
      aliasName: 'rail_combo',
      key: 't',
      keyModifier: 'CTRL',
      secondaryKey: 'r',
      secondaryKeyModifier: 'ALT',
      categoryId: 'weapons',
    }),
  ],
})

/** The mirror image of `ownAliasBothSlotsModifiedProfile`: `r`/ALT primary, `t`/CTRL secondary - the
 * assignment the alphabetical fallback happens to agree with, so the two fixtures together pin that
 * the slots come from the file's anchors rather than from any ordering rule. */
export const ownAliasBothSlotsModifiedAlphabeticalProfile: ConfigProfile = buildFixtureProfile({
  name: 'Own alias name, both slots modified (mirrored slots)',
  actions: [
    action({
      name: 'Rail combo',
      kind: 'bind',
      commands: [{ kind: 'raw', text: 'use railgun' }, { kind: 'raw', text: 'say_team rail out' }],
      aliasName: 'rail_combo',
      key: 'r',
      keyModifier: 'ALT',
      secondaryKey: 't',
      secondaryKeyModifier: 'CTRL',
      categoryId: 'weapons',
    }),
  ],
})

/** `ownAliasBothSlotsModifiedProfile` with its two layers in the opposite array order - the same
 * layer-order independence `twoSlotTwoModifierLayersReversedProfile` pins, for the shape that also
 * has an alias line. */
export const ownAliasBothSlotsModifiedLayersReversedProfile: ConfigProfile = {
  ...ownAliasBothSlotsModifiedProfile,
  name: 'Own alias name, both slots modified (layers reversed)',
  layers: [...(ownAliasBothSlotsModifiedProfile.layers ?? [])].reverse(),
}

/**
 * Story 042 review round 2, NEW-3: an entry whose alias line is dropped as a self-mirror (story 039)
 * and whose only key slot is modified, so its **own alias name** has no line anywhere to be read off.
 *
 * Reachable through the Care tab (`tidy-up.ts`), and before the fix the second render was a
 * genuinely different file: `aliasName` was lost on import, the re-rendered entry mirrored through a
 * name derived from its display name instead, and the anchor turned into a real `alias next_weapon
 * weapnext` line. The anchor now carries the name in its `an` field.
 */
export const ownAliasAnchoredProfile: ConfigProfile = buildFixtureProfile({
  name: 'Own alias name on an anchored entry',
  actions: [
    action({
      name: 'Next weapon',
      kind: 'bind',
      commands: [{ kind: 'raw', text: 'weapnext' }],
      aliasName: 'weapnext',
      key: 'MWHEELUP',
      keyModifier: 'ALT',
      categoryId: 'weapons',
    }),
  ],
})

/**
 * Story 042 review round 3: an anchor line whose **display name contains a banner rule** (`---`),
 * followed by a second anchor in the same category section.
 *
 * `profile-restore.ts#scanComments` used to decide "is this comment-only line a section header?" by
 * testing the line for three consecutive `-`/`=` characters *before* looking at whether it carries a
 * `[q2l …]` tag. Nothing stops a user typing `---` in a display name, so the first anchor below was
 * read as an untagged banner as well as an anchor: it minted a bogus category called
 * `Strafe --- left` and re-filed every line under it in the same section - here, the second entry -
 * into that category. Silent, and invisible to a fixed-point test on the *first* render, because the
 * damage only shows up as a second, differently-shaped file on the render after that.
 *
 * Both entries are modifier-only catalogue rows on purpose: that is the shape that produces an
 * anchor line at all (`render.ts#buildAnchorLines`), and two of them land one under the other in a
 * single `Entries: Movement` section, which is what makes the mis-attribution observable.
 */
export const anchorProseWithBannerRuleProfile: ConfigProfile = buildFixtureProfile({
  name: 'Anchor display name containing a banner rule',
  actions: [
    action({
      name: 'Strafe --- left',
      kind: 'bind',
      commands: [{ kind: 'raw', text: '+moveleft' }],
      catalogId: 'moveleft',
      key: 'q',
      keyModifier: 'ALT',
      categoryId: 'movement',
    }),
    action({
      name: 'Strafe right',
      kind: 'bind',
      commands: [{ kind: 'raw', text: '+moveright' }],
      catalogId: 'moveright',
      key: 'x',
      keyModifier: 'ALT',
      categoryId: 'movement',
    }),
  ],
})

/**
 * A catalogue-backed continuous row with **no key at all** - the shape the Care tab's
 * `removeShadowedBind` fix leaves behind, and one a user can equally create without binding it yet.
 *
 * It gets no alias line (a continuous row mirrors as its own bare `+moveleft`, so story 034/038
 * drops it) and no bind line (no key to bind), so it leaves **no trace in the file at all** and is
 * dropped on re-import. That is the documented, accepted behaviour, not a gap: story 042 review
 * round 2 (NEW-1) gave it an entry anchor to keep its identity, and round 3 reverted that, because
 * the identity came back with `commands: []` and `catalog-binds.ts#applySlot` would then find and
 * reuse that empty entry the next time the user bound the same catalogue row - producing a key
 * pointing at an alias nothing defines. See `render.ts#buildAnchorLines` for the full argument.
 *
 * Kept as a fixture because that "no trace" is exactly what `round-trip.test.ts` asserts, and
 * because the fixed point has to hold across the loss too.
 */
export const keylessCatalogueProfile: ConfigProfile = buildFixtureProfile({
  name: 'Keyless catalogue entry',
  actions: [
    action({
      name: 'Strafe left',
      kind: 'bind',
      commands: [{ kind: 'raw', text: '+moveleft' }],
      catalogId: 'moveleft',
      categoryId: 'movement',
    }),
  ],
})

/** A `+x`/`-x` press/release pair, plus an empty-body `keepEmptyAlias` alias
 * (`alias hook_settings ""`) side by side in one profile. */
export const pressReleaseAndEmptyAliasProfile: ConfigProfile = buildFixtureProfile({
  name: 'Press/release pair and empty alias',
  actions: [
    action({
      name: 'Slow walk',
      kind: 'alias',
      commands: [{ kind: 'raw', text: '+speed' }, { kind: 'raw', text: 'cl_run 0' }],
      aliasName: '+slow',
      key: 'CAPSLOCK',
      categoryId: 'movement',
    }),
    action({
      name: 'Slow walk (release)',
      kind: 'alias',
      commands: [{ kind: 'raw', text: '-speed' }, { kind: 'raw', text: 'cl_run 1' }],
      aliasName: '-slow',
      categoryId: 'movement',
    }),
    action({
      name: 'hook_settings',
      kind: 'alias',
      commands: [],
      keepEmptyAlias: true,
      categoryId: 'movement',
    }),
  ],
})

/** A catalogue-backed continuous command (`+forward`, mirrored to its own command text, story 034)
 * next to a user-created free-form entry with no `catalogId` at all. */
// Order matters here in a way that is worth spelling out (see this D's report): "Forward" is a
// catalogue-backed continuous command, so `actionsWithAliasLine` drops its alias line entirely
// (story 034/038 - it mirrors as its own `+forward`, never through an alias), while "My macro" keeps
// one. `groupByEntryRef` (D4) discovers every entry that HAS an alias line before it discovers any
// entry that only has a bind line - a scan-order choice, not a document-order one - so an
// alias-less entry's position relative to an aliased one is NOT guaranteed to survive a round trip.
// Listing the aliased entry ("My macro") first sidesteps that reordering for this fixture (whose own
// purpose is entry-*kind* coverage, not array-order fidelity); the reordering itself is real and
// reported separately.
export const catalogueAndUserEntryProfile: ConfigProfile = buildFixtureProfile({
  name: 'Catalogue-backed and user-created entries',
  actions: [
    action({
      name: 'My macro',
      kind: 'bind',
      commands: [{ kind: 'raw', text: 'say hi' }, { kind: 'raw', text: 'wait' }],
      key: 'g',
      categoryId: 'movement',
    }),
    action({
      name: 'Forward',
      kind: 'bind',
      commands: [{ kind: 'raw', text: '+forward' }],
      catalogId: 'forward',
      key: 'w',
      categoryId: 'movement',
    }),
  ],
})

/** A custom category whose name itself contains a forged `[q2l cat=movement]` tag - the writer's
 * `neutralizeProse` must keep this inert prose, never a second real tag. */
export const forgedCategoryNameProfile: ConfigProfile = buildFixtureProfile({
  name: 'Forged category name',
  categories: [{ id: 'forged-cat', name: 'Sneaky [q2l cat=movement] category' }],
  actions: [
    action({
      name: 'Jump',
      kind: 'bind',
      commands: [{ kind: 'raw', text: '+moveup' }],
      catalogId: 'moveup',
      key: 'SPACE',
      categoryId: 'forged-cat',
    }),
  ],
})

/** A custom category name carrying latin-1 high-bit characters (`é`, `ö`, `ß`, `ñ`) - every
 * character here is within the latin1 range (<= 0xFF), the one the writer's whole round trip
 * promises to survive. */
export const latin1CategoryNameProfile: ConfigProfile = buildFixtureProfile({
  name: 'Latin-1 category name',
  categories: [{ id: 'latin1-cat', name: 'Bewegung: Vorwärts, Rückwärts, Größe, Café' }],
  actions: [
    action({
      name: 'Back',
      kind: 'bind',
      commands: [{ kind: 'raw', text: '+back' }],
      catalogId: 'back',
      key: 's',
      categoryId: 'latin1-cat',
    }),
  ],
})

/** A display name containing both `//` (which would otherwise look like it opens a second
 * comment) and `]` (which would otherwise look like it closes a tag). */
export const sneakyDisplayNameProfile: ConfigProfile = buildFixtureProfile({
  name: 'Sneaky display name',
  actions: [
    action({
      name: 'Say // hello ] world',
      kind: 'bind',
      commands: [{ kind: 'raw', text: 'say hello' }],
      key: 'y',
      categoryId: 'movement',
    }),
  ],
})

/**
 * Two entries whose `e` hash prefixes are forced to collide: `render.ts#buildEntryRefs` extends a
 * later-sorted id by one more FNV-1a round whenever the plain 8-hex ref is already taken. Two ids
 * chosen so the base story 042 collision path is exercised directly - the ids below are literal,
 * pinned strings (not random) chosen because their plain FNV-1a-32 refs are equal; see
 * `round-trip.test.ts` for the assertion that this fixture really does collide (if it did not,
 * `buildEntryRefs` would still be correct, just untested for this path - the test itself checks the
 * two rendered `e=` values differ in length).
 */
export const collidingEntryRefsProfile: ConfigProfile = (() => {
  // Found by brute-force search over random UUIDs (see this D's report): these two ids really do
  // share one FNV-1a-32 hash (`fnv1a32('e17589a8-df2e-4ad4-81cb-7ebed4895ffa') ===
  // fnv1a32('027b4af5-d95e-4c04-9382-35e4039568cd')`), so `buildEntryRefs`'s tie-break
  // (`entryRefHex`, second round) is genuinely exercised rather than merely plausible.
  const idA = 'e17589a8-df2e-4ad4-81cb-7ebed4895ffa'
  const idB = '027b4af5-d95e-4c04-9382-35e4039568cd'
  return buildFixtureProfile({
    name: 'Colliding entry refs',
    actions: [
      { id: idA, categoryId: 'movement', name: 'Collider A', kind: 'bind', commands: [{ kind: 'raw', text: 'say a' }], key: 'j' },
      { id: idB, categoryId: 'movement', name: 'Collider B', kind: 'bind', commands: [{ kind: 'raw', text: 'say b' }], key: 'k' },
    ],
  })
})()

/** A hold layer (`+x`/`-x` dispatch), triggered by ALT. */
export const holdLayerProfile: ConfigProfile = buildFixtureProfile({
  name: 'Hold layer',
  actions: [
    action({
      name: 'Drop rockets',
      kind: 'bind',
      commands: [{ kind: 'raw', text: 'drop rockets' }],
      key: '1',
      categoryId: 'drops',
    }),
  ],
  layers: [
    {
      id: nextId('layer')(),
      name: 'Drops',
      mode: 'hold',
      triggerKey: 'ALT',
      overrides: { '1': 'drop rockets' },
    },
  ],
})

/** A toggle layer (`x_on`/`x_off` dispatch) with `triggerKey: null` - not yet reachable from the
 * keyboard, and therefore rendered with its aliases but no `bind` line at all. */
export const toggleLayerNoTriggerProfile: ConfigProfile = buildFixtureProfile({
  name: 'Toggle layer, no trigger',
  actions: [
    action({
      name: 'Zoom target',
      kind: 'bind',
      commands: [{ kind: 'raw', text: 'zoom_in' }],
      key: '2',
      categoryId: 'weapons',
    }),
  ],
  layers: [
    {
      id: nextId('layer')(),
      name: 'Zoom',
      mode: 'toggle',
      triggerKey: null,
      overrides: { '2': 'zoom_in' },
    },
  ],
})

/**
 * A real two-slot, two-modifier entry combined with a hold layer override, so the layer's own
 * modifier slot (ALT) and the entry's *other* slot (a plain, unmodified key) both exist at once -
 * exercising D2/D4's "layer overrides have no per-line tag, attribution is positional" path for an
 * entry that is not purely a modifier-only row.
 */
export const layeredTwoSlotEntryProfile: ConfigProfile = buildFixtureProfile({
  name: 'Two-slot entry with a layer override',
  actions: [
    action({
      name: 'Use item',
      kind: 'bind',
      commands: [{ kind: 'raw', text: 'invuse' }],
      key: 'i',
      secondaryKey: 'u',
      secondaryKeyModifier: 'ALT',
      categoryId: 'weapons',
    }),
  ],
})

/** An unowned, hand-typed bind: a key/command pair in `profile.binds` with no owning action at
 * all - the "Other binds" section. */
export const unownedBindProfile: ConfigProfile = (() => {
  const profile = buildFixtureProfile({
    name: 'Unowned hand-typed bind',
    actions: [],
  })
  return { ...profile, binds: { ...profile.binds, F9: 'quicksave' } }
})()

/**
 * An entry whose `categoryId` matches neither a built-in category nor any of `profile.categories`
 * - the "Other" bucket a deleted custom category leaves behind (`render.ts`'s own `categoryTag`
 * doc comment). One fixture per `sectionHeaderStyle`, because this is exactly the case story-042-
 * review round 5 found uncovered: `plain` style's "Other" banner (`// Aliases: Other`) carries no
 * decoration at all, so nothing before this fixture ever drove that banner through `BANNER_RULE`'s
 * detection at all, and `dashes`/`brackets` need their own coverage too - an earlier version of the
 * fix minted a real, persisted "Other" category for this entry, which is itself a category the
 * original profile never had and stopped matching nothing on the very next render (an AC2
 * regression a `latin1CategoryNameProfile`-shaped fixture would never have caught, since every
 * other fixture's categories are either built-in or genuinely present in `profile.categories`).
 */
export const orphanedCategoryProfiles: ConfigProfile[] = (
  ['dashes', 'brackets', 'plain'] as const
).map((style) =>
  buildFixtureProfile({
    name: `Orphaned category (${style})`,
    sectionHeaderStyle: style,
    // A real, present category too, so the fixture also pins that the "Other" bucket and a real
    // category section can coexist without one corrupting the other's boundary.
    categories: [{ id: 'kept-cat', name: 'Kept Category' }],
    actions: [
      action({
        name: 'Still here',
        kind: 'alias',
        commands: [{ kind: 'raw', text: '+forward' }],
        key: 'w',
        categoryId: 'kept-cat',
      }),
      action({
        name: 'Orphaned entry',
        kind: 'alias',
        commands: [{ kind: 'raw', text: 'say orphaned' }],
        key: 'o',
        categoryId: 'a-category-that-was-deleted',
      }),
    ],
  }),
)

/** One fixture per `sectionHeaderStyle` value, otherwise identical, so the round-trip loop covers
 * all three decorations. */
export const sectionHeaderStyleProfiles: ConfigProfile[] = (
  ['dashes', 'brackets', 'plain'] as const
).map((style) =>
  buildFixtureProfile({
    name: `Section header style: ${style}`,
    sectionHeaderStyle: style,
    actions: [
      action({
        name: 'Attack',
        kind: 'bind',
        commands: [{ kind: 'raw', text: '+attack' }],
        catalogId: 'attack',
        key: 'MOUSE1',
        categoryId: 'weapons',
      }),
    ],
  }),
)

/** Every fixture the D9 round-trip property test iterates over. */
export const ROUND_TRIP_FIXTURES: ConfigProfile[] = [
  selfMirroringAliasProfile,
  modifierOnlyCatalogueProfile,
  twoSlotTwoModifierProfile,
  twoSlotTwoModifierLayersReversedProfile,
  ownAliasBothSlotsModifiedProfile,
  ownAliasBothSlotsModifiedAlphabeticalProfile,
  ownAliasBothSlotsModifiedLayersReversedProfile,
  ownAliasAnchoredProfile,
  anchorProseWithBannerRuleProfile,
  keylessCatalogueProfile,
  pressReleaseAndEmptyAliasProfile,
  catalogueAndUserEntryProfile,
  forgedCategoryNameProfile,
  latin1CategoryNameProfile,
  sneakyDisplayNameProfile,
  collidingEntryRefsProfile,
  holdLayerProfile,
  toggleLayerNoTriggerProfile,
  layeredTwoSlotEntryProfile,
  unownedBindProfile,
  ...sectionHeaderStyleProfiles,
  ...orphanedCategoryProfiles,
]
