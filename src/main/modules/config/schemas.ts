import { z } from 'zod'
import { MAX_WAIT_FRAMES } from '@shared/config/engine-limits'
import { NAMED_KEYS, normalizeBindKey } from '@shared/config/key-names'
import { isLatin1Text } from '@shared/config/q2-charset'
import type { ModifierTrigger } from '@shared/config/modifier-layers'
import type { TidyUpOp } from '@shared/config/tidy-up'
import type { TidyUpApplyInput } from '@shared/modules/config'

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
  from: z.enum(['empty', 'template']),
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
 * Structural validation only - a cvar name must be a non-empty string, same as
 * a cvar value. This deliberately does not validate cvar-name semantics (that
 * is a later story's job); it only rejects garbage shapes before they reach
 * `ProfilesStore`.
 */
export const setProfileCvarsInputSchema = z.object({
  profileId: z.string().min(1),
  cvars: z.record(z.string().min(1), z.string()),
})

/** Structural validation only, same rationale as `setProfileCvarsInputSchema` above. */
export const setProfileBindsInputSchema = z.object({
  profileId: z.string().min(1),
  binds: z.record(z.string().min(1), z.string()),
})

/**
 * One `AltLayer`'s shape, validated strictly - this is the IPC payload schema,
 * not the persisted-state one (`main/lib/schemas.ts`'s `layers` field): a bad
 * payload here is a caller bug and `.parse()` is meant to throw, while the
 * persisted schema degrades a mangled value to `[]` instead.
 *
 * `triggerKey` is nullable - `null` means "no trigger assigned yet" (story
 * 011), same nullable-field convention as `setSwitchBindInputSchema`'s `key`
 * below. `.min(1)` still rejects `''`; this deliberately stops at "non-empty
 * string or null" and does not layer `switchBindKeySchema`'s key-vocabulary
 * check on top, since the board's key set isn't proven identical to
 * `NAMED_KEYS` (story decision 9).
 */
const altLayerSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  mode: z.enum(['hold', 'toggle']),
  triggerKey: z.string().min(1).nullable(),
  overrides: z.record(z.string().min(1), z.string()),
})

export const setProfileLayersInputSchema = z.object({
  profileId: z.string().min(1),
  layers: z.array(altLayerSchema).max(64),
})

/**
 * Story 008: every action/message string. Latin-1 code points only
 * (U+0000-U+00FF) and no `"` - Quake has no in-quote escaping, so a literal
 * quote cannot be represented at all (same rule `alt-layers.ts`'s
 * `sanitizeCommand` enforces for layer bodies, applied here at the schema
 * boundary instead of by silent stripping, since the story explicitly wants
 * this class of input *rejected*, not mangled). Exported so
 * `main/lib/schemas.ts`'s forgiving persisted schema can reuse the same rule
 * (via `isLatin1Text` directly there, to stay a `.safeParse`-per-row check
 * rather than importing this strict schema).
 */
export const actionTextSchema = z
  .string()
  .refine((value) => isLatin1Text(value), 'must be latin-1 (U+0000-U+00FF only)')
  .refine((value) => !value.includes('"'), 'double quotes are not representable in Quake 2')

/**
 * Story 045 D1: a `wait <frames>` step. `frames` is bounded by `MAX_WAIT_FRAMES` - a launcher
 * sanity cap, not an engine-enforced one (see that constant's doc comment) - so a payload asking
 * for an absurd wait is rejected here rather than accepted and only misbehaving later at render time.
 */
const configWaitCommandSchema = z.object({
  kind: z.literal('wait'),
  frames: z.number().int().min(1).max(MAX_WAIT_FRAMES),
})

const configCommandSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('raw'), text: actionTextSchema }),
  z.object({
    kind: z.literal('message'),
    channel: z.enum(['say', 'say_team']),
    text: actionTextSchema,
  }),
  configWaitCommandSchema,
])

/**
 * Story 016: the modifier held during capture of `key`/`secondaryKey`. Typed against
 * `ModifierTrigger` (`@shared/config/modifier-layers`) rather than redeclaring the literal union,
 * so this schema and the type it validates cannot drift apart.
 */
const modifierTriggerSchema: z.ZodType<ModifierTrigger> = z.enum(['ALT', 'CTRL', 'SHIFT'])

/**
 * Story 019: a category is a named drawer and nothing else - the entry kind moved onto the entry
 * (`actionEntryKindSchema` below), so story 008's `entryKind` field is gone from this payload.
 *
 * `nameKey` (story 052 D1) is the optional i18n display hint `ConfigActionCategory.nameKey`
 * documents - carried through here (rather than stripped as an unrecognised field) so a category
 * seeded from `TEMPLATE_ACTION_CATEGORIES` keeps it across an ordinary `setActions` round-trip
 * until a rename drops it. Same "non-empty string, no further vocabulary check" rule as
 * `catalogId`/`aliasName` below - this schema only guards shape, not whether the key is one the
 * renderer actually recognises.
 */
const configActionCategorySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120),
  nameKey: z.string().min(1).optional(),
})

/**
 * Story 019: what the entry is. Required and strict on purpose - a renderer payload is never
 * trusted, and defaulting a missing value here would silently retype an entry (a message saved as
 * a bind) instead of failing the call. The forgiving derive lives only in the persisted schema
 * (`main/lib/schemas.ts`), where the input is an old `state.json` rather than a caller.
 */
// Story 045 D1: adds the two-part `'toggle'`/`'press-release'` kinds, cross-validated against
// `parts` below.
const actionEntryKindSchema = z.enum(['bind', 'message', 'alias', 'toggle', 'press-release'])

/**
 * Story 045 D1: one state's worth of commands for a two-part action, mirroring
 * `@shared/modules/config`'s `ActionEntryPart` exactly.
 */
const actionEntryPartSchema = z.object({
  commands: z.array(configCommandSchema).max(64),
  label: z.string().max(120).optional(),
  aliasName: z.string().min(1).optional(),
})

/** The `ActionEntryKind`s that require exactly two `parts` (story 045 D1). */
const TWO_PART_ACTION_KINDS = new Set(['toggle', 'press-release'])

/**
 * Story 050: one `ActionKeySlot` - a key plus the optional modifier held while capturing it. Same
 * length rule `key` always had, and the same modifier vocabulary `keyModifier` always had.
 */
const actionKeySlotSchema = z.object({
  key: z.string().max(20),
  modifier: modifierTriggerSchema.optional(),
})

/**
 * Story 050: the pre-050 four-field shape (`key`/`secondaryKey`/`keyModifier`/
 * `secondaryKeyModifier`) is still accepted here and normalised into `keys` before validation -
 * every caller that has not yet moved to `keys` (renderer call sites land it in D3-D5) still gets
 * a valid payload rather than a thrown error. Input already carrying `keys` passes through
 * untouched; the two shapes are never merged.
 */
function normalizeActionKeys(raw: unknown): unknown {
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

  const { key: _key, secondaryKey: _secondaryKey, keyModifier: _keyModifier, secondaryKeyModifier: _secondaryKeyModifier, ...rest } = value
  return { ...rest, keys: slots }
}

export const configActionSchema = z.preprocess(
  normalizeActionKeys,
  z
    .object({
      id: z.string().min(1),
      categoryId: z.string().min(1),
      name: z.string().min(1).max(120),
      kind: actionEntryKindSchema,
      commands: z.array(configCommandSchema).max(64),
      // Story 050: replaces the old fixed `key`/`secondaryKey`/`keyModifier`/`secondaryKeyModifier`
      // fields with an arbitrary-length array - see `ActionKeySlot`/`@shared/config/action-slots.ts`.
      // `normalizeActionKeys` above accepts the legacy shape and folds it into this field first.
      keys: z.array(actionKeySlotSchema).max(64).optional(),
      // Story 015 (decision 2): opaque catalogue-row id, generated by the editor,
      // never shown to the user - so only "non-empty string" is a meaningful rule here.
      catalogId: z.string().min(1).optional(),
      // Story 039 (D1): the human-readable alias name the user typed, rendered verbatim (sign kept)
      // by `aliasNameFor` when set. Same "non-empty string" rule as `catalogId` - length/character
      // limits belong to the render layer, not the payload schema.
      aliasName: z.string().min(1).optional(),
      // Story 045 (D1): the second half of a two-part `toggle`/`press-release` entry. Structurally
      // optional here; the `superRefine` below is what actually requires it (and requires exactly
      // two elements) for those two kinds.
      parts: z.array(actionEntryPartSchema).optional(),
    })
    .superRefine((action, ctx) => {
      if (!TWO_PART_ACTION_KINDS.has(action.kind)) return
      if (Array.isArray(action.parts) && action.parts.length === 2) return
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `'${action.kind}' actions require exactly two 'parts'`,
        path: ['parts'],
      })
    }),
)

export const setProfileActionsInputSchema = z.object({
  profileId: z.string().min(1),
  categories: z.array(configActionCategorySchema).max(64),
  actions: z.array(configActionSchema).max(500),
})

export const writeProfileInputSchema = z.object({
  profileId: z.string().min(1),
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
 * Story 005 import payloads. Deviation from the story text: it says these
 * belong in `main/lib/schemas.ts`, but every other config-module IPC payload
 * schema already lives here instead - that repo convention wins over the
 * stale story text.
 */
export const importScanInputSchema = z.object({
  installationId: z.string().min(1),
})

export const importPreviewInputSchema = z.object({
  installationId: z.string().min(1),
  gameDir: z.string().min(1).max(64),
})

/**
 * Story 041 (D6): `layerAliases` shape only - an array of non-empty strings,
 * capped the same generous way `cleanupApplyInputSchema`'s `entries` is below.
 * Whether a given name is actually one of *this* import's ambiguous aliases is
 * not a shape question - it depends on data (`readImportableConfig`'s result)
 * this schema never sees - so that check lives in `commitImport`
 * (`main/modules/config/import.ts`), which has both the input and the
 * ambiguous list in scope. This schema only rejects garbage shapes (a number,
 * a bare string, an over-long array) before either the ambiguous check or the
 * conversion pipeline runs.
 */
export const importCommitInputSchema = z.object({
  installationId: z.string().min(1),
  gameDir: z.string().min(1).max(64),
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
 * `gameDir` is capped the same as `importPreviewInputSchema`'s. `fileName` is
 * capped more generously (128) than a typical cfg name needs, but still well
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
const tidyUpBindScopeSchema = z.union([
  z.literal('base'),
  z.object({ layerId: z.string().min(1) }),
])

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
