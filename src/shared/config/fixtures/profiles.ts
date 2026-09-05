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
import { TEMPLATE_ACTION_CATEGORIES } from '@shared/modules/config'

let counter = 0
/** Deterministic id factory - fixtures need no randomness, only distinctness. */
function nextId(prefix: string): () => string {
  return () => `${prefix}-${(counter++).toString(36)}`
}

/**
 * The categories `actions` actually file entries under, in first-use order - the default for a
 * fixture that does not name its own.
 *
 * Story 052 D4: the file's category sections are `profile.categories` in that array's order, and
 * the three former built-ins are no longer prepended by the writer. A fixture whose entries sit in
 * `movement`/`weapons`/`drops` (the `action()` helper's default is `movement`) therefore has to
 * *carry* those categories to render a named section at all; without them the whole corpus would
 * write its entries into the trailing "Other" bucket and stop exercising category sections
 * altogether. Named from `TEMPLATE_ACTION_CATEGORIES` exactly as `STANDARD_TEMPLATE` seeds them
 * (`{ id, name: <english default>, nameKey }`), so a fixture profile looks like a template-seeded
 * one.
 *
 * Derived from the actions rather than fixed at "all three" on purpose: a category with no entries
 * has nothing to write, so the file cannot carry it and a re-read profile cannot get it back
 * (`file-source-pipeline.test.ts` checks exactly that nothing is lost). A fixture that passes its
 * own `categories` replaces this wholesale, and each of those files its entries under an id from its
 * own list - or, for `orphanedCategoryProfiles`, deliberately not.
 */
function categoriesForActions(actions: readonly ConfigAction[]): ConfigActionCategory[] {
  const categories: ConfigActionCategory[] = []
  for (const { categoryId } of actions) {
    if (categories.some((category) => category.id === categoryId)) continue
    const template = TEMPLATE_ACTION_CATEGORIES.find((category) => category.id === categoryId)
    categories.push(
      template
        ? { id: template.id, name: template.label, nameKey: template.labelKey }
        : { id: categoryId, name: categoryId },
    )
  }
  return categories
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
    categories: input.categories ?? categoriesForActions(input.actions),
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
 * drops it) and no bind line (no key to bind). Until story 052 that left **no trace in the file at
 * all** and the entry was dropped on re-import - the accepted answer at the time, because story 042
 * review round 2's entry anchor brought the identity back *without* its command (`commands: []`),
 * which `catalog-binds.ts#applySlot` would then reuse as the base of the next bind of that row,
 * producing a key pointing at an alias nothing defines.
 *
 * Story 052 D2/D3 gives exactly this shape a line that carries the command as well as the identity
 * (`render.ts#unboundLine`, read back by `profile-restore.ts#claimsUnboundEntry`), so the row now
 * survives the round trip whole - which is what `round-trip.test.ts` and
 * `file-source-pipeline.test.ts` assert on this fixture.
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

// ---------------------------------------------------------------------------
// Story 045: the two-part entry kinds and the `wait` command kind. These are
// the shapes whose *kind* has to survive a round trip with no `k` tag to carry
// it - `profile-restore.ts` re-derives it from the wiring of the alias bodies
// through `entry-idioms.ts`, so a fixed point here is a statement about the
// recogniser and the writer agreeing, not just about text.
// ---------------------------------------------------------------------------

/**
 * Story 045 AC1/AC6 - the story's own `zoom` shape: a `kind: 'toggle'` entry with two labelled
 * states, bound to one key. Four lines in the file (`zoom_s1`, `zoom_s2`, the `zoom` dispatch and
 * one `bind v "zoom"` mirror), which have to come back as *one* entry with two `parts`, both `lbl`
 * labels, and its key.
 *
 * The two state bodies are deliberately unequal in length and content so a half swapped for the
 * other would be visible rather than symmetric.
 */
export const toggleEntryProfile: ConfigProfile = buildFixtureProfile({
  name: 'Toggle entry with two labelled states',
  actions: [
    action({
      name: 'Zoom',
      kind: 'toggle',
      commands: [],
      keys: [{ key: 'v' }],
      categoryId: 'movement',
      parts: [
        {
          commands: [
            { kind: 'raw', text: 'fov 30' },
            { kind: 'raw', text: 'sensitivity 1.5' },
          ],
          label: 'In',
        },
        {
          commands: [{ kind: 'raw', text: 'fov 90' }],
          label: 'Out',
        },
      ],
    }),
  ],
})

/**
 * Story 045 AC3/AC6 - a `kind: 'press-release'` entry: two alias lines under `+slow`/`-slow` and
 * one `bind SHIFT "+slow"` (the `+` half verbatim, `bindValueFor`'s own rule, because the engine
 * only sends the `-` half on key-up when the bind string itself starts with `+`).
 *
 * Next to it, on purpose, an ordinary `kind: 'alias'` entry named `+zoom` with **no** `-zoom` next
 * to it: a lone `+` half is not a pair (D5's all-or-nothing rule), so it has to stay the plain
 * alias entry it is - which is what D8's `pressWithoutRelease` will report - rather than get
 * dragged into the recognised pair beside it.
 */
export const pressReleaseEntryProfile: ConfigProfile = buildFixtureProfile({
  name: 'Press/release entry next to a lone + half',
  actions: [
    action({
      name: 'Slow',
      kind: 'press-release',
      commands: [],
      keys: [{ key: 'SHIFT' }],
      categoryId: 'movement',
      parts: [
        {
          commands: [
            { kind: 'raw', text: 'cl_forwardspeed 110' },
            { kind: 'raw', text: 'cl_sidespeed 110' },
          ],
        },
        {
          commands: [
            { kind: 'raw', text: 'cl_forwardspeed 200' },
            { kind: 'raw', text: 'cl_sidespeed 200' },
          ],
        },
      ],
    }),
    action({
      name: '+zoom',
      kind: 'alias',
      commands: [{ kind: 'raw', text: 'fov 30' }],
      categoryId: 'movement',
    }),
  ],
})

/**
 * Story 045 AC5/AC6 - a `{ kind: 'wait', frames }` command *inside* an ordinary entry's body, twice
 * and with different frame counts, with raw commands on both sides of each.
 *
 * `commandLineFor` writes a wait as `frames` literal `wait` segments, and only a run of literal
 * `wait` segments collapses back (story 045's Decisions), so this fixture is what pins the two
 * halves of that as actual inverses: three-then-one has to come back as three-then-one, not as one
 * `wait(4)` and not as four raw commands.
 */
export const waitChainProfile: ConfigProfile = buildFixtureProfile({
  name: 'Wait chain inside an entry body',
  actions: [
    action({
      name: 'Rocket jump',
      kind: 'bind',
      commands: [
        { kind: 'raw', text: '+moveup' },
        { kind: 'wait', frames: 3 },
        { kind: 'raw', text: '+attack' },
        { kind: 'wait', frames: 1 },
        { kind: 'raw', text: '-attack' },
        { kind: 'raw', text: '-moveup' },
      ],
      keys: [{ key: 'x' }],
      categoryId: 'movement',
    }),
  ],
})

/**
 * Story 045's Plan step 5, "a `wait` at the chunk boundary" - the adversarial case the second
 * review round found still open (round-2 finding 3).
 *
 * `commandLineFor` expands one `{ kind: 'wait', frames }` command into `frames` literal `wait`
 * segments *inside one string*, and `renderActionAlias` chunks the list of those strings, never the
 * characters within one - so a single wait command is atomic to the chunker and cannot be split.
 * Two **adjacent** wait commands can be, and the 46 padding commands below put the split exactly
 * between them: `_p1` ends in the three `wait`s of the first, `_p2` opens with the two of the
 * second. Read back, the chunk fold rejoins the two chunk bodies into one body of five consecutive
 * literal `wait` segments, and a wait-run collapse that ran over the folded text saw one
 * `wait(5)` - which re-renders as one 28-character atomic string that no longer fits where the
 * three-`wait` one did, moving the chunk boundary and breaking AC6's fixed point on a file nobody
 * had touched.
 *
 * The commands on both sides are asserted as objects in `round-trip.test.ts`, not just as bytes:
 * the frame counts (3 then 2, never one 5) are the part the text alone cannot show.
 */
export const waitAtChunkBoundaryProfile: ConfigProfile = buildFixtureProfile({
  name: 'Wait run straddling a chunk boundary',
  actions: [
    action({
      name: 'Boundary hop',
      kind: 'bind',
      aliasName: 'boundary',
      commands: [
        ...budgetEatingCommands(46),
        { kind: 'wait', frames: 3 },
        { kind: 'wait', frames: 2 },
        { kind: 'raw', text: 'fov 90' },
      ],
      keys: [{ key: 'x' }],
      categoryId: 'movement',
    }),
  ],
})

/**
 * The adversarial one (the sprint's carry-over rule, and story 045's Plan step 5): a toggle whose
 * **first state is long enough to be chunk-split**, so the file reads
 *
 * ```
 * alias long_zoom_s1_p1 "…"
 * alias long_zoom_s1_p2 "…; alias long_zoom long_zoom_s2"
 * alias long_zoom_s1    "long_zoom_s1_p1; long_zoom_s1_p2"
 * ```
 *
 * and the `alias <dispatch> <other state>` rewrite that identifies a toggle state at all sits
 * inside the **last chunk**, not in the state's own body. `entry-idioms.ts` deliberately does not
 * see through that (its "`_p<n>` chunks are the caller's problem" section), so this fixture is the
 * one that fails if `profile-restore.ts` hands the recogniser unfolded bodies: the trio would fall
 * back to three plain alias entries and the next render would write the family a second time, in a
 * different shape.
 *
 * A `wait` sits mid-body too, so the wait collapse and the chunk fold are exercised on the same
 * line family rather than in two separate fixtures.
 */
const LONG_STATE_COMMANDS: ConfigAction['commands'] = [
  { kind: 'raw', text: '+moveup' },
  { kind: 'wait', frames: 2 },
  // `message`, not `raw` with a `say_team ` prefix: `configCommandFor` classifies such a segment as
  // a message on the way back (`entryKindFor`'s own table, story 041), so a raw spelling would
  // round-trip byte-identically but not object-identically - and it is the object comparison that
  // proves the chunk fold reassembled the state in the right order.
  ...Array.from({ length: 6 }, (_, index) => ({
    kind: 'message' as const,
    channel: 'say_team' as const,
    text: `going in ${index} ${'a'.repeat(200)}`,
  })),
]

export const chunkedToggleStateProfile: ConfigProfile = buildFixtureProfile({
  name: 'Toggle whose first state is chunk-split',
  actions: [
    action({
      name: 'Long zoom',
      kind: 'toggle',
      commands: [],
      keys: [{ key: 'b' }],
      categoryId: 'movement',
      parts: [
        { commands: LONG_STATE_COMMANDS, label: 'On' },
        { commands: [{ kind: 'raw', text: 'fov 90' }], label: 'Off' },
      ],
    }),
  ],
})

/**
 * The second adversarial one, and the case that found a real defect while D7 was being built: a
 * toggle whose **only** key slot carries a modifier.
 *
 * A modifier binding is not a bind line anywhere - it lives as an override inside the ALT layer
 * (story 016) - so the entry's key comes back off the comment-only **anchor line** the writer emits
 * for it. `matchAnchor` pairs an anchor with an entry by exact display prose and demands exactly
 * one candidate; a toggle's three alias lines all carry the entry's one prose, so all three groups
 * matched, none was chosen, and the key came back as a separate commandless entry beside the
 * toggle. `groupEntryLines` therefore recognises the two-part idioms *before* it scans anchors and
 * takes the two half groups out of the candidate set - this fixture is what pins that ordering.
 */
export const modifiedSlotToggleProfile: ConfigProfile = buildFixtureProfile({
  name: 'Toggle whose only slot carries a modifier',
  layers: [],
  actions: [
    action({
      name: 'Zoom',
      kind: 'toggle',
      commands: [],
      keys: [{ key: 'v', modifier: 'ALT' }],
      categoryId: 'movement',
      parts: [
        { commands: [{ kind: 'raw', text: 'fov 30' }], label: 'In' },
        { commands: [{ kind: 'raw', text: 'fov 90' }], label: 'Out' },
      ],
    }),
  ],
})

/**
 * Story-045 review, finding 1: **a two-part entry whose two halves are cut differently.**
 *
 * `attachTaggedComment` fits `<code>  // <prose> <tag>` into one line budget and cuts the *prose*
 * when the three do not fit - and how much room is left over is decided by that line's own code. A
 * two-part entry has two (or three) lines of very different code lengths under one display name, so
 * a long half carries a truncated name while the short half beside it carries the whole one. Both
 * merge gates in `profile-restore.ts` used to demand the two proses be *equal*, so exactly this
 * entry came back as two or three plain alias entries: kind, `parts` and labels gone, and the next
 * render different from the last - AC6's fixed point, lost on a file nobody touched.
 *
 * The name below is deliberately long, and the body deliberately sized just under the chunk
 * threshold (`alias-render.ts#lineFits`), so the *whole* body stays on one line and that one line is
 * what eats the prose. `round-trip.test.ts` asserts the two spellings really do differ, so the
 * fixture cannot quietly stop exercising the case.
 */
const LONG_DISPLAY_NAME = 'Slow motion walk with a deliberately long display name'

/**
 * `count` same-width (21-character) `set` commands - enough of them to eat the prose budget on the
 * line they render on, few enough that `chunkHalf` still keeps them on one line.
 *
 * The two counts differ because the two shapes spend their line differently: a toggle state's body
 * also carries the trailing `alias <dispatch> <other state>` rewrite, and its `lbl` tag is longer
 * than a press half's bare `[q2l]`.
 */
function budgetEatingCommands(count: number): ConfigAction['commands'] {
  return Array.from({ length: count }, (_, index) => ({
    kind: 'raw' as const,
    text: `seta q2l_pad_${index.toString().padStart(2, '0')} 100`,
  }))
}

export const budgetCutPressReleaseProfile: ConfigProfile = buildFixtureProfile({
  name: 'Press/release entry whose press half outgrows its own display name',
  actions: [
    action({
      name: LONG_DISPLAY_NAME,
      kind: 'press-release',
      aliasName: 'slowmotion',
      commands: [],
      keys: [{ key: 'SHIFT' }],
      categoryId: 'movement',
      parts: [
        { commands: budgetEatingCommands(46) },
        { commands: [{ kind: 'raw', text: 'cl_forwardspeed 200' }] },
      ],
    }),
  ],
})

/**
 * The same defect on the toggle side, and the harder half of it: here the truncated line is a
 * *state*, while the dispatch and the other state keep the whole name. The trailing
 * `alias <dispatch> <other state>` rewrite is part of the long body, so this also pins that the
 * budget maths and the recogniser agree about where the state's own body ends.
 */
export const budgetCutToggleProfile: ConfigProfile = buildFixtureProfile({
  name: 'Toggle whose first state outgrows its own display name',
  actions: [
    action({
      name: LONG_DISPLAY_NAME,
      kind: 'toggle',
      aliasName: 'padzoom',
      commands: [],
      keys: [{ key: 'n' }],
      categoryId: 'movement',
      parts: [
        { commands: budgetEatingCommands(45), label: 'In' },
        { commands: [{ kind: 'raw', text: 'fov 90' }], label: 'Out' },
      ],
    }),
  ],
})

/**
 * Story-045 review round 2, finding 4: **a plain entry whose own alias line eats its display name
 * while its bind line keeps it whole.**
 *
 * The same budget arithmetic as the two fixtures above, on the shape that has nothing to do with the
 * two new kinds - one ordinary bound entry, one alias line, one bind line. `render.ts` writes the
 * entry's display name on both, and only the alias line pays for a 950-byte body first, so the
 * *alias* line carries a cut name and the *bind* line carries the whole one. Reading the entry's
 * name off its first alias line (which is what `entryProse` did) therefore restored the cut spelling
 * and the next render wrote that shortened name onto the bind line too: a file that differs from the
 * one on disk with nobody having touched it.
 */
export const budgetCutSingleBodyProfile: ConfigProfile = buildFixtureProfile({
  name: 'Entry whose alias line outgrows its own display name',
  actions: [
    action({
      name: LONG_DISPLAY_NAME,
      kind: 'bind',
      aliasName: 'padwalk',
      commands: budgetEatingCommands(45),
      keys: [{ key: 'n' }],
      categoryId: 'movement',
    }),
  ],
})

/**
 * Story-045 review round 2, finding 2: **three real, distinct entries whose names are prefixes of
 * each other, wired like a toggle trio.**
 *
 * `slow` calls `slow_a`, `slow_a` hands the dispatch to `slow_b` and `slow_b` hands it back - the
 * toggle idiom exactly, so `entry-idioms.ts` recognises it and only the *prose* gate in
 * `profile-restore.ts` decides whether these three lines are one entry or three. They are three, and
 * the file says so: each carries its own, whole, never-cut display name.
 *
 * What makes it adversarial is that the three names are prefixes of each other and the two state
 * lines are deliberately sized so that the longest of the three (`Slow motion walk`, 16 characters)
 * would *not* have fitted on them - 15 characters of room, one short. A merge gate that accepts "a
 * prefix, on a line the long name could not have fitted on" (the first review round's rule) collapses
 * all three into one toggle named `Slow motion walk` and loses two display names with no warning at
 * all. The exact rule reproduces the cut the writer would have made (`Slow motion wal`), sees that
 * neither line carries it, and keeps the three entries apart.
 *
 * The one padding command with the wider value is what buys that last character: 45 same-width
 * commands leave exactly 16 characters of room, which the whole name fits into, and a line the name
 * fits on is not a counter-example to anything.
 */
const PREFIX_NAME_STATE_COMMANDS = (target: string): ConfigAction['commands'] => [
  ...budgetEatingCommands(45),
  { kind: 'raw', text: 'seta q2l_pad_ff 1000' },
  { kind: 'raw', text: `alias slow ${target}` },
]

export const prefixNamedTrioProfile: ConfigProfile = buildFixtureProfile({
  name: 'Three prefix-named entries wired like a toggle',
  actions: [
    action({
      name: 'Slow motion walk',
      kind: 'alias',
      aliasName: 'slow',
      commands: [{ kind: 'raw', text: 'slow_a' }],
      categoryId: 'movement',
    }),
    action({
      name: 'Slow',
      kind: 'alias',
      aliasName: 'slow_a',
      commands: PREFIX_NAME_STATE_COMMANDS('slow_b'),
      categoryId: 'movement',
    }),
    action({
      name: 'Slow mo',
      kind: 'alias',
      aliasName: 'slow_b',
      commands: PREFIX_NAME_STATE_COMMANDS('slow_a'),
      categoryId: 'movement',
    }),
  ],
})

// ---------------------------------------------------------------------------
// Story 052 D5: the adversarial pass over the shapes this story invents.
//
// D2 gave an entry that would otherwise leave no trace a commented-out `bind`
// line, D3 reads it back, and D4 made every category ordinary, profile-owned
// data whose array order *is* the file's section order. Both changes put
// user-typed prose in places that the reader has to tell from its own
// structural markers - a comment-only line that is really a code line, and a
// section banner whose title is now whatever the user called the category. The
// seven fixtures below are the hostile inputs for exactly those two seams; each
// is driven through the real render -> parse -> restore -> render pipeline in
// `round-trip.test.ts`, and each is in `ROUND_TRIP_FIXTURES` (bar the one noted
// below), so it is also held to the whole-pipeline "nothing is lost" property
// in `file-source-pipeline.test.ts` and to the writer-side tag invariants in
// `render-invariants.test.ts`.
// ---------------------------------------------------------------------------

/**
 * **Unbound entries with no commands at all**, one on either side of an unbound entry that does
 * carry one - the `//bind ""` shape `render.ts#unboundCommand` writes for `STANDARD_TEMPLATE`'s
 * seeded-but-unbound rows (story 052 D1), which is most of a template profile's file.
 *
 * `keylessCatalogueProfile` above covers the single, command-carrying unbound line. What this adds
 * is the empty body *and* the neighbourhood: three unbound lines in one `Entries: Movement` section,
 * two of them byte-identical in their code half (`//bind ""`), so the only thing telling them apart
 * is their own display prose and their position. `groupEntryLines` keys an unbound line's group on
 * `unbound:<file>:<line>` precisely so those two cannot fold into one entry - the shape a
 * value-keyed grouping (what every *bind* line uses) would merge on sight.
 */
export const unboundNoCommandsProfile: ConfigProfile = buildFixtureProfile({
  name: 'Unbound entries with no commands',
  actions: [
    action({ name: 'Crouch', kind: 'bind', commands: [], categoryId: 'movement' }),
    action({
      name: 'Strafe left',
      kind: 'bind',
      commands: [{ kind: 'raw', text: '+moveleft' }],
      catalogId: 'moveleft',
      categoryId: 'movement',
    }),
    action({ name: 'Sprint', kind: 'bind', commands: [], categoryId: 'movement' }),
  ],
})

/**
 * **Display names and a category name that read like this writer's own section banners.**
 *
 * `render.ts` opens every category section with one of exactly three literal prefixes
 * (`Aliases: `, `Binds: `, `Entries: ` - `profile-restore.ts#TITLE_PREFIXES`), and story-042-review
 * round 5/6 made the reader treat *both* that prefix and the reserved `Other`/`Other binds` bucket
 * titles as section signals in their own right, on top of `BANNER_RULE`'s decoration test. Every one
 * of those signals is now aimed at user-typed prose:
 *
 * - the category is literally named `Binds: Movement`, so its own alias section reads
 *   `// --- Aliases: Binds: Movement [q2l cat=…] ---` - one prefix must come off on read-back, not
 *   two, or the category comes back renamed and the file stops being a fixed point;
 * - the first entry is an *unbound* line (D2/D3) whose display name is `Binds: Other` - a reserved
 *   bucket title behind a reserved prefix, on a comment-only line. Only `claimsUnboundEntry`
 *   stands between that and `scanComments` reading it as an `Other`-bucket section boundary that
 *   re-files every entry below it;
 * - the second is an *anchor* line (its one slot is modified, so it has no bind line) named
 *   `Entries: Movement --- extra`, which carries a banner rule as well as a reserved prefix -
 *   `claimsEntryAnchor`'s own case, restated for the prefix signal that did not exist when that
 *   defect was found;
 * - the third is an ordinary bound entry named `Aliases: Weapons`, whose prose therefore rides on a
 *   real `alias`/`bind` code line rather than on a comment-only one.
 *
 * A second category with an entry of its own follows, so a fabricated section boundary inside the
 * first one would show up as a *re-filed* entry rather than only as a stray extra category.
 */
export const bannerLookalikeNameProfile: ConfigProfile = buildFixtureProfile({
  name: 'Names that look like section banners',
  categories: [
    { id: 'cat-banner', name: 'Binds: Movement' },
    { id: 'cat-after', name: 'After' },
  ],
  actions: [
    action({ name: 'Binds: Other', kind: 'bind', commands: [], categoryId: 'cat-banner' }),
    action({
      name: 'Entries: Movement --- extra',
      kind: 'bind',
      commands: [{ kind: 'raw', text: 'reload' }],
      keys: [{ key: 'r', modifier: 'ALT' }],
      categoryId: 'cat-banner',
    }),
    action({
      name: 'Aliases: Weapons',
      kind: 'bind',
      commands: [{ kind: 'raw', text: 'use blaster' }],
      keys: [{ key: 'z' }],
      categoryId: 'cat-banner',
    }),
    // `invuse`, not the `wave 1` such a fixture reads most naturally with: an entry named `Wave`
    // derives the alias name `wave`, and a body whose head token is the alias' own name is a real
    // `aliasCycle` (`alias-references.ts#selfReferencingSegments`) that `validate-structure.test.ts`
    // rightly reports over this whole corpus. That is a different subject from this fixture's.
    action({
      name: 'Wave',
      kind: 'bind',
      commands: [{ kind: 'raw', text: 'invuse' }],
      keys: [{ key: 'g' }],
      categoryId: 'cat-after',
    }),
  ],
})

/**
 * **Two categories with the same display name and different ids.**
 *
 * The file records a category by `cat=<id>` in the section banner and its *name* as the banner
 * title, so two same-named categories produce two sections that differ in nothing a reader can see
 * except that tag. `categoryRegistry` keys its mint on `cat:<id>`, never on the title, which is what
 * keeps these two drawers apart on read-back; a name-keyed registry would fold both sections into
 * one category and quietly move the second entry into the first one's drawer.
 */
export const duplicateCategoryNamesProfile: ConfigProfile = buildFixtureProfile({
  name: 'Duplicate category names',
  categories: [
    { id: 'cat-combat-a', name: 'Combat' },
    { id: 'cat-combat-b', name: 'Combat' },
  ],
  actions: [
    action({
      name: 'Fire blaster',
      kind: 'bind',
      commands: [{ kind: 'raw', text: 'use blaster' }],
      keys: [{ key: '1' }],
      categoryId: 'cat-combat-a',
    }),
    action({
      name: 'Fire shotgun',
      kind: 'bind',
      commands: [{ kind: 'raw', text: 'use shotgun' }],
      keys: [{ key: '2' }],
      categoryId: 'cat-combat-b',
    }),
  ],
})

/**
 * **A real, persisted category literally named `Other`, next to the trailing "other" bucket it
 * collides with by name.**
 *
 * `render.ts#OTHER_CATEGORY_LABEL` is the title the writer gives its trailing bucket - the entries
 * whose `categoryId` matches nothing the profile carries - and `profile-restore.ts` recognises that
 * reserved title by *string* (`OTHER_BUCKET_TITLES`) so that a `plain`-style banner, which carries no
 * decoration for `BANNER_RULE` to match, is still seen as a section boundary. This profile makes the
 * file carry both at once: a genuine `Aliases: Other` section with a `cat=` tag, and a second,
 * untagged `Aliases: Other` for the orphaned entry.
 *
 * The two must not converge in either direction. If the tagged one were read as the reserved bucket,
 * a real user category would silently disappear and its entry would land in a drawer the rail does
 * not show; if the untagged one were minted into a real category named `Other`, the profile would
 * gain a category it never had and the orphan would stop matching nothing on the very next render -
 * the AC2 regression story-042-review round 5 found and `categoryRegistry`'s `'other'` case exists
 * to prevent, now with a real `Other` in the same file to confuse it with.
 *
 * `sectionHeaderStyle: 'plain'` deliberately: that is the style where the untagged banner has
 * nothing but its title to be recognised by, so it is the style where the two are hardest to tell
 * apart.
 */
export const literalOtherCategoryProfile: ConfigProfile = buildFixtureProfile({
  name: 'A real category named Other',
  sectionHeaderStyle: 'plain',
  categories: [
    { id: 'cat-other', name: 'Other' },
    { id: 'cat-kept', name: 'Kept' },
  ],
  actions: [
    // `invuse`/`invnext` rather than `wave 1`/`wave 2` - see the note on the same choice in
    // `bannerLookalikeNameProfile` above.
    action({
      name: 'Wave',
      kind: 'bind',
      commands: [{ kind: 'raw', text: 'invuse' }],
      keys: [{ key: 'g' }],
      categoryId: 'cat-other',
    }),
    action({
      name: 'Salute',
      kind: 'bind',
      commands: [{ kind: 'raw', text: 'invnext' }],
      keys: [{ key: 'h' }],
      categoryId: 'cat-kept',
    }),
    // Deliberately not a `say`/`say_team` body, unlike `orphanedCategoryProfiles` above:
    // `entryKindFor` reads one of those back as a `kind: 'message'` entry with a `message` command
    // (story 041), which is correct and intended but would make this fixture's object comparison
    // about kind inference instead of about the two "Other" sections.
    action({
      name: 'Orphaned',
      kind: 'bind',
      commands: [{ kind: 'raw', text: 'use railgun' }],
      keys: [{ key: 'j' }],
      categoryId: 'a-category-that-was-deleted',
    }),
  ],
})

/**
 * **Five categories in a deliberately scrambled order** - not alphabetical, not id order, not
 * template order, with the three former built-ins interleaved among two custom ones and one of them
 * renamed away from its template default.
 *
 * D4's own case (`round-trip.test.ts`, "category sections follow the profile, not a built-in list")
 * uses three; this one is wide enough that any of the plausible wrong orders - template first,
 * alphabetical, first-encountered-entry - produces a visibly different file, and it carries the two
 * shapes that reach the reader through different paths at once: a template id (minted with its id
 * kept, `nameKey` re-attached only where the name is still the English default) and a locally minted
 * one. The restored `categories` array's order is what the *next* render's section order comes from,
 * so a reader that rebuilt the list in discovery order rather than in file order would pass a
 * single-render check and fail the fixed point.
 *
 * The defect it was written for is closed. `profile-restore.ts` used to return the restored
 * `categories` in **mint** order - a category is minted the first time an *entry* asks for it, so the
 * array came back in entry-discovery order (every alias-line entry, then every bind-line-only one,
 * then anchors and unbound lines) rather than in the file's own section order, and since D4 made
 * `render.ts#orderedCategoryIds` follow `profile.categories`, the next render moved sections nobody
 * had touched. `orderByFileSections` orders by the file's sections now, so this fixture is in
 * `ROUND_TRIP_FIXTURES` like every other: the generic fixed-point loop and
 * `file-source-pipeline.test.ts`'s "nothing is lost" loop both cover it, and the dedicated case in
 * `round-trip.test.ts` additionally pins the *names* in order, which byte-equality alone would not.
 *
 * `blockDisjointCategoryOrderProfile` below is the other half of the same subject: this one's five
 * categories all have a `Binds:` section, so the file states their order outright, and it therefore
 * cannot reach the case where two categories share no section block at all.
 */
export const scrambledCategoryOrderProfile: ConfigProfile = buildFixtureProfile({
  name: 'Scrambled category order',
  categories: [
    { id: 'drops', name: 'Weapon dropping', nameKey: 'config.controls.categories.drops' },
    { id: 'cat-zulu', name: 'Zulu' },
    { id: 'movement', name: 'Bewegung' },
    { id: 'cat-alpha', name: 'Alpha' },
    { id: 'weapons', name: 'Weapons', nameKey: 'config.controls.categories.weapons' },
  ],
  actions: [
    action({
      name: 'Drop rockets',
      kind: 'bind',
      commands: [{ kind: 'raw', text: 'drop rockets' }],
      keys: [{ key: '1' }],
      categoryId: 'drops',
    }),
    action({
      name: 'Zulu entry',
      // Not a `say`/`say_team` body: `entryKindFor` reads one back as a `kind: 'message'` entry
      // (story 041), which is correct and would make this fixture about kind inference.
      kind: 'bind',
      commands: [{ kind: 'raw', text: 'invnext' }],
      keys: [{ key: '2' }],
      categoryId: 'cat-zulu',
    }),
    action({
      name: 'Forward',
      kind: 'bind',
      commands: [{ kind: 'raw', text: '+forward' }],
      catalogId: 'forward',
      keys: [{ key: 'w' }],
      categoryId: 'movement',
    }),
    action({
      name: 'Alpha entry',
      kind: 'bind',
      commands: [{ kind: 'raw', text: 'invprev' }],
      keys: [{ key: '3' }],
      categoryId: 'cat-alpha',
    }),
    action({
      name: 'Attack',
      kind: 'bind',
      commands: [{ kind: 'raw', text: '+attack' }],
      catalogId: 'attack',
      keys: [{ key: 'MOUSE1' }],
      categoryId: 'weapons',
    }),
  ],
})

/**
 * **Two categories that share no section block**, in an order the file's section layout alone
 * contradicts (story 052, review finding F3).
 *
 * `Alpha` comes first in the profile and its entries are *all* unbound, so its only section is an
 * `Entries: Alpha` one (block 6b). `Bravo` comes second and its one entry is a catalogue-backed
 * continuous row bound to a key, which emits no alias line at all (story 038) - so its only section
 * is a `Binds: Bravo` one (block 5), which the writer emits *before* every `Entries:` section.
 *
 * That is the one shape `orderByFileSections`' merge of the three blocks cannot decide on its own:
 * there is no pair of headers from the same block to compare, so the merge falls back to document
 * position and reads the layout's pass order (`Bravo`, `Alpha`) as if it were the profile's. It is
 * not a misread signal but the absence of one - rendering this profile with its two categories
 * swapped produces a **byte-identical** file - which is why the fix is a writer-side `ord` field
 * (`render.ts#categoryOrdinals`) rather than a cleverer reader.
 *
 * The byte-identical part is also why this fixture's presence in `ROUND_TRIP_FIXTURES` is necessary
 * but nowhere near sufficient: the fixed-point property held over the broken order too (both orders
 * render the same file, so the second render matched the first while the rail had silently flipped).
 * `round-trip.test.ts`'s dedicated case is what asserts the restored order itself.
 */
export const blockDisjointCategoryOrderProfile: ConfigProfile = buildFixtureProfile({
  name: 'Block-disjoint category order',
  categories: [
    { id: 'cat-alpha', name: 'Alpha' },
    { id: 'cat-bravo', name: 'Bravo' },
  ],
  actions: [
    // No commands at all: `render.ts#unboundCommand` writes `//bind ""` for it and no alias line -
    // exactly what `STANDARD_TEMPLATE` seeds a row as (story 052 D1), and the reason a whole
    // category can legitimately have nothing but an `Entries:` section.
    action({ name: 'Alpha unbound', kind: 'bind', commands: [], categoryId: 'cat-alpha' }),
    action({ name: 'Alpha empty', kind: 'bind', commands: [], categoryId: 'cat-alpha' }),
    action({
      // A continuous catalogue row mirrors as its own bare `+forward` on the key, so story 038 drops
      // its alias line: one `bind` line, no alias line, no anchor, no unbound line.
      name: 'Forward',
      kind: 'bind',
      commands: [{ kind: 'raw', text: '+forward' }],
      catalogId: 'forward',
      keys: [{ key: 'w' }],
      categoryId: 'cat-bravo',
    }),
  ],
})

/**
 * **Non-ASCII names within latin-1**, on every surface this story's new line shape put prose on: a
 * category name, an ordinary bound entry, an *unbound* entry (D2's `//bind` line) and an
 * anchor-carrying one.
 *
 * `latin1CategoryNameProfile` above covers the category banner alone. What this adds is the same
 * character set on the two comment-only line kinds, where the display name is the *only* copy of
 * itself in the file - a bound entry's name is repeated on its alias line and its bind line, so a
 * corruption on one of them can still be outvoted; an unbound entry's cannot.
 *
 * Every character here is inside latin-1 (code point <= 0xFF), which is the range the writer's whole
 * round trip promises to survive: `render.ts` encodes the file as latin1 and `sanitizeComment` drops
 * anything above it. `beyondLatin1NamesProfile` below is the deliberate other side of that line.
 */
export const nonAsciiLatin1NamesProfile: ConfigProfile = buildFixtureProfile({
  name: 'Non-ASCII (latin-1) names',
  categories: [{ id: 'cat-umlaut', name: 'Bewegung & Größe (Café)' }],
  actions: [
    action({
      name: 'Vorwärts',
      kind: 'bind',
      commands: [{ kind: 'raw', text: '+forward' }],
      keys: [{ key: 'w' }],
      categoryId: 'cat-umlaut',
    }),
    action({ name: 'Rückwärts ñ', kind: 'bind', commands: [], categoryId: 'cat-umlaut' }),
    action({
      name: 'Über-Sprung ß',
      kind: 'bind',
      commands: [{ kind: 'raw', text: '+moveup' }],
      keys: [{ key: 'SPACE', modifier: 'ALT' }],
      categoryId: 'cat-umlaut',
    }),
  ],
})

/**
 * **Names carrying characters above latin-1** - CJK and an emoji, each mixed with ASCII so the
 * sanitized remainder is still non-empty.
 *
 * **Deliberately not in `ROUND_TRIP_FIXTURES`**, for the same reason `collidingAliasNameProfile`
 * above is not: the property those loops assert does not hold for it, and pretending otherwise would
 * mean weakening the property. `cfg-layout.ts#sanitizeComment` **drops** every code point above
 * `0xFF` outright - the file is encoded latin1, so a character that cannot survive that encoding must
 * never reach the output rather than be written mangled - so the first render already spells these
 * names without them, and the profile read back out of it carries the shortened spelling. That is a
 * *lossy* first pass, exactly like the colliding-alias fixture, and `file-source-pipeline.test.ts`'s
 * "nothing lost" inventory (which compares entry and category names) would rightly flag it.
 *
 * It is still driven end to end in `round-trip.test.ts`, where the honest statement can be made:
 * the loss happens **once, at write time, deterministically**, and everything after that is a true
 * fixed point - no further erosion on the second, third or fourth pass, and no entry merged or
 * dropped by the character loss (two names that differ only above `0xFF` would collide, which is why
 * the ASCII parts below are distinct).
 *
 * Pre-existing and out of story 052's scope: the rule predates it (story 040's latin-1 decision) and
 * none of D1-D4 changed it. It is fixtured here because D2's unbound line is a *new* place for a
 * display name to live, and it had to be shown that the new line kind behaves the same way the old
 * ones do rather than, say, truncating at the first dropped character.
 */
export const beyondLatin1NamesProfile: ConfigProfile = buildFixtureProfile({
  name: 'Names beyond latin-1',
  categories: [{ id: 'cat-cjk', name: 'Move 移動 group' }],
  actions: [
    action({
      name: 'Jump 跳 up',
      kind: 'bind',
      commands: [{ kind: 'raw', text: '+moveup' }],
      keys: [{ key: 'SPACE' }],
      categoryId: 'cat-cjk',
    }),
    action({ name: 'Rocket 🚀 dance', kind: 'bind', commands: [], categoryId: 'cat-cjk' }),
  ],
})

/**
 * **Unbound entries whose derived alias name collides with another entry's** - twice, once against a
 * bound entry and once against a second unbound one, covering both of D2's line bodies.
 *
 * `derivedAliasName` slugs the display name with no id suffix (story 039's decision: the name is the
 * user's contract with whatever calls it), so `Strafe left` and `Strafe left!` both derive
 * `strafe_left`, and `Strafe right`/`Strafe right!` both derive `strafe_right`. Four entries, two
 * colliding pairs:
 *
 * - `Strafe left` is a bound catalogue row (`bind a "+moveleft"`); `Strafe left!` is unbound with no
 *   commands at all, so its whole presence is `//bind ""`.
 * - `Strafe right` is an *unbound* catalogue row, so its presence is `//bind "+moveright"`;
 *   `Strafe right!` is unbound and empty, `//bind ""` again.
 *
 * `collidingAliasNameProfile` above is the genuinely **lossy** version of a slug collision - two
 * entries that each *emit* an `alias <name>` line, of which the engine keeps only the last. This
 * profile deliberately is not that, and the difference is what makes it a fair test of D2/D3 rather
 * than a restatement of story 039's known loss: not one of these four entries emits an alias line at
 * all. A catalogue-backed continuous row mirrors as its own bare command, so `actionsWithAliasLine`
 * drops its line (story 034/038), and an entry with no commands has no body to render one from. The
 * collision therefore lives purely in the *model*, which is exactly where a merge would happen.
 *
 * Both partners of each pair also sit in one category and differ by a single trailing character, so
 * `Strafe left` is a strict *prefix* of `Strafe left!` - the relationship `matchAnchor`'s second and
 * third steps (exact prose, then unique prefix) pair an anchor to a group by. An unbound line is
 * deliberately keyed on its own file position instead (`unbound:<file>:<line>`,
 * `profile-restore.ts#groupEntryLines`), and this fixture is what fails if that ever becomes a prose
 * match "for symmetry" with the anchor path.
 *
 * Note which entries carry the catalogue link: `commentLabelFor` writes the *catalogue's* label for
 * an entry with a `catalogId`, so the two catalogue rows' prose is the catalogue's own spelling and
 * the two free-form ones keep the typed name with the `!`.
 */
export const collidingSlugWithUnboundProfile: ConfigProfile = buildFixtureProfile({
  name: 'Unbound entries whose alias slug collides',
  actions: [
    action({
      name: 'Strafe left',
      kind: 'bind',
      commands: [{ kind: 'raw', text: '+moveleft' }],
      catalogId: 'moveleft',
      keys: [{ key: 'a' }],
      categoryId: 'movement',
    }),
    action({ name: 'Strafe left!', kind: 'bind', commands: [], categoryId: 'movement' }),
    action({
      name: 'Strafe right',
      kind: 'bind',
      commands: [{ kind: 'raw', text: '+moveright' }],
      catalogId: 'moveright',
      categoryId: 'movement',
    }),
    action({ name: 'Strafe right!', kind: 'bind', commands: [], categoryId: 'movement' }),
  ],
})

// ---------------------------------------------------------------------------
// Story 053 D3: the second level (category -> sub-category).
//
// `render.ts#withSubcategoryBuckets` (D2) writes a category's ungrouped run
// first, then one `[q2l sub=<id>]` banner per sub-category in
// `category.subcategories` order - the empty ones included. These fixtures are
// what holds the reader to reading exactly that back: the fixed-point loop fails
// the moment an entry loses its `subcategoryId` (the next render writes it into
// the ungrouped run instead), the moment a sub-category is dropped (its banner
// disappears) and the moment one is invented (a banner appears).
// ---------------------------------------------------------------------------

/**
 * The headline shape: one category, two sub-categories, entries in the ungrouped run **and** in
 * both sub-categories, deliberately declared out of file order (`Cycling`'s entry is listed before
 * the ungrouped one) so the fixture also states that the writer's "ungrouped first" bucketing and
 * the reader's file-order grouping agree about the result.
 *
 * The three entry shapes are picked so all three of the writer's per-category blocks carry a
 * sub-banner, not just one: `Fire` is an alias-backed bound entry (an `Aliases: ` line and a
 * `Binds: ` line), `Next weapon` is a catalogue-backed continuous row that mirrors as its own bare
 * command (a `Binds: ` line and no alias line), and `Blaster` is keyless (an `Entries: ` unbound
 * line and nothing else). Reading the sub-category back off only one of the three blocks would
 * therefore still pass the entry assertions and still fail this fixture's fixed point.
 */
export const subcategoryProfile: ConfigProfile = buildFixtureProfile({
  name: 'Category with two sub-categories',
  categories: [
    {
      id: 'weapons',
      name: 'Weapons',
      nameKey: 'config.controls.categories.weapons',
      subcategories: [
        { id: 'sub-use', name: 'Use weapon' },
        { id: 'sub-cycle', name: 'Cycling' },
      ],
    },
  ],
  actions: [
    action({
      name: 'Next weapon',
      kind: 'bind',
      commands: [{ kind: 'raw', text: 'weapnext' }],
      catalogId: 'weapnext',
      keys: [{ key: 'MWHEELUP' }],
      categoryId: 'weapons',
      subcategoryId: 'sub-cycle',
    }),
    action({
      name: 'Rail gun',
      kind: 'bind',
      commands: [{ kind: 'raw', text: 'use railgun' }],
      keys: [{ key: '5' }],
      categoryId: 'weapons',
    }),
    action({
      name: 'Fire',
      kind: 'bind',
      commands: [
        { kind: 'raw', text: 'use blaster' },
        { kind: 'raw', text: '+attack' },
      ],
      keys: [{ key: 'MOUSE1' }],
      categoryId: 'weapons',
      subcategoryId: 'sub-use',
    }),
    action({
      name: 'Blaster',
      kind: 'bind',
      commands: [],
      categoryId: 'weapons',
      subcategoryId: 'sub-use',
    }),
  ],
})

/**
 * **An empty sub-category** - the story's own "the user just created it and saved" shape, and the
 * one the *lazy* registration a category gets cannot survive: nothing is ever filed under `Spare`,
 * so a reader that mints a sub-category only when an entry asks for one loses it silently, and the
 * next render is a file with one banner fewer.
 *
 * Kept next to a populated sibling and an ungrouped run in the same category, because "the empty one
 * survives" and "the empty one does not swallow the lines after it" are two different claims and
 * only a category holding both shapes states them at once.
 */
export const emptySubcategoryProfile: ConfigProfile = buildFixtureProfile({
  name: 'Empty sub-category next to a populated one',
  categories: [
    {
      id: 'movement',
      name: 'Movement',
      nameKey: 'config.controls.categories.movement',
      subcategories: [
        { id: 'sub-strafe', name: 'Strafing' },
        { id: 'sub-spare', name: 'Spare' },
      ],
    },
  ],
  actions: [
    action({
      name: 'Forward',
      kind: 'bind',
      commands: [{ kind: 'raw', text: '+forward' }],
      catalogId: 'forward',
      keys: [{ key: 'w' }],
      categoryId: 'movement',
    }),
    action({
      name: 'Strafe left',
      kind: 'bind',
      commands: [{ kind: 'raw', text: '+moveleft' }],
      catalogId: 'moveleft',
      keys: [{ key: 'a' }],
      categoryId: 'movement',
      subcategoryId: 'sub-strafe',
    }),
  ],
})

/**
 * Two categories that both carry sub-categories, with one entry bound through a **modifier** (so it
 * has an anchor line inside a sub-category's bucket rather than a bind line) - the section
 * attribution shape most likely to go wrong quietly, since an anchor is a comment-only line and the
 * reader has to tell it from the sub-banner sitting right above it.
 *
 * Also the case that pins `orderByFileSections` against the second level: a sub-banner carries no
 * `Aliases: `/`Binds: `/`Entries: ` prefix, so a reader that let one take part in the category-order
 * merge would read the two categories' order off the interleaved blocks instead of off `ord`.
 */
export const twoCategoriesWithSubcategoriesProfile: ConfigProfile = buildFixtureProfile({
  name: 'Two categories with sub-categories and a modifier slot',
  categories: [
    {
      id: 'drops',
      name: 'Drops',
      nameKey: 'config.controls.categories.drops',
      subcategories: [{ id: 'sub-ammo', name: 'Ammunition' }],
    },
    {
      id: 'cat-mine',
      name: 'My stuff',
      subcategories: [
        { id: 'sub-say', name: 'Chat' },
        { id: 'sub-empty', name: 'Later' },
      ],
    },
  ],
  actions: [
    action({
      name: 'Drop rockets',
      kind: 'bind',
      commands: [{ kind: 'raw', text: 'drop rockets' }],
      catalogId: 'drop-rockets',
      keys: [{ key: 'r', modifier: 'ALT' }],
      categoryId: 'drops',
      subcategoryId: 'sub-ammo',
    }),
    action({
      name: 'Taunt',
      kind: 'message',
      commands: [{ kind: 'message', channel: 'say', text: 'take that' }],
      keys: [{ key: 'F5' }],
      categoryId: 'cat-mine',
      subcategoryId: 'sub-say',
    }),
    // Named `Salute` rather than `Wave`: the derived alias name of an entry called "Wave" is `wave`,
    // which is the engine's own `wave` command, so `alias wave wave 1` is a self-referential alias
    // and `validate-structure.ts` rightly reports an `aliasCycle` for it - a real defect of the
    // fixture, not of anything this deliverable touches.
    action({
      name: 'Salute',
      kind: 'bind',
      commands: [{ kind: 'raw', text: 'wave 1' }],
      keys: [{ key: 'g' }],
      categoryId: 'cat-mine',
    }),
  ],
})

/**
 * One fixture per `sectionHeaderStyle`, because a sub-banner is the same `banner()` call as a
 * category banner (the story's own "no new decoration" decision) and every banner-stripping path the
 * reader has is style-specific: `DASHES_PREFIX`/`DASHES_SUFFIX`, `BRACKETS_PREFIX`/
 * `BRACKETS_SUFFIX`, and - for `plain`, which draws no decoration at all - nothing but the `sub=`
 * tag itself. `plain` is the one that would have caught a reader relying on `BANNER_RULE` to notice
 * a second-level header, exactly as it did for the "Other" bucket in story 042's round 5.
 */
export const subcategoryHeaderStyleProfiles: ConfigProfile[] = (
  ['dashes', 'brackets', 'plain'] as const
).map((style) =>
  buildFixtureProfile({
    name: `Sub-category header style: ${style}`,
    sectionHeaderStyle: style,
    categories: [
      {
        id: 'weapons',
        name: 'Weapons',
        nameKey: 'config.controls.categories.weapons',
        subcategories: [
          { id: 'sub-use', name: 'Use weapon' },
          { id: 'sub-empty', name: 'Nothing here yet' },
        ],
      },
    ],
    actions: [
      action({
        name: 'Attack',
        kind: 'bind',
        commands: [{ kind: 'raw', text: '+attack' }],
        catalogId: 'attack',
        keys: [{ key: 'MOUSE1' }],
        categoryId: 'weapons',
      }),
      action({
        name: 'Shotgun',
        kind: 'bind',
        commands: [{ kind: 'raw', text: 'use shotgun' }],
        keys: [{ key: '2' }],
        categoryId: 'weapons',
        subcategoryId: 'sub-use',
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
  toggleEntryProfile,
  pressReleaseEntryProfile,
  waitChainProfile,
  waitAtChunkBoundaryProfile,
  chunkedToggleStateProfile,
  modifiedSlotToggleProfile,
  budgetCutPressReleaseProfile,
  budgetCutToggleProfile,
  budgetCutSingleBodyProfile,
  prefixNamedTrioProfile,
  ...sectionHeaderStyleProfiles,
  ...orphanedCategoryProfiles,
  // Story 052 D5's adversarial pass, plus the two category-order shapes its review added. One of
  // its seven shapes is deliberately absent, for the reason stated in its own doc comment:
  // `beyondLatin1NamesProfile` (lossy by design at write time).
  unboundNoCommandsProfile,
  bannerLookalikeNameProfile,
  duplicateCategoryNamesProfile,
  literalOtherCategoryProfile,
  nonAsciiLatin1NamesProfile,
  collidingSlugWithUnboundProfile,
  scrambledCategoryOrderProfile,
  blockDisjointCategoryOrderProfile,
  // Story 053 D3's second level.
  subcategoryProfile,
  emptySubcategoryProfile,
  twoCategoriesWithSubcategoriesProfile,
  ...subcategoryHeaderStyleProfiles,
]
