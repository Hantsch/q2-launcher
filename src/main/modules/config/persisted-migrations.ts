import { randomUUID } from 'node:crypto'
import type { AltLayer } from '@shared/config/aliases/alt-layers'
import { bindValueFor } from '@shared/config/aliases/action-mirror'
import { LEGACY_ACTION_ALIAS_PREFIX, legacyAliasNameFor } from '@shared/config/aliases/alias-render'
import {
  allCatalogRows,
  buildDemoRows,
  commandsForRow,
  nameForCatalogRow,
} from '@shared/config/catalog/catalog-rows'
import { findCvar } from '@shared/config/catalog/cvar-catalog'
import {
  buildTemplateCvarSections,
  TEMPLATE_ACTION_CATEGORIES,
  TEMPLATE_BOUND_CATALOG_IDS,
  type ConfigAction,
} from '@shared/modules/config'
import type { MigrationStep } from '../../services/migrations'

/**
 * The config module's `state.json` migrations, in ascending `to` order. Never edit a shipped step;
 * add a new one. A step must be pure and must not throw (a bad step means data loss).
 */
export const CONFIG_MIGRATIONS: readonly MigrationStep[] = [
  {
    to: 2,
    describe:
      'materialise every catalogue row into the three template categories for every profile ' +
      '(story 052 D6: the rows used to be rendered live from the catalogue, never persisted)',
    apply: (doc) => {
      const profiles = Array.isArray(doc.configProfiles) ? doc.configProfiles : []
      return {
        ...doc,
        configProfiles: profiles.map((raw) =>
          materialiseTemplateCategories(raw as Record<string, unknown>),
        ),
      }
    },
  },
  {
    to: 3,
    describe:
      'seed cvarSections (Player/Network/Graphics/Sound + Other) for every profile that predates ' +
      'story 059 (D6: Settings used to render live from the catalogue group, never persisted)',
    apply: (doc) => {
      const profiles = Array.isArray(doc.configProfiles) ? doc.configProfiles : []
      return {
        ...doc,
        configProfiles: profiles.map((raw) =>
          materialiseCvarSections(raw as Record<string, unknown>),
        ),
      }
    },
  },
  {
    to: 4,
    describe:
      'add the demo playback category and its unbound demo rows to every profile that lacks them ' +
      '(story 167 D3)',
    apply: (doc) => {
      const profiles = Array.isArray(doc.configProfiles) ? doc.configProfiles : []
      return {
        ...doc,
        configProfiles: profiles.map((raw) => addDemoCategory(raw as Record<string, unknown>)),
      }
    },
  },
  {
    to: 5,
    describe:
      'add the unbound demo "Back to window" row and guard untouched demo commands ' +
      '(story 172 D2)',
    apply: (doc) => {
      const profiles = Array.isArray(doc.configProfiles) ? doc.configProfiles : []
      return {
        ...doc,
        configProfiles: profiles.map((raw) =>
          addBackToWindowAndGuard(raw as Record<string, unknown>),
        ),
      }
    },
  },
]

const GUARD_PREFIX = 'if x$cl_demopos ne x$q2l_armpos then '
const guarded = (commands: string[]): string[] => commands.map((c) => GUARD_PREFIX + c)
const SPEED_UP_OLD = [
  'if $timescale == 2 then timescale 4',
  'if $timescale == 1 then timescale 2',
  'if $timescale == 0.5 then timescale 1',
  'if $timescale == 0.25 then timescale 0.5',
]
const SPEED_DOWN_OLD = [
  'if $timescale == 0.5 then timescale 0.25',
  'if $timescale == 1 then timescale 0.5',
  'if $timescale == 2 then timescale 1',
  'if $timescale == 4 then timescale 2',
]

/**
 * Story 172, frozen: the pre-172 (unguarded) commands of each demo action, keyed by catalogId,
 * with the guarded replacement. Hard-coded on purpose - never derived from the live catalogue, so a
 * later catalogue change cannot make this step guard (or miss) different text. A row is rewritten
 * only when its commands equal the old text exactly; an edited row is left alone.
 */
const DEMO_GUARD_TABLE: Record<string, { old: string[]; guarded: string[] }> = {
  'demo:demoPause': { old: ['pause'], guarded: guarded(['pause']) },
  'demo:demoJumpBack': { old: ['seek -10'], guarded: guarded(['seek -10']) },
  'demo:demoJumpForward': { old: ['seek +10'], guarded: guarded(['seek +10']) },
  'demo:demoJumpBackLong': { old: ['seek -60'], guarded: guarded(['seek -60']) },
  'demo:demoJumpForwardLong': { old: ['seek +60'], guarded: guarded(['seek +60']) },
  'demo:demoSpeedUp': { old: SPEED_UP_OLD, guarded: guarded(SPEED_UP_OLD) },
  'demo:demoSpeedDown': { old: SPEED_DOWN_OLD, guarded: guarded(SPEED_DOWN_OLD) },
}

/**
 * Story 172: in a profile that has a `demo` category, appends the unbound `demoBackToWindow`
 * row when absent and swaps untouched pre-172 demo commands for their guarded form. Never throws,
 * never touches keys/binds, never re-adds a deleted category; `dirty` is set only on a change.
 */
function addBackToWindowAndGuard(raw: Record<string, unknown>): Record<string, unknown> {
  try {
    if (raw === null || typeof raw !== 'object') return raw
    const categories = Array.isArray(raw.categories)
      ? (raw.categories as Record<string, unknown>[])
      : []
    if (!categories.some((category) => category?.id === 'demo')) return raw
    if (!Array.isArray(raw.actions)) return raw
    let changed = false
    const actions = (raw.actions as Record<string, unknown>[]).map((action) => {
      const entry =
        typeof action?.catalogId === 'string' ? DEMO_GUARD_TABLE[action.catalogId] : undefined
      if (!entry || !Array.isArray(action.commands)) return action
      const texts = (action.commands as unknown[]).map((c) =>
        c !== null && typeof c === 'object' && (c as Record<string, unknown>).kind === 'raw'
          ? (c as Record<string, unknown>).text
          : undefined,
      )
      if (texts.length !== entry.old.length || !texts.every((t, i) => t === entry.old[i]))
        return action
      changed = true
      return { ...action, commands: entry.guarded.map((text) => ({ kind: 'raw', text })) }
    })
    const backRow = buildDemoRows().find((row) => row.catalogId === 'demo:demoBackToWindow')
    if (backRow && !actions.some((action) => action?.catalogId === backRow.catalogId)) {
      actions.push({
        id: randomUUID(),
        categoryId: 'demo',
        name: nameForCatalogRow(backRow),
        kind: 'bind',
        catalogId: backRow.catalogId,
        commands: [],
      })
      changed = true
    }
    return changed ? { ...raw, actions, dirty: true } : raw
  } catch {
    return raw
  }
}

/**
 * Story 167: appends the `demo` category (only if no category has that id) and one unbound
 * action per demo catalogue row the profile has no action for. Deliberately does NOT re-run
 * `materialiseTemplateCategories`: that would also re-add a movement/weapons/drops category the
 * user deleted. Existing categories/actions stay untouched; `binds` is never read or written, and
 * the new actions carry `commands: []` and no keys, so nothing is bound. Idempotent (only-if-absent).
 */
function addDemoCategory(raw: Record<string, unknown>): Record<string, unknown> {
  if (raw === null || typeof raw !== 'object') return raw
  const categories = Array.isArray(raw.categories)
    ? [...(raw.categories as Record<string, unknown>[])]
    : []
  const actions = Array.isArray(raw.actions) ? [...(raw.actions as Record<string, unknown>[])] : []

  if (!categories.some((category) => category?.id === 'demo')) {
    const template = TEMPLATE_ACTION_CATEGORIES.find((category) => category.id === 'demo')
    if (template)
      categories.push({ id: template.id, name: template.label, nameKey: template.labelKey })
  }

  const existingCatalogIds = new Set(
    actions
      .map((action) => action?.catalogId)
      .filter((catalogId): catalogId is string => typeof catalogId === 'string'),
  )
  for (const row of buildDemoRows()) {
    if (existingCatalogIds.has(row.catalogId)) continue
    actions.push({
      id: randomUUID(),
      categoryId: 'demo',
      name: nameForCatalogRow(row),
      kind: 'bind',
      catalogId: row.catalogId,
      commands: [],
    })
  }

  return { ...raw, categories, actions, dirty: true }
}

/**
 * Story 052: adds the three `TEMPLATE_ACTION_CATEGORIES` (movement/weapons/drops) to a profile's
 * `categories` if not already present, and one action per `allCatalogRows()` row to `actions` for
 * any `catalogId` the profile does not already have an action for - existing categories/actions are
 * left exactly as they are (untouched, same position), new ones are appended at the end in the
 * catalogue's own order. Before this story these three categories and their rows were rendered live
 * from the hardcoded catalogue and never stored in the profile at all; once the renderer stops doing
 * that lazy materialisation (later deliverables in this story), every still-unbound row a
 * pre-existing profile does not persist would silently disappear from its Controls tab - this is
 * what stops that from happening.
 *
 * Idempotent by construction: a profile that already carries all three categories and every
 * catalogue row's action (e.g. because this step already ran once) matches every "already present"
 * check below and gets nothing appended - only `dirty` is (re)set, which is itself idempotent.
 *
 * Marks the profile dirty rather than touching its canonical file (Decisions taken during refine:
 * "the migration writes the cache and marks the profile dirty, it does not write the user's file
 * unprompted") - `dirty === true` is exactly the flag the save pipeline
 * (`main/modules/config/index.ts`, `profiles.ts#setDirty`) already uses to mean "this profile has
 * pending edits", so the existing unsaved-changes bar picks this up for free.
 */
function materialiseTemplateCategories(raw: Record<string, unknown>): Record<string, unknown> {
  const categories = Array.isArray(raw.categories)
    ? [...(raw.categories as Record<string, unknown>[])]
    : []
  const actions = Array.isArray(raw.actions) ? [...(raw.actions as Record<string, unknown>[])] : []

  const existingCategoryIds = new Set(categories.map((category) => category.id))
  for (const category of TEMPLATE_ACTION_CATEGORIES) {
    if (existingCategoryIds.has(category.id)) continue
    categories.push({ id: category.id, name: category.label, nameKey: category.labelKey })
  }

  const existingCatalogIds = new Set(
    actions
      .map((action) => action.catalogId)
      .filter((catalogId): catalogId is string => typeof catalogId === 'string'),
  )
  for (const row of allCatalogRows()) {
    if (existingCatalogIds.has(row.catalogId)) continue
    // F1 fix (story 052 review): a row that is one of the template's own six default-bound
    // catalogIds must get the SAME real command `buildTemplateActions` gives it, not `commands: []`
    // - otherwise `adoptRawBinds`'s signature match can never recognise the profile's own matching
    // raw bind as this row, and the Controls tab shows the row as unbound even though the key still
    // works in-game. Every other row is genuinely unbound, exactly as before.
    const bound = TEMPLATE_BOUND_CATALOG_IDS.has(row.catalogId)
    actions.push({
      id: randomUUID(),
      categoryId: row.categoryId,
      name: nameForCatalogRow(row),
      kind: 'bind',
      catalogId: row.catalogId,
      commands: bound ? commandsForRow(row, false) : [],
    })
  }

  return { ...raw, categories, actions, dirty: true }
}

/** Reserved id/label for the migration's own "Other" section - a REAL, taggable `ConfigCvarSection`
 * (`cvs=other` once rendered), not the writer's untagged reserved bucket of the same display name
 * (`render.ts`'s `OTHER_CVAR_GROUP_LABEL`). The two coexist without collision: the writer's bucket
 * only ever catches non-catalogue cvars that no *real* section claims, and this migration always
 * gives every non-catalogue cvar it finds a real, explicit home in this section, so nothing is left
 * for the writer's untagged bucket to pick up - both would render identically either way, since
 * they use the same label. */
const MIGRATED_OTHER_SECTION_ID = 'other'
const MIGRATED_OTHER_SECTION_LABEL = 'Other'

/**
 * Story 059: seeds `cvarSections` once for a profile that predates the feature - every profile
 * whose `cvarSections` is missing entirely (a NEW profile created since then already gets one
 * from `create()`/import, so this only ever fires for an old one). Mirrors
 * `materialiseTemplateCategories` right above: idempotent by construction (a profile that already
 * has `cvarSections` - including one this step already seeded - is returned untouched, so a second
 * run is a byte-identical no-op), and marks the profile dirty rather than touching its canonical
 * file, same precedent and same reason.
 *
 * Seeds all four groups with EVERY `ALL_CVARS` name, exactly like `STANDARD_TEMPLATE.cvarSections`
 * seeds a brand-new template profile - regardless of whether the migrating profile actually has a
 * stored value for a given catalogue cvar. This makes a migrated profile's Settings tab match a
 * template profile's shape ("catalogue ones in the four sections"), rather
 * than a sparse subset that leaves most catalogue cvars to fall into the reserved `Defaults` bucket.
 *
 * Any key of `profile.cvars` that is not a catalogue cvar at all (`findCvar` - the same
 * case-insensitive lookup the writer/reader use to tell "claimed" from "unclaimed" cvars) goes into
 * one appended `Other` section, in the order `Object.keys` gives them (insertion order, same as
 * every other raw-document read in this file) - omitted entirely when empty, so a profile with no
 * non-catalogue cvars gets exactly the four groups and nothing else.
 */
function materialiseCvarSections(raw: Record<string, unknown>): Record<string, unknown> {
  if (raw.cvarSections !== undefined) return raw

  const cvars =
    raw.cvars && typeof raw.cvars === 'object' ? (raw.cvars as Record<string, string>) : {}
  const keys = Object.keys(cvars)

  const sections = buildTemplateCvarSections()

  const otherCvars = keys.filter((key) => !findCvar(key))
  if (otherCvars.length > 0) {
    sections.push({
      id: MIGRATED_OTHER_SECTION_ID,
      name: MIGRATED_OTHER_SECTION_LABEL,
      cvars: otherCvars,
    })
  }

  return { ...raw, cvarSections: sections, writeCatalogDefaults: true, dirty: true }
}

/**
 * Story 050: `configActionSchema`'s `normalizeActionKeys`
 * (`main/modules/config/schemas.ts`), but forgiving - this is the persisted-state mirror, so a
 * pre-050 row (every row on a dev machine's disk before this story) keeps its up-to-two slots
 * intact instead of being dropped for a shape the row-level schema no longer recognises. Input
 * already carrying `keys` passes through untouched.
 */
export function normalizeLegacyActionKeys(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) return raw
  const value = raw as Record<string, unknown>
  if ('keys' in value) return raw

  const slots: unknown[] = []
  if (typeof value.key === 'string') {
    slots.push({ key: value.key, modifier: value.keyModifier })
  }
  if (typeof value.secondaryKey === 'string') {
    slots.push({ key: value.secondaryKey, modifier: value.secondaryKeyModifier })
  }
  if (slots.length === 0) return raw

  const {
    key: _key,
    secondaryKey: _secondaryKey,
    keyModifier: _keyModifier,
    secondaryKeyModifier: _secondaryKeyModifier,
    ...rest
  } = value
  return { ...rest, keys: slots }
}

/**
 * Story 039: the legacy alias name of every action that has one, mapped to the value the
 * mirrors write for that same action *today* (`bindValueFor`).
 *
 * Keyed by `legacyAliasNameFor`, which is stable across the alias name flip - it keeps reproducing the
 * `q2l_a_<slug>_<id4>` format an older version of this app generated, which is exactly what a
 * pre-039 `state.json` has in `binds`/`layers[].overrides`. The value side is `bindValueFor`, not
 * `aliasNameFor`, so a continuous catalogue row's reference migrates to its own `+command` rather
 * than to an alias name the engine would never send the release half of (story 034).
 *
 * Only names that actually carry the legacy prefix go in. A `kind: 'alias'` entry's
 * `legacyAliasNameFor` is its own, prefix-free name (`ownAliasName`), i.e. a name a user can - and
 * story 041 will - reference by hand; letting that into the map would turn this migration into a
 * rewriter of hand-typed binds, which the story's own decision ("never silently rewrite
 * references") forbids. Such an entry's *stale bind-era* mirror is prefixed and is handled by
 * `stripAliasActionBinds`/`stripAliasActionOverrides` (story 019) and by the orphan drop below.
 *
 * Later action wins on a collision, deterministically, the same rule the two mirror passes use for
 * a key collision. Two actions can only collide here if they share both a name slug and the first
 * four characters of their id.
 */
export function legacyAliasValueMap(actions: ConfigAction[]): Map<string, string> {
  const byLegacyName = new Map<string, string>()
  for (const action of actions) {
    const legacyName = legacyAliasNameFor(action)
    if (!legacyName.startsWith(LEGACY_ACTION_ALIAS_PREFIX)) continue
    byLegacyName.set(legacyName, bindValueFor(action))
  }
  return byLegacyName
}

/**
 * One `binds`-shaped map, migrated (story 039). Three cases per value, and the order of the
 * first two is what makes this safe:
 *
 * 1. Not a `q2l_a_*` value at all -> kept verbatim. This is the hand-typed case (`bind x
 *    "some_alias"`, `bind r "+attack"`), and it is decided *first*, so nothing outside the legacy
 *    format can be rewritten or dropped by this pass at all.
 * 2. A `q2l_a_*` value that is some action's legacy name -> rewritten to that action's current
 *    mirrored value. Before the name flip that value is byte-for-byte the legacy name again (nothing changes,
 *    which is what keeps this deliverable green on its own); after it, the readable name.
 * 3. A `q2l_a_*` value belonging to no action in this profile -> dropped. That is what the write
 *    path already does with such an orphan, permanently and for the same reason
 *    (`applyActionBindMirror`/`applyActionLayerMirror`'s legacy-prefix strip): its owning action is
 *    gone, so no future pass can ever recognise it, and it would otherwise fire forever. Doing it
 *    on the read path too means an orphan cannot reach the Controls grid, `adoptRawBinds` or a
 *    Care finding as if it were a hand-made bind.
 *
 * The one knowingly accepted cost is the one `action-mirror.ts` already documents: an own alias
 * name a user deliberately types as `q2l_a_...` (legal - `alias-names.ts` does not ban the prefix)
 * reads as legacy debris wherever it is referenced by hand.
 *
 * Returns `entries` unchanged (same reference) when there is nothing to migrate - same convention
 * as `stripAliasActionBinds`.
 */
export function migrateLegacyReferences(
  entries: Record<string, string>,
  currentByLegacyName: Map<string, string>,
): Record<string, string> {
  let changed = false
  const next: Record<string, string> = {}
  for (const [key, value] of Object.entries(entries)) {
    const trimmed = value.trim()
    if (!trimmed.startsWith(LEGACY_ACTION_ALIAS_PREFIX)) {
      next[key] = value
      continue
    }
    const migrated = currentByLegacyName.get(trimmed)
    if (migrated === undefined) {
      changed = true
      continue
    }
    if (migrated !== value) changed = true
    next[key] = migrated
  }
  return changed ? next : entries
}

/**
 * Story 039: rewrite every legacy `q2l_a_*` reference in `binds` and in every layer's
 * `overrides` to the value the mirrors write for the owning action today, dropping the ones whose
 * action is gone - see `migrateLegacyReferences` for the per-value rule.
 *
 * One pass over both maps, and it runs before any other bind normalisation
 * (`normalizeConfigProfile` below), so a profile written by an older version is never observed with
 * new-format ownership rules applied to old-format values: nothing is unbound "in between".
 *
 * A layer with nothing to migrate is returned as the same object reference, so an untouched layer
 * stays untouched by identity too - same convention as `stripAliasActionOverrides`.
 */
export function migrateLegacyAliasReferences(
  binds: Record<string, string>,
  layers: AltLayer[],
  actions: ConfigAction[],
): { binds: Record<string, string>; layers: AltLayer[] } {
  const currentByLegacyName = legacyAliasValueMap(actions)
  return {
    binds: migrateLegacyReferences(binds, currentByLegacyName),
    layers: layers.map((layer) => {
      const overrides = migrateLegacyReferences(layer.overrides, currentByLegacyName)
      return overrides === layer.overrides ? layer : { ...layer, overrides }
    }),
  }
}
