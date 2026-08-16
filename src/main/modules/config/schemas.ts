import { z } from 'zod'
import { NAMED_KEYS, normalizeBindKey } from '@shared/config/key-names'
import { isLatin1Text } from '@shared/config/q2-charset'

/**
 * IPC payload validation for the config module's own handlers.
 *
 * These are strict, same convention as the installation payload schemas in
 * `main/lib/schemas.ts`: a bad payload here is a caller bug, not a state to
 * repair, so a handler lets `.parse()` throw rather than catching it.
 */

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
 */
const altLayerSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  mode: z.enum(['hold', 'toggle']),
  triggerKey: z.string().min(1),
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

const configCommandSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('raw'), text: actionTextSchema }),
  z.object({
    kind: z.literal('message'),
    channel: z.enum(['say', 'say_team']),
    text: actionTextSchema,
  }),
])

const configActionCategorySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120),
  entryKind: z.enum(['bind', 'message', 'alias']),
})

const configActionSchema = z.object({
  id: z.string().min(1),
  categoryId: z.string().min(1),
  name: z.string().min(1).max(120),
  commands: z.array(configCommandSchema).max(64),
  key: z.string().max(20).optional(),
})

export const setProfileActionsInputSchema = z.object({
  profileId: z.string().min(1),
  categories: z.array(configActionCategorySchema).max(64),
  actions: z.array(configActionSchema).max(500),
})

export const writeProfileInputSchema = z.object({
  profileId: z.string().min(1),
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

export const importCommitInputSchema = z.object({
  installationId: z.string().min(1),
  gameDir: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
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
