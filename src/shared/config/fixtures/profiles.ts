/**
 * Constructed `ConfigProfile` fixtures for the story 042 D9 round-trip property test
 * (`src/main/modules/config/round-trip.test.ts`) and its adversarial-mangling pass.
 *
 * Story 050 D8 re-verified that property against the reduced `[q2l …]` tag and the uncapped
 * key-slot model: every fixture's keys moved from the four `key`/`secondaryKey`/`keyModifier`/
 * `secondaryKeyModifier` fields onto `keys: ActionKeySlot[]` (same content, one field), and the
 * corpus gained the shapes only the new model can express - see the story-050 block further down.
 * A note on why the field rename mattered more than it looks: while the fixtures still carried the
 * pre-050 names, every action in this file rendered with *no key slots at all*, so the whole corpus
 * produced bare header files and the fixed-point test held over near-empty text.
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
      keys: [{ key: 'MWHEELUP', modifier: 'ALT' }],
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
      keys: [{ key: 'w', modifier: 'ALT' }],
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
      keys: [{ key: 'r', modifier: 'ALT' }, { key: 't', modifier: 'CTRL' }],
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
        keys: [{ key: 'r', modifier: 'ALT' }, { key: 't', modifier: 'CTRL' }],
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
      keys: [{ key: 't', modifier: 'CTRL' }, { key: 'r', modifier: 'ALT' }],
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
      keys: [{ key: 'r', modifier: 'ALT' }, { key: 't', modifier: 'CTRL' }],
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
      keys: [{ key: 'MWHEELUP', modifier: 'ALT' }],
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
      keys: [{ key: 'q', modifier: 'ALT' }],
      categoryId: 'movement',
    }),
    action({
      name: 'Strafe right',
      kind: 'bind',
      commands: [{ kind: 'raw', text: '+moveright' }],
      catalogId: 'moveright',
      keys: [{ key: 'x', modifier: 'ALT' }],
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
      keys: [{ key: 'CAPSLOCK' }],
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
      keys: [{ key: 'g' }],
      categoryId: 'movement',
    }),
    action({
      name: 'Forward',
      kind: 'bind',
      commands: [{ kind: 'raw', text: '+forward' }],
      catalogId: 'forward',
      keys: [{ key: 'w' }],
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
      keys: [{ key: 'SPACE' }],
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
      keys: [{ key: 's' }],
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
      keys: [{ key: 'y' }],
      categoryId: 'movement',
    }),
  ],
})

/**
 * Two same-shaped entries in one category, each with one plain key and no catalogue link - so both
 * of their lines carry the bare `[q2l]` **marker tag** and nothing else, and the pair only stays two
 * entries because their bind *values* differ (`groupEntryLines`' key space, story 050).
 *
 * This fixture used to be about something that no longer exists: two ids whose FNV-1a-32 `e` refs
 * were forced to collide, pinning `render.ts#buildEntryRefs`' tie-break. Story 050 deleted `e` and
 * the whole ref machinery with it, so the pinned ids, the collision and the "the two rendered `e=`
 * values differ in length" assertion in `round-trip.test.ts` all went with them. It is kept (under
 * its new name) rather than deleted because the shape is still worth a corpus slot: it is the
 * smallest profile in which two entries have to be told apart with no field at all to tell them
 * apart by, which is exactly what identity-from-the-config-text has to get right.
 */
export const markerTagOnlyPairProfile: ConfigProfile = buildFixtureProfile({
  name: 'Marker-tag-only entry pair',
  actions: [
    // Deliberately not a `say`/`say_team` body: `entryKindFor` reads one of those back as a
    // `kind: 'message'` entry, which would make this fixture about kind inference instead.
    action({ name: 'Pick blaster', kind: 'bind', commands: [{ kind: 'raw', text: 'use blaster' }], keys: [{ key: 'j' }] }),
    action({ name: 'Pick shotgun', kind: 'bind', commands: [{ kind: 'raw', text: 'use shotgun' }], keys: [{ key: 'k' }] }),
  ],
})

/**
 * An **aliasless** entry ordered *before* an alias-backed one inside the same category (story-050
 * review, finding 3).
 *
 * `Attack` is a continuous catalogue row, so it mirrors as its own bare `+attack` and gets no alias
 * line at all; `SSG + SG` gets one. The rendered file therefore holds a `Aliases: Weapons` section
 * with only the second entry's line in it, and a `Binds: Weapons` section whose *first* line belongs
 * to the first entry (`compareOwnedBinds` sorts by the owning action's index). Reading that back by
 * "alias lines first" put the two entries in the opposite order, and the next render swapped the two
 * bind lines - a byte difference on a file nobody had edited, which is precisely what this corpus
 * exists to catch. Nothing but the entry order distinguishes this fixture from a healthy one, which
 * is why it needs its own slot.
 */
export const aliaslessBindBeforeAliasProfile: ConfigProfile = buildFixtureProfile({
  name: 'Aliasless entry before an alias-backed one',
  actions: [
    action({
      name: 'Attack',
      kind: 'bind',
      commands: [{ kind: 'raw', text: '+attack' }],
      catalogId: 'weapon:attack',
      keys: [{ key: 'MOUSE1' }],
      categoryId: 'weapons',
    }),
    action({
      name: 'SSG + SG',
      kind: 'bind',
      commands: [
        { kind: 'raw', text: 'use super shotgun' },
        { kind: 'raw', text: 'use shotgun' },
      ],
      keys: [{ key: 'q' }],
      categoryId: 'weapons',
    }),
  ],
})

/** A hold layer (`+x`/`-x` dispatch), triggered by ALT. */
export const holdLayerProfile: ConfigProfile = buildFixtureProfile({
  name: 'Hold layer',
  actions: [
    action({
      name: 'Drop rockets',
      kind: 'bind',
      commands: [{ kind: 'raw', text: 'drop rockets' }],
      keys: [{ key: '1' }],
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
      keys: [{ key: '2' }],
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
      keys: [{ key: 'i' }, { key: 'u', modifier: 'ALT' }],
      categoryId: 'weapons',
    }),
  ],
})

// ---------------------------------------------------------------------------
// Story 050: the shapes the reduced tag and the uncapped key-slot model added.
// Slot identity is file order now, so every one of these is a statement about
// what the *text* says rather than about what a `slot=` field claimed.
// ---------------------------------------------------------------------------

/**
 * Story 050 AC3: a **hand-added third key**. Three plain slots on one catalogue-backed entry, which
 * renders as three `bind` lines all running the same value - the shape a user produces by copying an
 * entry's `bind` line in Notepad and changing the key.
 *
 * Nothing in the file says "three": the third line is a third key purely because it is the third
 * claim in file order (`buildEntry`'s appending claims), and the cap of two the model had before
 * this story is what would have turned it into a dropped key or a conflict warning. Three plain
 * slots and not "two plain plus a modified one" on purpose - a modified slot's claim comes off an
 * anchor line, which is a different code path (`layeredThirdModifiedSlotProfile` below covers that
 * one).
 */
export const handAddedThirdKeyProfile: ConfigProfile = buildFixtureProfile({
  name: 'Hand-added third key',
  actions: [
    action({
      name: 'Drop rockets',
      kind: 'bind',
      commands: [{ kind: 'raw', text: 'drop rockets' }],
      catalogId: 'drop-rockets',
      keys: [{ key: 'g' }, { key: 'h' }, { key: 'f' }],
      categoryId: 'drops',
    }),
  ],
})

/**
 * The same uncapped-slots statement with a **modified** third slot: two plain keys with `bind` lines
 * plus a third slot carrying CTRL, which has no bind line at all and comes back off its own anchor
 * line. Both claim paths (bind lines, then anchors) therefore run on one entry at once, in that
 * order, which is exactly the order `buildEntry` documents.
 */
export const layeredThirdModifiedSlotProfile: ConfigProfile = buildFixtureProfile({
  name: 'Third slot carries a modifier',
  actions: [
    action({
      name: 'Rail zoom',
      kind: 'bind',
      commands: [{ kind: 'raw', text: 'use railgun' }, { kind: 'raw', text: 'zoom_in' }],
      keys: [{ key: 'j' }, { key: 'k' }, { key: 'l', modifier: 'CTRL' }],
      categoryId: 'weapons',
    }),
  ],
})

/**
 * The story's own documented **slot swap**: a *modified* slot at index 0 next to a *plain* slot at
 * index 1.
 *
 * The plain slot has a real `bind` line; the modified one has only an anchor line, and claims are
 * taken bind-lines-first (`buildEntry`), so this entry comes back with its two slots exchanged -
 * `keys[0]` is the plain `t`, `keys[1]` the modified `r`/ALT. Accepted and documented in
 * `docs/systems/profile-file-format.md`: nothing is lost (both keys and both modifiers survive) and
 * the file re-renders byte-identically, because the writer derives the bind line and the anchor from
 * the slots' *contents*, not from their positions - so the second render is a fixed point even
 * though the intra-entry order flipped once on the way there.
 *
 * No `catalogId` deliberately: that makes the anchor's link to its entry the *prose* path of
 * `matchAnchor` rather than the `cid` shortcut, which is the path the story's accepted "rename one
 * line's prose and the two drift apart" consequence lives on (see `round-trip.test.ts`'s
 * adversarial pass).
 */
export const modifiedFirstPlainSecondProfile: ConfigProfile = buildFixtureProfile({
  name: 'Modified slot 1 next to a plain slot 2',
  actions: [
    action({
      name: 'Reload weapon',
      kind: 'bind',
      commands: [{ kind: 'raw', text: 'reload' }],
      keys: [{ key: 'r', modifier: 'ALT' }, { key: 't' }],
      categoryId: 'weapons',
    }),
  ],
})

/**
 * Story 050 AC4, in its purest form: **two `bind` lines running one command**, with no alias line
 * anywhere to pair them through.
 *
 * A catalogue-backed continuous row mirrors as its own bare `+forward` (story 034/038 drops the
 * alias line), so the file holds nothing but two `bind` lines with the same value - and they come
 * back as one entry with two keys because the *value* is the group key (`groupEntryLines`), with no
 * `e` ref and no `slot` field involved. Before story 050 those same two lines were paired by their
 * shared `e=` hash; this fixture is the proof that removing it changed nothing about the outcome.
 */
export const twoBindLinesOneValueProfile: ConfigProfile = buildFixtureProfile({
  name: 'Two bind lines on one value',
  actions: [
    action({
      name: 'Forward',
      kind: 'bind',
      commands: [{ kind: 'raw', text: '+forward' }],
      catalogId: 'forward',
      keys: [{ key: 'w' }, { key: 'UPARROW' }],
      categoryId: 'movement',
    }),
  ],
})

/**
 * An **anchor-only entry with two anchors**: an entry whose alias line is dropped as a self-mirror
 * (story 039) and *both* of whose slots are modified, so the file contains no `bind` line and no
 * `alias` line for it at all - its entire presence is two comment-only anchor lines plus the two
 * layer overrides they name.
 *
 * `ownAliasAnchoredProfile` above is the one-anchor version of this shape. The second anchor is what
 * this fixture adds, and it is a different code path: the first anchor matches no group (there is no
 * config line for this entry to have created one) and therefore *creates* the group under an
 * `anchor:<file>:<line>` key, and the second one has to find that group by prose to become its
 * second slot rather than a second Controls-tab row. Both anchors carry `an=weapnext`, which per the
 * registry decision is why `an` survived the tag cut at all: an anchor-only entry has no line whose
 * *code* could spell its alias name.
 */
export const anchorOnlyTwoSlotProfile: ConfigProfile = buildFixtureProfile({
  name: 'Anchor-only entry with two anchors',
  actions: [
    action({
      name: 'Next weapon',
      kind: 'bind',
      commands: [{ kind: 'raw', text: 'weapnext' }],
      aliasName: 'weapnext',
      keys: [{ key: 'MWHEELUP', modifier: 'ALT' }, { key: 'MWHEELDOWN', modifier: 'CTRL' }],
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
        keys: [{ key: 'w' }],
        categoryId: 'kept-cat',
      }),
      action({
        name: 'Orphaned entry',
        kind: 'alias',
        commands: [{ kind: 'raw', text: 'say orphaned' }],
        keys: [{ key: 'o' }],
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
        keys: [{ key: 'MOUSE1' }],
        categoryId: 'weapons',
      }),
    ],
  }),
)

/**
 * Two entries in **one** category whose different display names slug to the **same** derived alias
 * name (story-050 review, finding 4, second round).
 *
 * `Fire` and `fire!` both derive `fire` (`alias-render.ts#derivedAliasName` - a sign-free slug of
 * the display name with no id suffix, story 039's own decision: the name is the user's contract with
 * whatever binding calls it, so a collision is *reported*, never silently renamed), so the writer
 * emits `alias fire use blaster` and `alias fire use railgun` under one `Aliases: Combat` banner.
 * The engine keeps only the last of those two definitions and so does every reader here, which means
 * `Fire`'s commands are gone from any profile read back out of this file. Nothing downstream of the
 * fold can even tell that happened - hence the `entry-alias-duplicate` warning being raised by the
 * fold itself (`main/modules/config/file-source.ts#foldConfig`).
 *
 * **Deliberately not in `ROUND_TRIP_FIXTURES`.** This is the one shape the launcher can write that
 * is genuinely lossy, so the D8 fixed-point property (`render(parse(render(p))) === render(p)`) does
 * not and must not hold for it - a second render has only one `fire` entry left to write. It is a
 * fixture rather than an inline literal because two test files drive it: the unit pass over the fold
 * (`file-source.test.ts`) and the end-to-end pass over the real save/reload pipeline
 * (`file-source-pipeline.test.ts`).
 *
 * Both entries are `kind: 'bind'` with a plain key each, so the file carries the full shape: two
 * colliding `alias` lines *and* the two `bind fire` mirror lines that point at them.
 */
export const collidingAliasNameProfile: ConfigProfile = buildFixtureProfile({
  name: 'Colliding derived alias names',
  categories: [{ id: 'combat', name: 'Combat' }],
  actions: [
    action({
      name: 'Fire',
      kind: 'bind',
      commands: [{ kind: 'raw', text: 'use blaster' }],
      keys: [{ key: 'q' }],
      categoryId: 'combat',
    }),
    action({
      name: 'fire!',
      kind: 'bind',
      commands: [{ kind: 'raw', text: 'use railgun' }],
      keys: [{ key: 'r' }],
      categoryId: 'combat',
    }),
  ],
})

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
  markerTagOnlyPairProfile,
  aliaslessBindBeforeAliasProfile,
  handAddedThirdKeyProfile,
  layeredThirdModifiedSlotProfile,
  modifiedFirstPlainSecondProfile,
  twoBindLinesOneValueProfile,
  anchorOnlyTwoSlotProfile,
  holdLayerProfile,
  toggleLayerNoTriggerProfile,
  layeredTwoSlotEntryProfile,
  unownedBindProfile,
  ...sectionHeaderStyleProfiles,
  ...orphanedCategoryProfiles,
]
