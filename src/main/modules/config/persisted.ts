import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { parseForgivingRows } from '../../lib/forgiving'
import { migrateLegacyAliasReferences, normalizeLegacyActionKeys } from './persisted-migrations'
import type { StateSection, StateSectionSpec, StateStore } from '../../services/state'
import type { AltLayer } from '@shared/config/aliases/alt-layers'
import { adoptRawBinds } from '@shared/config/profile/bind-adoption'
import {
  stripAliasActionBinds,
  stripAliasActionOverrides,
} from '@shared/config/aliases/modifier-layers'
import type { ProfileBaseline } from '@shared/config/profile/profile-baseline'
import {
  actionEntryKindSchema,
  actionKeySlotObjectSchema,
  altLayerObjectSchema,
  configActionCategoryObjectSchema,
  configActionObjectSchema,
  configActionSubcategoryObjectSchema,
  configCvarSectionObjectSchema,
  configCvarSubsectionObjectSchema,
  refineActionParts,
} from '@shared/config/aliases/profile-schema'
import type {
  ActionEntryKind,
  ConfigAction,
  ConfigActionCategory,
  ConfigCvarSection,
  ConfigProfile,
} from '@shared/modules/config'

const nowIso = (): string => new Date().toISOString()

/*
 * The persisted twins of `@shared/config/aliases/profile-schema`'s shapes. Each extends the shared object
 * and overrides only the fields that are forgiving on disk; every other field - and its position in
 * the output - is the shared one. Two kinds of forgiveness, chosen per field:
 * - `.catch()` on the field degrades just that value, keeping the row;
 * - no catch means a bad value fails the row, which `parseForgivingRows` then drops on its own -
 *   one bad row among several good ones never wipes the rest. Command text that fails the
 *   latin-1/no-quote rule, an out-of-range `wait`, or a malformed two-part `parts` all take this
 *   path deliberately.
 */

/** A missing/malformed `triggerKey` degrades to `null` ("no trigger yet") instead of failing the layer. */
const altLayerPersistedSchema: z.ZodType<AltLayer> = altLayerObjectSchema.extend({
  triggerKey: altLayerObjectSchema.shape.triggerKey.catch(null),
})

/**
 * The pre-019 per-category entry kind. Gone from `ConfigActionCategory` but still accepted -
 * forgivingly, so even `entryKind: 42` cannot fail the row - because dropping a category over a
 * field the type no longer has would delete a user's drawer and every entry pointing at it.
 * `normalizeConfigProfile` reads it to derive each entry's own `kind` and leaves it out of the
 * output: it exists on disk, never in memory.
 */
const legacyCategoryEntryKindSchema = actionEntryKindSchema.optional().catch(undefined)

/** An unreadable display hint degrades to "none" rather than dropping the category/section. */
const nameKeyPersistedSchema = configActionCategoryObjectSchema.shape.nameKey.catch(undefined)

/** Absent (any category predating sub-categories) reads as `[]`; a malformed row is dropped alone. */
const configActionSubcategoriesPersistedSchema = z.preprocess(
  (raw) => parseForgivingRows(configActionSubcategoryObjectSchema, raw),
  z.array(configActionSubcategoryObjectSchema),
)

/** The category as a baseline snapshot stores it - no legacy `entryKind`. */
const configActionCategoryPersistedObjectSchema = configActionCategoryObjectSchema.extend({
  nameKey: nameKeyPersistedSchema,
  subcategories: configActionSubcategoriesPersistedSchema,
})

const configActionCategoryPersistedSchema = configActionCategoryPersistedObjectSchema.extend({
  entryKind: legacyCategoryEntryKindSchema,
})

/** A section that could not read its cvar list is still a named drawer worth keeping. */
const cvarNamesPersistedSchema = configCvarSubsectionObjectSchema.shape.cvars.catch(() => [])

const configCvarSubsectionPersistedSchema = configCvarSubsectionObjectSchema.extend({
  cvars: cvarNamesPersistedSchema,
})

/** Same absent-reads-as-`[]`, drop-the-malformed-row convention as the action sub-categories. */
const configCvarSubsectionsPersistedSchema = z.preprocess(
  (raw) => parseForgivingRows(configCvarSubsectionPersistedSchema, raw),
  z.array(configCvarSubsectionPersistedSchema),
)

const configCvarSectionPersistedSchema: z.ZodType<ConfigCvarSection> =
  configCvarSectionObjectSchema.extend({
    nameKey: nameKeyPersistedSchema,
    cvars: cvarNamesPersistedSchema,
    subsections: configCvarSubsectionsPersistedSchema,
  })

/** An unrecognised modifier degrades to "none" rather than dropping the slot. */
const actionKeySlotPersistedSchema = actionKeySlotObjectSchema.extend({
  modifier: actionKeySlotObjectSchema.shape.modifier.catch(undefined),
})

/**
 * Kept as a plain `z.object` (not wrapped in the legacy-key preprocess) so
 * `profileBaselinePersistedSchema` below can `.extend()` it.
 *
 * `kind` is required on the type but optional-and-forgiving here: a pre-019 row has none and an
 * unreadable one carries no information either. Both come out `undefined` and are filled in by
 * `normalizeConfigProfile`, the only place that can see the sibling `categories` the derive needs -
 * a row is never dropped over this field. `keys` is folded from the pre-050 four-field shape by
 * `normalizeLegacyActionKeys` before this schema sees it.
 */
const configActionPersistedObjectSchema = configActionObjectSchema.extend({
  kind: actionEntryKindSchema.optional().catch(undefined),
  keys: z.array(actionKeySlotPersistedSchema).optional().catch(undefined),
})

const configActionPersistedSchema = z.preprocess(
  normalizeLegacyActionKeys,
  configActionPersistedObjectSchema.superRefine(refineActionParts),
)

/**
 * Story 049 D1: the persisted `ProfileBaseline` - the snapshot of the profile as its `.cfg` last
 * had it, which "unsaved change" is measured against and which a discard restores.
 *
 * Strict *within* the field, forgiving *about* it: every member but `name` (see below) is required
 * here (a half-read
 * snapshot is worse than none - it would report changes that are not changes, and a discard would
 * then destroy real work), and the whole field degrades to `undefined` at the call site below
 * (`.optional().catch(undefined)`), which is the documented "no known saved state" reading.
 *
 * The action rows reuse `configActionPersistedSchema` above with one change: `kind` is required
 * here, defaulted rather than left `undefined`. `normalizeConfigProfile`'s derive-from-the-category
 * fallback cannot apply to a snapshot (it has no legacy `entryKind` to read - every baseline was
 * written by this story or later), so `'bind'` is the same last-resort answer that function gives,
 * for the same reason: it is the only kind an entry of unknown type can safely be.
 *
 * The live fields are additionally normalised on read (`normalizeConfigProfile`: legacy alias
 * references, the alias strip, `adoptRawBinds`); the snapshot deliberately is not. Every baseline
 * this schema can encounter was captured *after* those passes had already run on the record it came
 * from (`ProfilesStore` seeds it post-adoption), so re-running them would be a no-op at best and a
 * second, divergent normalisation rule at worst.
 *
 * `name` is the one member this schema does *not* require, and the one whose absence is not a
 * half-read snapshot: it joined `ProfileBaseline` after the field first shipped (review finding,
 * story 049), so a baseline written in between carries every other member and simply no name.
 * Dropping the whole snapshot over it would disable discard and hide real pending changes;
 * `normalizeConfigProfile` below instead completes it from the profile's *current* name, which
 * reads as "the name was never tracked, so it is not what changed" - the same treat-it-as-its-own-
 * baseline idiom the story uses for a profile with no snapshot at all, and never a phantom rename
 * that a discard would then "restore" over the real name.
 */
type PersistedProfileBaseline = Omit<ProfileBaseline, 'name'> & { name?: string }

const profileBaselinePersistedSchema: z.ZodType<PersistedProfileBaseline> = z.object({
  name: z.string().optional(),
  cvars: z.record(z.string(), z.string()),
  binds: z.record(z.string(), z.string()),
  layers: z.array(altLayerPersistedSchema),
  categories: z.array(configActionCategoryPersistedObjectSchema),
  actions: z.array(
    z.preprocess(
      normalizeLegacyActionKeys,
      configActionPersistedObjectSchema
        .extend({
          kind: actionEntryKindSchema.catch('bind'),
        })
        .superRefine(refineActionParts),
    ),
  ),
  // Story 054 D11: `cvarSections` joined `ProfileBaseline` alongside `categories`/`actions` above.
  // Unlike those, it must tolerate being *absent entirely* - review-fix: every baseline persisted
  // before this story has no `cvarSections` key at all, and this whole object is read through
  // `.optional().catch(undefined)` (below), so a required field here silently discarded every
  // pre-existing baseline on upgrade. `captureBaseline` already normalises a missing value to `[]`
  // (`profile-baseline.ts`), so defaulting here just matches that at the parse boundary. A
  // malformed *section* inside an array that IS present still fails the whole snapshot rather than
  // being dropped row-by-row, the way the live `configProfileObjectSchema.cvarSections` field
  // (below) forgives one.
  cvarSections: z.array(configCvarSectionPersistedSchema).optional().default([]),
  writeUnbindall: z.boolean(),
  sectionHeaderStyle: z.enum(['dashes', 'brackets', 'plain']),
  unrecognized: z.array(z.object({ file: z.string(), line: z.number(), text: z.string() })),
})

/**
 * A persisted config profile. Same rules as `installationSchema`: only the
 * fields without which the record is meaningless (`id`, `name`) are strict, so
 * a hand-mangled profile is dropped on its own instead of taking the file - or
 * the installation list - with it.
 *
 * Exported for its type: every `ConfigProfile` key must be declared here, or zod strips it on read.
 */
export const configProfileObjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  createdAt: z.string().catch(nowIso),
  updatedAt: z.string().catch(nowIso),
  // The fallbacks are functions, not literals: a caught value is handed out as
  // the same instance on every row, and these two maps are mutable and will be
  // edited per profile later on.
  cvars: z.record(z.string(), z.string()).catch(() => ({})),
  binds: z.record(z.string(), z.string()).catch(() => ({})),
  assignments: z
    .array(z.object({ installationId: z.string().min(1), isDefault: z.boolean() }))
    .catch(() => []),
  // Story 005: preserved lines from an import. Optional on the type, but a
  // persisted row from before story 005 simply never had the key, so this
  // still degrades to an empty array rather than leaving it undefined.
  unrecognized: z
    .array(z.object({ file: z.string(), line: z.number(), text: z.string() }))
    .catch(() => []),
  // Story 006: alternate binding layers. Same forgiving convention as
  // `unrecognized` right above - a mangled `layers` value (or one predating
  // this story) degrades the whole field to `[]` rather than dropping the
  // profile it belongs to.
  layers: z.array(altLayerPersistedSchema).catch(() => []),
  // Story 008: action categories and their entries. Unlike `layers` right above, a malformed row is dropped on its own via
  // `parseForgivingRows` rather than degrading the whole array to `[]` - see
  // that helper's doc comment. A missing key (any profile predating this
  // story) still yields `[]`, same as every other optional field here.
  // Story 019: both fields are post-processed by `normalizeConfigProfile` below - the entry kind
  // moved from the category onto the entry, and an old file's category-level `entryKind` is what
  // an entry without a `kind` of its own derives from.
  categories: z.preprocess(
    (raw) => parseForgivingRows(configActionCategoryPersistedSchema, raw),
    z.array(configActionCategoryPersistedSchema),
  ),
  actions: z.preprocess(
    (raw) => parseForgivingRows(configActionPersistedSchema, raw),
    z.array(configActionPersistedSchema),
  ),
  // Story 059 D1: the profile's own cvar sections/sub-sections - the Settings-tab counterpart of
  // `categories`/`actions` right above. Same forgiving, row-level-drop convention: a malformed
  // section is dropped on its own via `parseForgivingRows` rather than degrading the whole field to
  // `[]`, and a profile predating this story (or created with `from: 'empty'`) simply has no key
  // here, which yields `[]` same as every other optional field of this shape.
  cvarSections: z.preprocess(
    (raw) => parseForgivingRows(configCvarSectionPersistedSchema, raw),
    z.array(configCvarSectionPersistedSchema),
  ),
  // Story 040 D4: whether the rendered file opens with `unbindall`, right after the header.
  // Defaults to true (the User decision) - a missing/malformed value, including every profile
  // persisted before this story, degrades to `true` rather than `false`, same forgiving
  // convention as `favorite` above. No migration entry: purely additive, same precedent as
  // story 039's `aliasName`.
  writeUnbindall: z.boolean().catch(true),
  // Story 059 D1: whether the writer should keep emitting a `set` line for every catalogue cvar a
  // profile's own `cvarSections` do not mention - `true` (today's own unconditional behaviour,
  // story 048 D2) is the default a missing/malformed value degrades to, same `writeUnbindall`
  // precedent right above: no migration entry, and a profile persisted before this story renders
  // byte-identical to what it always did.
  writeCatalogDefaults: z.boolean().catch(true),
  // Story 042 D7: which decoration a rendered file's section banners use. Defaults to `'dashes'`
  // (the User decision) - a missing/malformed value, including every profile persisted before
  // this deliverable, degrades to `'dashes'` rather than throwing, which is also today's only
  // format, so nothing already on disk renders any differently. No migration entry: purely
  // additive, same precedent as `writeUnbindall` right above.
  sectionHeaderStyle: z.enum(['dashes', 'brackets', 'plain']).catch('dashes'),
  // Story 043 D2: the file-read layer's cache (`main/modules/config/file-source.ts`). All four are
  // additive and forgiving, same precedent as `writeUnbindall`/`sectionHeaderStyle` above - no
  // migration entry, and a profile predating this deliverable simply has none of them, which reads
  // back as "no baseline yet" (`fileHash`/`fileSeenAt` absent), "not known dirty" (`dirty: false`)
  // and "no cached classification" (`fileState` absent).
  fileHash: z.string().optional().catch(undefined),
  fileSeenAt: z.number().finite().optional().catch(undefined),
  dirty: z.boolean().catch(false),
  fileState: z
    .enum(['unchanged', 'changedOnDisk', 'missing', 'unparseable', 'readError'])
    .optional()
    .catch(undefined),
  // Story 049 D1: the last-saved snapshot (`profileBaselinePersistedSchema` above). Additive and
  // forgiving in exactly the shape of `fileHash` right above - a profile persisted before this
  // story, or one whose canonical file has never been written, simply has no key here, and a
  // hand-mangled one degrades to the same absent value rather than dropping the profile. Both read
  // as "no known saved state": nothing is reported as unsaved and discard is unavailable, which is
  // the honest answer for one upgrade cycle (story 049, Decisions) - never a guessed baseline.
  baseline: profileBaselinePersistedSchema.optional().catch(undefined),
  // Story 066 D3: which handed template (if any) this profile was created from - additive and
  // forgiving in exactly the shape of `fileHash`/`fileState` above. A profile persisted before this
  // story, one created empty, or one created from an import simply has no key here; a hand-mangled
  // value degrades to absent rather than dropping the profile. `'template'` (this field's own
  // pre-split value) is deliberately not in the enum below - `ConfigProfileSeed` no longer has it
  // either, so a profile written by a launcher version old enough to have recorded it would find it
  // rejected and dropped here too, same as any other now-unrecognised value.
  seedFrom: z.enum(['template-right', 'template-left']).optional().catch(undefined),
})

/**
 * What this schema hands back: a `ConfigProfile` whose three forgiving array fields are guaranteed
 * present, because each of them degrades to `[]` rather than staying absent. Optional on
 * `ConfigProfile` (a profile written before the story that added them simply has no such key), but
 * never absent *after* a parse - so a caller reading a parsed profile does not have to re-check.
 */
export type PersistedConfigProfile = ConfigProfile & {
  layers: AltLayer[]
  categories: ConfigActionCategory[]
  actions: ConfigAction[]
  cvarSections: ConfigCvarSection[]
}

/**
 * Story 019: fill in every entry's own `kind` and drop the categories' legacy `entryKind`.
 *
 * This runs at profile level, not per row, for one reason: the derive needs the profile's
 * `categories`, and a row-level schema cannot see its siblings. It is a best-effort normalisation
 * done on every read, not a version-gated migration - hence no `STATE_SCHEMA_VERSION` bump - so it
 * has to be total: whatever a `state.json` says, every row that parsed keeps existing and comes out
 * with exactly one of the three kinds.
 *
 * The fallback chain per row: the row's own `kind` when it has a readable one (anything saved from
 * 019 on) -> its category's legacy `entryKind` -> `'bind'`. The last step covers all three of
 * "the category is a built-in one" (built-ins are never persisted rows, so they are simply absent
 * from the map), "the category row carries no `entryKind`" and "its `entryKind` was unreadable"
 * (already degraded to `undefined` by `legacyCategoryEntryKindSchema`) - a bind is the only kind an
 * entry of unknown type can safely be, since it is the one that stays bindable and renders as what
 * it always did.
 *
 * The return type is annotated rather than inferred: it is what keeps the two row schemas above -
 * which are no longer each annotated with their shared type - in sync with `ConfigProfile`.
 *
 * Review fix (Finding 1): deriving `kind` here can retype a legacy row to `alias` on a plain read,
 * outside `setActions`'s own strip-then-rewrite mirrors - so once every action's `kind` is settled,
 * this also strips any `binds` entry and any layer `overrides` entry that mirrors one of the
 * resulting alias actions (`stripAliasActionBinds`/`stripAliasActionOverrides`,
 * `@shared/config/aliases/modifier-layers`), the exact same value-based exclusion `setActions` and
 * `applyActionLayerMirror` already apply on the write path - not a second, divergent rule.
 *
 * Story 039 (D6): the pass order on this path is now, and must stay,
 * `kind` derive -> `migrateLegacyAliasReferences` -> `stripAliasActionBinds`/
 * `stripAliasActionOverrides` -> `adoptRawBinds`. The migration is first of the three bind passes
 * because the other two apply the current-format, key-scoped ownership rule, and applying it to a
 * pre-039 profile's `q2l_a_*` values is precisely the half-migrated state ("new ownership rules,
 * old references") the story exists to make unobservable.
 */
function normalizeConfigProfile(
  parsed: z.infer<typeof configProfileObjectSchema>,
): PersistedConfigProfile {
  const legacyKinds = new Map<string, ActionEntryKind>()
  for (const category of parsed.categories) {
    if (category.entryKind) legacyKinds.set(category.id, category.entryKind)
  }

  const actions = parsed.actions.map(({ kind, ...action }) => ({
    ...action,
    kind: kind ?? legacyKinds.get(action.categoryId) ?? 'bind',
  }))
  const aliasActions = actions.filter((action) => action.kind === 'alias')

  // Story 039 (D6): the *first* thing that touches `binds`/`overrides` on this path. Every later
  // pass here (the story 019 alias strip, `adoptRawBinds`) and everything downstream of the read
  // (the Controls grid, the conflict scans, the next save's mirrors) reasons about values in the
  // current format under the key-scoped ownership rule; a pre-039 profile's values are in the old
  // one. Migrating them first is what stops those two from ever being combined - the story's
  // "nothing is unbound in between". It has to run after the `kind` derive right above, because
  // both `legacyAliasNameFor` and `bindValueFor` branch on an action's kind.
  const migrated = migrateLegacyAliasReferences(parsed.binds, parsed.layers, actions)

  // Story 034: a raw catalogue bind becomes that row's own action here, on the
  // read path, not just on the next write - a `state.json` written before this
  // story (or one imported from a `config.cfg`, which is the same thing) has to
  // show up correctly in the Controls grid on the very first render, before the
  // user touches anything. `ProfilesStore.commit` runs the same pass on every
  // write, so the invariant holds in both directions; adoption is idempotent,
  // so running it twice costs a pass and changes nothing.
  const adopted = adoptRawBinds(
    {
      binds: stripAliasActionBinds(migrated.binds, aliasActions),
      layers: stripAliasActionOverrides(migrated.layers, aliasActions),
      actions,
    },
    randomUUID,
  )

  // Story 049 (review finding): complete a baseline written before `name` was part of the snapshot.
  // Only reachable here, at profile level - the baseline's own schema cannot see the sibling `name`,
  // exactly like the `kind` derive above cannot see `categories`. Taken out of the spread rather
  // than written over it, so "no baseline" stays an absent key instead of a present `undefined` one.
  const { baseline, ...rest } = parsed

  return {
    ...rest,
    ...(baseline ? { baseline: { ...baseline, name: baseline.name ?? parsed.name } } : {}),
    categories: parsed.categories.map(({ id, name, nameKey, subcategories }) => ({
      id,
      name,
      ...(nameKey ? { nameKey } : {}),
      subcategories,
    })),
    actions: adopted.actions,
    binds: adopted.binds,
    layers: adopted.layers,
  }
}

/** `PersistedConfigProfile` is a `ConfigProfile` whose forgiving array fields are always present. */
export const configProfileSchema: z.ZodType<PersistedConfigProfile, unknown> =
  configProfileObjectSchema.transform(normalizeConfigProfile)

/** installationId -> mod folder names the user has marked "played" for it. */
export const configPlayedModsSchema = z
  .record(
    z.string(),
    z.array(z.string()).catch(() => []),
  )
  .catch(() => ({}))

/**
 * installationId -> engine key name bound to story 007's in-session profile-switch chain.
 *
 * Story 079 D4 (review note): the sibling `configPendingWritesSchema` that used to live here
 * (installationId -> id of the profile whose last write attempt found it running) is retired - a
 * running game defers nothing now, so nothing is ever pending. Not migrated: an old `state.json`
 * still carrying that key simply has it ignored (`StateStore`'s `parse` no longer reads it), the
 * same forgiving "unknown key" handling every unrecognised top-level property already gets.
 */
export const configSwitchBindsSchema = z.record(z.string(), z.string()).catch(() => ({}))

export function parseConfigPlayedMods(raw: unknown): Record<string, string[]> {
  return configPlayedModsSchema.parse(raw)
}

export function parseConfigSwitchBinds(raw: unknown): Record<string, string> {
  return configSwitchBindsSchema.parse(raw)
}

/**
 * `<profileId>|<installationId|'own'>` -> the last failed/deferred write attempt for that target
 * (story 022, D5 - persisted only; nothing yet constructs or interprets the composite key). Files
 * written before this key existed simply lack it and load as `{}`.
 *
 * Unlike `configSwitchBindsSchema` above, where a single malformed value has no sensible per-entry
 * fallback and simply wipes the whole map via the outer `.catch()`,
 * a malformed failure entry is dropped on its own via a preprocess filter instead - the "row-level
 * drop" precedent `parseForgivingRows` uses for `categories`/`actions`, applied to a record instead
 * of an array. `configPlayedModsSchema`'s per-entry `.catch(() => [])` is not the right model here:
 * that has a meaningful fallback value (an installation with unreadable played-mods data behaves
 * like one with none), but there is no meaningful fallback for one corrupt failure entry other than
 * "it isn't there" - so it is filtered out before the record schema ever sees it, rather than
 * defaulted to a placeholder.
 */
const configWriteFailureEntrySchema = z.object({ messageKey: z.string(), at: z.string() })

export const configWriteFailuresSchema = z
  .preprocess(
    (raw) => {
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return raw
      return Object.fromEntries(
        Object.entries(raw as Record<string, unknown>).filter(
          ([, value]) => configWriteFailureEntrySchema.safeParse(value).success,
        ),
      )
    },
    z.record(z.string(), configWriteFailureEntrySchema),
  )
  .catch(() => ({}))

export function parseConfigWriteFailures(
  raw: unknown,
): Record<string, { messageKey: string; at: string }> {
  return configWriteFailuresSchema.parse(raw)
}

/**
 * Story 043 D3 (AC8): when the one-time canonical-file format migration completed, as an ISO
 * timestamp - `null` while it has not run yet. A **new top-level state key**, not a
 * `STATE_SCHEMA_VERSION` bump and no `MIGRATIONS` entry: the migration it guards is an *on-disk*
 * action (bring each profile's `.cfg` up to the 040/042 format), not a change to the shape of
 * `state.json`, so it follows `configPlayedMods`' "new key, no schema bump" precedent rather than
 * the schema-migration framework's.
 *
 * Forgiving in the one direction that is safe: anything unreadable degrades to `null`, i.e. "run
 * the migration again". Re-running it is idempotent (`writeTargetFile` diff-skips a file that
 * already matches), whereas defaulting a garbled value to "already migrated" would leave a
 * pre-043 file un-migrated forever with nothing to notice it.
 */
export const configFileSourceMigratedAtSchema = z.string().min(1).nullable().catch(null)

export function parseConfigFileSourceMigratedAt(raw: unknown): string | null {
  return configFileSourceMigratedAtSchema.parse(raw)
}

/** Parses one config profile, returning null (and dropping just that row) on failure. */
export function parseConfigProfile(raw: unknown): ConfigProfile | null {
  const result = configProfileSchema.safeParse(raw)
  return result.success ? result.data : null
}

/** A missing or non-array `configProfiles` key degrades to an empty list. */
export function parseConfigProfiles(raw: unknown): ConfigProfile[] {
  return parseForgivingRows(configProfileSchema, raw)
}

type WriteFailures = Record<string, { messageKey: string; at: string }>

const profilesSpec: StateSectionSpec<ConfigProfile[]> = {
  key: 'configProfiles',
  parse: parseConfigProfiles,
  defaults: () => [],
}
const playedModsSpec: StateSectionSpec<Record<string, string[]>> = {
  key: 'configPlayedMods',
  parse: parseConfigPlayedMods,
  defaults: () => ({}),
}
const switchBindsSpec: StateSectionSpec<Record<string, string>> = {
  key: 'configSwitchBinds',
  parse: parseConfigSwitchBinds,
  defaults: () => ({}),
}
const writeFailuresSpec: StateSectionSpec<WriteFailures> = {
  key: 'configWriteFailures',
  parse: parseConfigWriteFailures,
  defaults: () => ({}),
}
const fileSourceMigratedAtSpec: StateSectionSpec<string | null> = {
  key: 'configFileSourceMigratedAt',
  parse: parseConfigFileSourceMigratedAt,
  defaults: () => null,
}

export interface FileSourceMigratedAtSection extends StateSection<string | null> {
  /**
   * Records that the one-time canonical-file migration has completed.
   *
   * **Write-once, on purpose.** An already-set value is returned unchanged and nothing is
   * persisted, so no caller - including a future one - can reset the guard and make the migration
   * run a second time over files that are, by then, the source of truth and may carry hand-edits
   * the cache never saw. The one legitimate way to re-run it is a `state.json` that genuinely has
   * no value yet (a fresh install, or a hand-cleared key), which is exactly what
   * `parseConfigFileSourceMigratedAt` produces for an absent/garbled key.
   */
  markDone(at: string): string | null
}

/** The config module's persisted state; the same handles on every call for one store. */
export function configState(state: StateStore): {
  profiles: StateSection<ConfigProfile[]>
  playedMods: StateSection<Record<string, string[]>>
  switchBinds: StateSection<Record<string, string>>
  writeFailures: StateSection<WriteFailures>
  fileSourceMigratedAt: FileSourceMigratedAtSection
} {
  const migratedAt = state.section(fileSourceMigratedAtSpec)
  return {
    profiles: state.section(profilesSpec),
    playedMods: state.section(playedModsSpec),
    switchBinds: state.section(switchBindsSpec),
    writeFailures: state.section(writeFailuresSpec),
    fileSourceMigratedAt: {
      ...migratedAt,
      markDone: (at) => migratedAt.get() ?? migratedAt.update(() => at),
    },
  }
}
