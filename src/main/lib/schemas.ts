import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { AltLayer } from '@shared/config/alt-layers'
import { adoptRawBinds } from '@shared/config/bind-adoption'
import {
  stripAliasActionBinds,
  stripAliasActionOverrides,
  type ModifierTrigger,
} from '@shared/config/modifier-layers'
import type {
  ActionEntryKind,
  ConfigAction,
  ConfigActionCategory,
  ConfigProfile,
} from '@shared/modules/config'
import { isLatin1Text } from '@shared/config/q2-charset'
import { engineKindSchema, settingsObjectSchema, sourceSchema } from '@shared/schemas'
import type { Installation, LauncherSettings, WindowState } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/types'
import {
  WINDOW_DEFAULT_HEIGHT,
  WINDOW_DEFAULT_WIDTH,
  WINDOW_MIN_HEIGHT,
  WINDOW_MIN_WIDTH,
} from '@shared/constants'

/**
 * Runtime validation for everything that crosses a trust boundary: the state
 * file on disk (which a user may have hand-edited) and every IPC payload from
 * the renderer.
 *
 * Persisted schemas are deliberately forgiving - `.catch()` on each field means
 * one bad value degrades to its default instead of wiping the whole file. The
 * only strictly required fields are the ones without which a record is
 * meaningless (`id`, `rootPath`); rows missing those are dropped individually.
 */

const nowIso = (): string => new Date().toISOString()

const paramsSchema = z.record(z.string(), z.union([z.string(), z.number()]))

const statusSchema = z.enum(['ok', 'warning', 'invalid', 'missing', 'unknown'])

const checkSchema = z.object({
  id: z.enum([
    'root-exists',
    'base-game-dir',
    'base-paks',
    'executable',
    'engine-identified',
    'write-access',
  ]),
  severity: z.enum(['ok', 'warn', 'error']),
  messageKey: z.string(),
  params: paramsSchema.optional(),
  fix: z
    .enum(['locate-root', 'select-executable', 'set-write-dir', 'revalidate', 'install-game-files'])
    .optional(),
})

const installationSchema = z.object({
  id: z.string().min(1),
  rootPath: z.string().min(1),
  name: z.string().min(1).catch('Quake II'),
  writeDirPath: z.string().optional(),
  engineKind: engineKindSchema.catch('unknown'),
  executablePath: z.string().optional(),
  launchArgs: z.array(z.string()).catch([]),
  activeGameDir: z.string().catch(''),
  detectedVersion: z.string().optional(),
  source: sourceSchema.catch('unknown'),
  // Health is re-derived on startup, so a stale value here is harmless.
  status: statusSchema.catch('unknown'),
  checks: z.array(checkSchema).catch([]),
  gameDirs: z.array(z.string()).catch([]),
  favorite: z.boolean().catch(false),
  sortOrder: z.number().finite().catch(0),
  createdAt: z.string().catch(nowIso),
  updatedAt: z.string().catch(nowIso),
  lastValidatedAt: z.string().optional(),
  lastPlayedAt: z.string().optional(),
  totalPlaytimeSeconds: z.number().finite().nonnegative().catch(0),
  moduleData: z.record(z.string(), z.unknown()).optional(),
})

/**
 * One persisted `AltLayer` entry. Typed against the shared `AltLayer` shape so
 * the two stay in sync; not the same schema as
 * `main/modules/config/schemas.ts`'s `setProfileLayersInputSchema` - that one
 * is the strict IPC payload, this one is the forgiving persisted-state shape
 * used only via `configProfileSchema`'s `layers` field below.
 */
const altLayerPersistedSchema: z.ZodType<AltLayer> = z.object({
  id: z.string(),
  name: z.string(),
  mode: z.enum(['hold', 'toggle']),
  // Story 011: `null` means "no trigger assigned yet". A missing/malformed
  // value degrades to `null` (same forgiving convention as the rest of this
  // schema) rather than failing the whole row; a pre-011 string value passes
  // through unchanged.
  triggerKey: z.string().nullable().catch(null),
  overrides: z.record(z.string(), z.string()),
})

/**
 * Story 008: one persisted `ConfigActionCategory`/`ConfigAction`/`ConfigCommand` row -
 * structurally the strict shapes `main/modules/config/schemas.ts`'s
 * `configActionCategorySchema`/`configActionSchema`/`configCommandSchema` describe, but this file
 * follows the "forgiving, drop what fails" convention rather than "throw on bad payload": a
 * malformed row - including a command whose text fails the latin-1/no-quote rule, checked here
 * directly via `isLatin1Text` rather than by importing the strict module's `actionTextSchema` -
 * simply fails this row's `.safeParse` in `parseForgivingRows` below and is dropped alone. Unlike
 * `layers` right above, which degrades the *whole* field to `[]` via `.catch(() => [])`, this
 * story's own acceptance criterion requires row-level dropping: one bad row among several good
 * ones must not wipe the rest.
 */
const persistedActionTextSchema = z
  .string()
  .refine((value) => isLatin1Text(value) && !value.includes('"'))

const configCommandPersistedSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('raw'), text: persistedActionTextSchema }),
  z.object({
    kind: z.literal('message'),
    channel: z.enum(['say', 'say_team']),
    text: persistedActionTextSchema,
  }),
])

/** Story 019: what one entry is. Same vocabulary as the strict IPC schema's
 * `actionEntryKindSchema`. */
const actionEntryKindPersistedSchema = z.enum(['bind', 'message', 'alias'])

/**
 * Story 019: story 008's per-category entry kind. The field is gone from `ConfigActionCategory`,
 * but it is still *accepted* here - and forgivingly so (`.optional().catch(undefined)`, so even a
 * hand-mangled `entryKind: 42` cannot fail the row) - because dropping a whole category row over a
 * field the type no longer has would delete a user's drawer and every entry pointing at it.
 * `normalizeConfigProfile` below reads it to derive each entry's own `kind` and then leaves it out
 * of the parsed output: it exists on disk, never in memory.
 */
const legacyCategoryEntryKindSchema = actionEntryKindPersistedSchema.optional().catch(undefined)

const configActionCategoryPersistedSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  entryKind: legacyCategoryEntryKindSchema,
})

// Story 016 (D6): same modifier vocabulary as the strict IPC schema
// (`main/modules/config/schemas.ts`'s `modifierTriggerSchema`), but forgiving - an
// unrecognized or malformed value degrades to `undefined` via `.catch()` rather than
// dropping the whole action row the way an invalid `commands` entry would.
const modifierTriggerPersistedSchema: z.ZodType<ModifierTrigger | undefined> = z
  .enum(['ALT', 'CTRL', 'SHIFT'])
  .optional()
  .catch(undefined)

const configActionPersistedSchema = z.object({
  id: z.string().min(1),
  categoryId: z.string().min(1),
  name: z.string().min(1),
  commands: z.array(configCommandPersistedSchema),
  // Story 019: required on the type, deliberately optional-and-forgiving here - every row written
  // before 019 simply has no `kind`, and an unreadable one carries no information either. Both end
  // up `undefined` and are filled in by `normalizeConfigProfile`, which is the only place that can
  // see the sibling `categories` the derive needs. A row is never dropped over this field.
  kind: actionEntryKindPersistedSchema.optional().catch(undefined),
  key: z.string().optional(),
  // Story 015: same two additive fields as the strict IPC schema, and forgiving in
  // the same way `key` is here - no length or non-empty rule, because a persisted
  // row that merely carries an odd key must not be dropped along with its commands.
  secondaryKey: z.string().optional(),
  catalogId: z.string().optional(),
  // Story 016 (D6): the modifier held during capture of `key`/`secondaryKey`. A
  // pre-016 row simply omits both, same as every other optional field here.
  keyModifier: modifierTriggerPersistedSchema,
  secondaryKeyModifier: modifierTriggerPersistedSchema,
})

/**
 * Parses `raw` as an array, keeping only the elements that pass `schema` and dropping the rest -
 * the row-level counterpart to a whole-field `.catch()`. Same idea as `parseInstallations`/
 * `parseConfigProfiles` below, generalized so `categories` and `actions` can reuse it instead of
 * duplicating the map-safeParse-filter dance.
 */
function parseForgivingRows<T>(schema: z.ZodType<T>, raw: unknown): T[] {
  const rows = z.array(z.unknown()).catch([]).parse(raw)
  return rows
    .map((row) => schema.safeParse(row))
    .filter((result): result is z.ZodSafeParseSuccess<T> => result.success)
    .map((result) => result.data)
}

/**
 * A persisted config profile. Same rules as `installationSchema`: only the
 * fields without which the record is meaningless (`id`, `name`) are strict, so
 * a hand-mangled profile is dropped on its own instead of taking the file - or
 * the installation list - with it.
 */
const configProfileObjectSchema = z.object({
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
 * `@shared/config/modifier-layers`), the exact same value-based exclusion `setActions` and
 * `applyActionLayerMirror` already apply on the write path - not a second, divergent rule.
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

  // Story 034: a raw catalogue bind becomes that row's own action here, on the
  // read path, not just on the next write - a `state.json` written before this
  // story (or one imported from a `config.cfg`, which is the same thing) has to
  // show up correctly in the Controls grid on the very first render, before the
  // user touches anything. `ProfilesStore.commit` runs the same pass on every
  // write, so the invariant holds in both directions; adoption is idempotent,
  // so running it twice costs a pass and changes nothing.
  const adopted = adoptRawBinds(
    {
      binds: stripAliasActionBinds(parsed.binds, aliasActions),
      layers: stripAliasActionOverrides(parsed.layers, aliasActions),
      actions,
    },
    randomUUID,
  )

  return {
    ...parsed,
    categories: parsed.categories.map(({ id, name }) => ({ id, name })),
    actions: adopted.actions,
    binds: adopted.binds,
    layers: adopted.layers,
  }
}

export const configProfileSchema = configProfileObjectSchema.transform(normalizeConfigProfile)

/** installationId -> mod folder names the user has marked "played" for it. */
export const configPlayedModsSchema = z
  .record(
    z.string(),
    z.array(z.string()).catch(() => []),
  )
  .catch(() => ({}))

/** installationId -> id of the profile whose last write attempt found it running. */
export const configPendingWritesSchema = z.record(z.string(), z.string()).catch(() => ({}))

/** installationId -> engine key name bound to story 007's in-session profile-switch chain. */
export const configSwitchBindsSchema = z.record(z.string(), z.string()).catch(() => ({}))

export function parseConfigPlayedMods(raw: unknown): Record<string, string[]> {
  return configPlayedModsSchema.parse(raw)
}

export function parseConfigPendingWrites(raw: unknown): Record<string, string> {
  return configPendingWritesSchema.parse(raw)
}

export function parseConfigSwitchBinds(raw: unknown): Record<string, string> {
  return configSwitchBindsSchema.parse(raw)
}

/**
 * `<profileId>|<installationId|'own'>` -> the last failed/deferred write attempt for that target
 * (story 022, D5 - persisted only; nothing yet constructs or interprets the composite key). Files
 * written before this key existed simply lack it and load as `{}`.
 *
 * Unlike `configPendingWritesSchema`/`configSwitchBindsSchema` above, where a single malformed
 * value has no sensible per-entry fallback and simply wipes the whole map via the outer `.catch()`,
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
  .preprocess((raw) => {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return raw
    return Object.fromEntries(
      Object.entries(raw as Record<string, unknown>).filter(
        ([, value]) => configWriteFailureEntrySchema.safeParse(value).success,
      ),
    )
  }, z.record(z.string(), configWriteFailureEntrySchema))
  .catch(() => ({}))

export function parseConfigWriteFailures(raw: unknown): Record<string, { messageKey: string; at: string }> {
  return configWriteFailuresSchema.parse(raw)
}

export const settingsSchema = settingsObjectSchema.catch(() => ({ ...DEFAULT_SETTINGS }))

export const windowStateSchema = z
  .object({
    x: z.number().finite().optional(),
    y: z.number().finite().optional(),
    width: z.number().finite().min(WINDOW_MIN_WIDTH).catch(WINDOW_DEFAULT_WIDTH),
    height: z.number().finite().min(WINDOW_MIN_HEIGHT).catch(WINDOW_DEFAULT_HEIGHT),
    maximized: z.boolean().catch(false),
    fullScreen: z.boolean().catch(false),
  })
  .catch(() => ({
    width: WINDOW_DEFAULT_WIDTH,
    height: WINDOW_DEFAULT_HEIGHT,
    maximized: false,
    fullScreen: false,
  }))

/** Return types are annotated so the schemas must stay in sync with the domain types. */
export function parseSettings(raw: unknown): LauncherSettings {
  return settingsSchema.parse(raw)
}

export function parseWindowState(raw: unknown): WindowState {
  return windowStateSchema.parse(raw)
}

/** Parses one installation, returning null (and dropping just that row) on failure. */
export function parseInstallation(raw: unknown): Installation | null {
  const result = installationSchema.safeParse(raw)
  return result.success ? result.data : null
}

export function parseInstallations(raw: unknown): Installation[] {
  const rows = z.array(z.unknown()).catch([]).parse(raw)
  return rows.map(parseInstallation).filter((row): row is Installation => row !== null)
}

/** Parses one config profile, returning null (and dropping just that row) on failure. */
export function parseConfigProfile(raw: unknown): ConfigProfile | null {
  const result = configProfileSchema.safeParse(raw)
  return result.success ? result.data : null
}

/** A missing or non-array `configProfiles` key degrades to an empty list. */
export function parseConfigProfiles(raw: unknown): ConfigProfile[] {
  const rows = z.array(z.unknown()).catch([]).parse(raw)
  return rows.map(parseConfigProfile).filter((row): row is ConfigProfile => row !== null)
}

// IPC-payload schemas moved to `src/shared/ipc-schemas.ts` (story 036, D1) -
// they are strict (a bad payload is a bug, not a state to repair) and shared
// needs them for the preload/renderer side too.
