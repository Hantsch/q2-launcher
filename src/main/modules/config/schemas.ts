import { z } from 'zod'
import { NAMED_KEYS, normalizeBindKey } from '@shared/config/key-names'
import {
  actionEntryKindSchema,
  actionEntryPartObjectSchema,
  actionKeySlotObjectSchema,
  actionTextSchema,
  altLayerObjectSchema,
  configActionCategoryObjectSchema,
  configActionObjectSchema,
  configActionSubcategoryObjectSchema,
  configCommandSchema,
  configCvarSectionObjectSchema,
  configCvarSubsectionObjectSchema,
  refineActionParts,
} from '@shared/config/profile-schema'
import type { TidyUpOp } from '@shared/config/tidy-up'
import type { ConfigCvarSection, TidyUpApplyInput } from '@shared/modules/config'

/**
 * IPC payload validation for the config module's own handlers.
 *
 * These are strict, same convention as the installation payload schemas in
 * `main/lib/schemas.ts`: a bad payload here is a caller bug, not a state to
 * repair, so a handler lets `.parse()` throw rather than catching it.
 */

/** `CONFIG_HANDLERS.list` takes no payload. */
export const listInputSchema = z.void()

export const createConfigProfileInputSchema = z.object({
  name: z.string().min(1).max(120),
  // Story 066 D3: `ConfigProfileSeed` split `'template'` into `'template-right'`/`'template-left'`
  // (@shared/modules/config) - this enum mirrors that split so it cannot drift from the type it
  // validates.
  from: z.enum(['empty', 'template-right', 'template-left']),
})

export const renameConfigProfileInputSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120),
})

export const removeConfigProfileInputSchema = z.object({
  id: z.string().min(1),
})

/**
 * The three assignment payloads are shape-identical (`profileId` +
 * `installationId`), so they alias one schema rather than duplicate it.
 */
export const assignProfileInputSchema = z.object({
  profileId: z.string().min(1),
  installationId: z.string().min(1),
})

export const unassignProfileInputSchema = assignProfileInputSchema
export const setDefaultProfileInputSchema = assignProfileInputSchema

/**
 * The cvar sub-section/section shapes come from the shared profile schema; this side adds the IPC
 * caps. The cvar-name lists are a generous sanity ceiling (an imported file's single big section can
 * legitimately hold far more than 64 names), not a structural cap - the structural cap is on
 * `subsections`.
 */
const configCvarSubsectionSchema = configCvarSubsectionObjectSchema.extend({
  name: z.string().min(1).max(120),
  cvars: z.array(z.string().min(1)).max(512),
})

const configCvarSectionSchema: z.ZodType<ConfigCvarSection> = configCvarSectionObjectSchema.extend({
  name: z.string().min(1).max(120),
  cvars: z.array(z.string().min(1)).max(512),
  subsections: z.array(configCvarSubsectionSchema).max(64).optional(),
})

/**
 * Structural validation only - a cvar name must be a non-empty string, same as
 * a cvar value. This deliberately does not validate cvar-name semantics (that
 * is a later story's job); it only rejects garbage shapes before they reach
 * `ProfilesStore`.
 *
 * `cvarSections` (story 059 D1) is optional - a caller not yet sending the profile's own sections
 * (every renderer call site before a later deliverable wires this up) simply omits it, capped at 64
 * sections same as `setProfileActionsInputSchema`'s own `categories` cap.
 */
export const setProfileCvarsInputSchema = z.object({
  profileId: z.string().min(1),
  cvars: z.record(z.string().min(1), z.string()),
  cvarSections: z.array(configCvarSectionSchema).max(64).optional(),
})

/** Story 175 D1: at most this many cvars in one `commitCvars` call - a commit names a handful of
 * cvars the user just chose (an address list), never a whole profile's cvar map. */
export const MAX_COMMIT_CVARS = 9

/**
 * Story 175 D1: `commitCvars`' payload. The same structural cvar name/value rules as
 * `setProfileCvarsInputSchema` above, plus: the map must name at least one cvar (committing nothing
 * would still be a disk write) and at most `MAX_COMMIT_CVARS`.
 */
export const commitProfileCvarsInputSchema = z.object({
  profileId: z.string().min(1),
  cvars: z.record(z.string().min(1), z.string()).refine((cvars) => {
    const count = Object.keys(cvars).length
    return count >= 1 && count <= MAX_COMMIT_CVARS
  }, `expected between 1 and ${MAX_COMMIT_CVARS} cvars`),
})

/** Structural validation only, same rationale as `setProfileCvarsInputSchema` above. */
export const setProfileBindsInputSchema = z.object({
  profileId: z.string().min(1),
  binds: z.record(z.string().min(1), z.string()),
})

/**
 * One `AltLayer`, validated strictly - a bad payload here is a caller bug and `.parse()` throws,
 * while the persisted schema degrades a mangled value instead. `triggerKey` `null` means "no trigger
 * assigned yet"; `.min(1)` rejects `''` but deliberately stops short of the key vocabulary check
 * (the board's key set is not proven identical to `NAMED_KEYS`).
 */
const altLayerSchema = altLayerObjectSchema.extend({
  id: z.string().min(1),
  name: z.string().min(1),
  triggerKey: z.string().min(1).nullable(),
  overrides: z.record(z.string().min(1), z.string()),
})

export const setProfileLayersInputSchema = z.object({
  profileId: z.string().min(1),
  layers: z.array(altLayerSchema).max(64),
})

export { actionTextSchema }

const configActionSubcategorySchema = configActionSubcategoryObjectSchema.extend({
  name: z.string().min(1).max(120),
})

const configActionCategorySchema = configActionCategoryObjectSchema.extend({
  name: z.string().min(1).max(120),
  subcategories: z.array(configActionSubcategorySchema).max(64).optional(),
})

const actionEntryPartSchema = actionEntryPartObjectSchema.extend({
  commands: z.array(configCommandSchema).max(64),
  label: z.string().max(120).optional(),
  aliasName: z.string().min(1).optional(),
})

const actionKeySlotSchema = actionKeySlotObjectSchema.extend({
  key: z.string().max(20),
})

// A payload is never trusted, so `kind` is required and never defaulted here (the forgiving derive
// lives only in the persisted schema). Dropping and re-declaring the capped keys keeps the output
// key order of the IPC tree (`kind` before `commands`), which callers serialise.
export const configActionSchema = configActionObjectSchema
  .omit({
    name: true,
    commands: true,
    kind: true,
    keys: true,
    catalogId: true,
    aliasName: true,
    parts: true,
    subcategoryId: true,
  })
  .extend({
    subcategoryId: z.string().min(1).optional(),
    name: z.string().min(1).max(120),
    kind: actionEntryKindSchema,
    commands: z.array(configCommandSchema).max(64),
    keys: z.array(actionKeySlotSchema).max(64).optional(),
    catalogId: z.string().min(1).optional(),
    aliasName: z.string().min(1).optional(),
    parts: z.array(actionEntryPartSchema).optional(),
  })
  .superRefine(refineActionParts)

export const setProfileActionsInputSchema = z.object({
  profileId: z.string().min(1),
  categories: z.array(configActionCategorySchema).max(64),
  actions: z.array(configActionSchema).max(500),
})

/**
 * Story 079 D8: `write`'s payload gains an optional `installationId` - shape-only here (a non-empty
 * string), same as every other `installationId` field in this file (`assignProfileInputSchema`
 * etc.): whether it actually names a known installation is data (`app.installations`), not shape,
 * so that check lives in the handler, same division of labour those schemas already use.
 */
export const writeProfileInputSchema = z.object({
  profileId: z.string().min(1),
  installationId: z.string().min(1).optional(),
})

/**
 * Story 043 (D4/D8): `save`'s input - a profile id plus `force` (D8), the "overwrite with my
 * version" resolution of `ConfigConflictDialog`: when true, the handler skips the
 * re-read/conflict check and writes unconditionally. No longer a bare alias of
 * `writeProfileInputSchema` now that it carries its own optional field.
 */
export const saveProfileInputSchema = z.object({
  profileId: z.string().min(1),
  force: z.boolean().optional(),
})

/**
 * Story 057 D4: how much text one `saveRawText` call may carry - a bounding-one-payload's-work cap
 * in the same spirit as `setProfileActionsInputSchema`'s 500 actions, sized for a *file* rather than
 * a field. A canonical profile `.cfg` the launcher writes is a few kilobytes; the largest
 * hand-written Quake II config anyone has ever produced is orders of magnitude below this, so the
 * cap can only ever reject a payload that is not a config file at all.
 */
export const MAX_RAW_CONFIG_TEXT_LENGTH = 1_000_000

/**
 * Story 057 D4: `saveRawText`'s payload - the whole file the Raw file tab's editor holds, plus the
 * same `force` bypass `saveProfileInputSchema` above carries, and no path (see `SaveRawTextInput`).
 *
 * Deliberately shape-and-size only. The two content rules the story names - the ownership tag and
 * latin-1 - are checked in the handler instead, with their own i18n keys: both are things the *user*
 * can do to their own text in an editor, and a caller bug (which is all this schema's `.parse()`
 * throw can mean, per this file's own convention) is exactly what they are not. `z.string()` without
 * `.min(1)` on purpose: emptying the file is a legitimate edit, and the ownership check below is what
 * actually rejects it.
 */
export const saveRawTextInputSchema = z.object({
  profileId: z.string().min(1),
  text: z.string().max(MAX_RAW_CONFIG_TEXT_LENGTH),
  force: z.boolean().optional(),
})

/** Story 022 (D7): `writeState` takes no payload, same pattern as `listInputSchema` above. */
export const writeStateInputSchema = z.void()

/**
 * Story 043 (D5/D8): `refreshFromFiles`' payload - an optional profile id, so a missing/undefined
 * `profileId` means "check every profile" (main's own logic, not this schema's job to default),
 * plus `discardLocalEdits` (D8): the "take the file" resolution of `ConfigConflictDialog`.
 */
export const refreshFromFilesInputSchema = z.object({
  profileId: z.string().min(1).optional(),
  discardLocalEdits: z.boolean().optional(),
})

/** Story 022 (D5): `syncState`'s input is shape-identical to `write`'s, same alias convention as
 * `unassignProfileInputSchema`/`setDefaultProfileInputSchema` above. */
export const syncStateInputSchema = writeProfileInputSchema

/** Story 023 (D1): `rawFiles`' input is shape-identical to `write`'s/`syncState`'s. */
export const rawFilesInputSchema = writeProfileInputSchema

/**
 * Story 023 (D2): which of a profile's files to open or reveal, addressed by ids only - a
 * nullable `installationId` (null = the profile's own canonical file) plus the action.
 * Deliberately has no path field at all: the handler resolves the real path from main's own
 * state, so there is nothing here a renderer could aim at another file.
 *
 * `null` is spelled with `.nullable()` rather than made optional, same convention as
 * `setSwitchBindInputSchema`'s `key` above: "the profile's own file" is an explicit choice a
 * caller states, not a value it may forget.
 */
export const openFileInputSchema = z.object({
  profileId: z.string().min(1),
  installationId: z.string().min(1).nullable(),
  mode: z.enum(['open', 'reveal']),
})

export const previewProfileInputSchema = z.object({
  profileId: z.string().min(1),
  installationId: z.string().min(1),
})

export const setPlayedModsInputSchema = z.object({
  installationId: z.string().min(1),
  playedMods: z.array(z.string().min(1)).max(64),
})

/**
 * Story 007's key vocabulary: a known named key (`NAMED_KEYS`, the same list
 * the keyboard overview and the config parser agree on) or a single printable
 * ASCII character, normalized via `normalizeBindKey` so casing differences
 * (`f9`/`F9`) land on the same value. Anything else - a multi-character token
 * that isn't a named key, control characters, non-ASCII - is rejected.
 *
 * The single-character branch additionally excludes space, `"`, `$` and `;`
 * (review finding, story 007): those pass a plain "printable ASCII" test but
 * `switch-bind.ts`'s own `sanitizeKeyName` strips every one of them before
 * emitting the chain (the same reasons `alt-layers.ts` sanitizes command
 * bodies - `;` ends a step's command list early, `$` triggers macro
 * expansion, `"` cannot be escaped, and a bare space is not a key token at
 * all). Accepting one of these here would let this schema call a key "valid"
 * while the generator silently reduces it to an empty key and emits no chain
 * at all - a write that reports success and does nothing, so this schema must
 * reject exactly what the generator cannot use rather than only what looks
 * unprintable.
 */
const switchBindKeySchema = z
  .string()
  .min(1)
  .max(20)
  .transform((raw) => normalizeBindKey(raw.trim()))
  .refine(
    (key) =>
      (NAMED_KEYS as readonly string[]).includes(key) ||
      (/^[\x21-\x7e]$/.test(key) && !/["$;]/.test(key)),
    'unknown key name',
  )

export const setSwitchBindInputSchema = z.object({
  installationId: z.string().min(1),
  key: switchBindKeySchema.nullable(),
})

/** Story 007: `switchBinds` takes no payload, same pattern as `listInputSchema` above. */
export const switchBindsInputSchema = z.void()

/**
 * Story 040 D4: `setWriteUnbindall`'s payload. Strict, same convention as every other config-module
 * IPC schema in this file - a bad payload is a caller bug, not a state to repair.
 */
export const setWriteUnbindallInputSchema = z.object({
  profileId: z.string().min(1),
  writeUnbindall: z.boolean(),
})

/**
 * Story 059 D9: `setWriteCatalogDefaults`'s payload. Same strict convention as
 * `setWriteUnbindallInputSchema` right above - a bad payload is a caller bug, not a state to
 * repair.
 */
export const setWriteCatalogDefaultsInputSchema = z.object({
  profileId: z.string().min(1),
  writeCatalogDefaults: z.boolean(),
})

/**
 * Story 042 D7: `setSectionHeaderStyle`'s payload. Same strict convention as
 * `setWriteUnbindallInputSchema` right above - a bad payload is a caller bug, not a state to
 * repair.
 */
export const setSectionHeaderStyleInputSchema = z.object({
  profileId: z.string().min(1),
  sectionHeaderStyle: z.enum(['dashes', 'brackets', 'plain']),
})

/**
 * Story 049 (D3): `discard`'s payload - a profile id, nothing else (see `DiscardProfileInput`'s own
 * doc comment for why). Same strict convention as every other config-module IPC schema in this
 * file.
 */
export const discardProfileInputSchema = z.object({
  profileId: z.string().min(1),
})

/**
 * Story 066 D3: how many `PickedConfigFile` ids one `import.previewFiles`/`import.commitFiles` call
 * may fold. There is no existing precedent for a list-of-ids-from-a-native-picker payload in this
 * file to mirror exactly, so this is a fresh, generous sanity ceiling in the same spirit as
 * `cleanupApplyInputSchema`'s 256 entries and `layerAliases`' 256 above: a real multi-select pick of
 * a player's own config files is a handful, never more than a few dozen, so this can only ever
 * reject a payload that could not be a genuine pick.
 */
export const MAX_IMPORT_FILE_IDS = 64

/**
 * Shape-only: a non-empty array of non-empty id strings, capped at `MAX_IMPORT_FILE_IDS`. Whether
 * a given id actually names a file this session's picker registry knows about is not a shape
 * question - it depends on data (`picked-files.ts`'s session map) this schema never sees - so that
 * check belongs to the handler, the same division of labour `importFilesCommitInputSchema`'s own
 * doc comment describes for its `layerAliases` ambiguous-alias check below.
 */
const fileIdsSchema = z.array(z.string().min(1)).min(1).max(MAX_IMPORT_FILE_IDS)

/**
 * Story 066 D5: `import.pickFiles` takes no payload - the picker's starting folder is main's own
 * business (`./index.ts` derives it from the selected installation), and the whole point of the
 * flow is that the renderer contributes no path to it. Same `z.void()` pattern as
 * `listInputSchema`/`switchBindsInputSchema` above.
 */
export const importPickFilesInputSchema = z.void()

/**
 * Story 066 D3: `import.previewFiles`'s payload - `ImportFilesPreviewInput`'s shared shape,
 * addressed entirely by `fileIds` (the ordered list of picked-file ids to fold left-to-right), never
 * a path.
 */
export const importFilesPreviewInputSchema = z.object({
  fileIds: fileIdsSchema,
})

/**
 * Story 066 D3: `import.commitFiles`'s payload - `ImportFilesCommitInput`'s shared shape. Same
 * `fileIds` addressing as `importFilesPreviewInputSchema` above, plus the new profile's `name` and
 * the optional `layerAliases` (story 041 D6's "attempt as layer" choice - shape-only here, since
 * the ambiguous-list cross-check needs the parsed import result, which this schema never sees; that
 * check lives in `commitImportFiles`, `main/modules/config/import.ts`).
 */
export const importFilesCommitInputSchema = z.object({
  fileIds: fileIdsSchema,
  name: z.string().min(1).max(120),
  layerAliases: z.array(z.string().min(1)).max(256).optional(),
})

/**
 * Story 010 cleanup payloads. Structural validation only, same rationale as
 * `setProfileCvarsInputSchema` above: `cleanup.ts`'s own `entryIsTrusted` is
 * the real path-trust boundary (gamedir-ownership, `baseq2` exclusion, the
 * `BARE_CFG_NAME` shape), so a bad payload here is a caller bug, not a state
 * to repair - hence `.safeParse()` + `fail('ipc.error.invalidPayload')` at the
 * handler, not a `.parse()` throw.
 *
 * `gameDir` is capped at 64, the same generous bound the old installation-addressed import
 * payloads used. `fileName` is capped more generously (128) than a typical cfg name needs, but still well
 * above anything `cleanup.ts`'s `BARE_CFG_NAME` regex could ever match on a
 * real filesystem, so the cap never rejects a name the scan itself produced.
 */
const cleanupEntrySchema = z.object({
  gameDir: z.string().min(1).max(64),
  fileName: z.string().min(1).max(128),
})

export const cleanupScanInputSchema = z.object({
  installationId: z.string().min(1),
})

/** Capped at 256 entries - well above a real mod-folder's `.cfg` count, but bounds one payload's work. */
export const cleanupApplyInputSchema = z.object({
  installationId: z.string().min(1),
  entries: z.array(cleanupEntrySchema).max(256),
})

export const cleanupRestoreInputSchema = cleanupApplyInputSchema

/**
 * Story 025 D3: `tidyUp.apply`'s payload - one profile id plus a batch of
 * `TidyUpOp` descriptors (`@shared/config/tidy-up`).
 *
 * Structural validation only, and deliberately so: this schema's job is to keep
 * a garbage *shape* out of the applier, not to decide whether an op is
 * applicable. That decision belongs to `applyTidyUpOps`, which re-checks every
 * op against the profile's current state and returns the stale ones in
 * `rejected` (decision 11) - a rule duplicated here would either drift from it
 * or turn a "no longer applicable" into a hard `invalidPayload` failure for the
 * whole batch. Same division of labour `cleanupApplyInputSchema` has with
 * `cleanup.ts`'s own `entryIsTrusted`/re-scan guard, and the same
 * `.safeParse()` + `fail('ipc.error.invalidPayload')` handling at the handler.
 *
 * Typed as `z.ZodType<TidyUpApplyInput>` so the schema and the contract type
 * cannot drift apart (same reasoning as `modifierTriggerSchema` above).
 *
 * Ops are capped at 200 per call - the same bounding-one-payload's-work
 * reasoning as `setProfileActionsInputSchema`'s 500 actions and
 * `cleanupApplyInputSchema`'s 256 entries, and well above what the Care tab can
 * put on screen at once.
 */
const tidyUpBindScopeSchema = z.union([z.literal('base'), z.object({ layerId: z.string().min(1) })])

const tidyUpBindClaimSchema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('baseBind'), command: z.string() }),
  z.object({
    source: z.literal('action'),
    actionId: z.string().min(1),
    slot: z.number().int().nonnegative(),
  }),
  z.object({ source: z.literal('layerOverride'), command: z.string() }),
])

const tidyUpReclassifyTargetSchema = z.discriminatedUnion('field', [
  z.object({ field: z.literal('cvars'), name: z.string().min(1), value: z.string() }),
  z.object({ field: z.literal('binds'), key: z.string().min(1).max(20), command: z.string() }),
  z.object({ field: z.literal('actions'), action: configActionSchema }),
])

/** A preserved line's identity: all three of `file`/`line`/`text` together, the
 * same triple `UnrecognizedConfigLine` carries and `applyTidyUpOps` matches on
 * exactly (a line has no id of its own). */
const preservedLineRefFields = {
  file: z.string().min(1).max(128),
  line: z.number().int().nonnegative(),
  text: z.string(),
}

const tidyUpOpSchema: z.ZodType<TidyUpOp> = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('removeShadowedBind'),
    scope: tidyUpBindScopeSchema,
    key: z.string().min(1).max(20),
    claim: tidyUpBindClaimSchema,
  }),
  z.object({ kind: z.literal('removeEmptyLayer'), layerId: z.string().min(1) }),
  z.object({ kind: z.literal('removeUnreferencedAlias'), actionId: z.string().min(1) }),
  z.object({ kind: z.literal('dropPreservedLine'), ...preservedLineRefFields }),
  z.object({
    kind: z.literal('reclassifyPreservedLine'),
    ...preservedLineRefFields,
    target: tidyUpReclassifyTargetSchema,
  }),
])

export const tidyUpApplyInputSchema: z.ZodType<TidyUpApplyInput> = z.object({
  profileId: z.string().min(1),
  ops: z.array(tidyUpOpSchema).max(200),
})
