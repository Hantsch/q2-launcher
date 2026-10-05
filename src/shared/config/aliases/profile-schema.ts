import { z } from 'zod'
import type { AltLayer } from './alt-layers'
import { MAX_WAIT_FRAMES } from '../syntax/engine-limits'
import { isLatin1Text } from '../syntax/q2-charset'
import type {
  ActionEntryKind,
  ActionEntryPart,
  ActionKeySlot,
  ConfigAction,
  ConfigActionCategory,
  ConfigActionSubcategory,
  ConfigCvarSection,
  ConfigCvarSubsection,
} from '../../modules/config'

/**
 * The config profile's sub-shapes, declared once (story 211).
 *
 * Each shape carries exactly the rules that *both* readers enforce - the strict IPC payload schemas
 * (`shared/modules/config-schemas.ts`) and the forgiving persisted-state schemas
 * (`main/modules/config/persisted.ts`). The IPC side adds its caps (`.max(n)`, extra `.min(1)`) on
 * top; the persisted side adds its forgiveness (`.catch()`, row-level drops, legacy fields) on top.
 * A rule added here therefore tightens *both*: on the persisted side that means a stored row that
 * no longer passes is silently dropped on the next load, so a rule belongs here only if the
 * persisted reader already enforced it.
 *
 * Every object shape is exported twice: `…ObjectSchema` is the plain `z.object`, which is what a
 * reader `.extend()`s (a `z.ZodType`-annotated const has no `.extend`); `…Schema` is the same
 * object annotated with its contract type, so a drift between shape and type fails the build. Key
 * order in each object is the output key order, i.e. the bytes a persisted profile is written
 * back as - `.extend()` keeps an overridden key in its original position.
 */

/** Latin-1 only and no `"`: Quake has no in-quote escaping, so a literal quote is unrepresentable. */
export const actionTextSchema = z
  .string()
  .refine((value) => isLatin1Text(value), 'must be latin-1 (U+0000-U+00FF only)')
  .refine((value) => !value.includes('"'), 'double quotes are not representable in Quake 2')

/** `frames` is bounded by `MAX_WAIT_FRAMES`, a launcher sanity cap rather than an engine one. */
export const configCommandSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('raw'), text: actionTextSchema }),
  z.object({
    kind: z.literal('message'),
    channel: z.enum(['say', 'say_team']),
    text: actionTextSchema,
  }),
  z.object({
    kind: z.literal('wait'),
    frames: z.number().int().min(1).max(MAX_WAIT_FRAMES),
  }),
])

export const modifierTriggerSchema = z.enum(['ALT', 'CTRL', 'SHIFT'])

export const actionEntryKindSchema = z.enum(['bind', 'message', 'alias', 'toggle', 'press-release'])

/** The `ActionEntryKind`s that require exactly two `parts`. */
export const TWO_PART_ACTION_KINDS: ReadonlySet<string> = new Set<ActionEntryKind>([
  'toggle',
  'press-release',
])

/**
 * Rejects a two-part action whose `parts` is not exactly two elements. A `.superRefine`, not part
 * of `configActionObjectSchema` itself, because a refined object can no longer be `.extend()`ed.
 * An action whose `kind` is absent (a persisted row before the kind is derived) is not checked.
 */
export function refineActionParts(
  action: { kind?: string; parts?: unknown },
  ctx: z.RefinementCtx,
): void {
  if (!action.kind || !TWO_PART_ACTION_KINDS.has(action.kind)) return
  if (Array.isArray(action.parts) && action.parts.length === 2) return
  ctx.addIssue({
    code: 'custom',
    message: `'${action.kind}' actions require exactly two 'parts'`,
    path: ['parts'],
  })
}

export const actionEntryPartObjectSchema = z.object({
  commands: z.array(configCommandSchema),
  label: z.string().optional(),
  aliasName: z.string().optional(),
})
export const actionEntryPartSchema: z.ZodType<ActionEntryPart> = actionEntryPartObjectSchema

export const actionKeySlotObjectSchema = z.object({
  key: z.string(),
  modifier: modifierTriggerSchema.optional(),
})
export const actionKeySlotSchema: z.ZodType<ActionKeySlot> = actionKeySlotObjectSchema

/**
 * `keepEmptyAlias` is deliberately absent: neither reader has ever carried it, and adding it here
 * would change what a persisted profile parses to. Ids naming a category/sub-category the profile
 * does not have are valid - no cross-reference check at the schema level.
 */
export const configActionObjectSchema = z.object({
  id: z.string().min(1),
  categoryId: z.string().min(1),
  subcategoryId: z.string().optional(),
  name: z.string().min(1),
  commands: z.array(configCommandSchema),
  kind: actionEntryKindSchema,
  keys: z.array(actionKeySlotObjectSchema).optional(),
  catalogId: z.string().optional(),
  aliasName: z.string().optional(),
  parts: z.array(actionEntryPartObjectSchema).optional(),
})
export const configActionSchema: z.ZodType<ConfigAction> =
  configActionObjectSchema.superRefine(refineActionParts)

export const configActionSubcategoryObjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
})
export const configActionSubcategorySchema: z.ZodType<ConfigActionSubcategory> =
  configActionSubcategoryObjectSchema

export const configActionCategoryObjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  nameKey: z.string().min(1).optional(),
  subcategories: z.array(configActionSubcategoryObjectSchema).optional(),
})
export const configActionCategorySchema: z.ZodType<ConfigActionCategory> =
  configActionCategoryObjectSchema

/** Cvar names are shape-only, never cross-validated against the catalogue. */
export const configCvarSubsectionObjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  cvars: z.array(z.string()),
})
export const configCvarSubsectionSchema: z.ZodType<ConfigCvarSubsection> =
  configCvarSubsectionObjectSchema

export const configCvarSectionObjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  nameKey: z.string().min(1).optional(),
  cvars: z.array(z.string()),
  subsections: z.array(configCvarSubsectionObjectSchema).optional(),
})
export const configCvarSectionSchema: z.ZodType<ConfigCvarSection> = configCvarSectionObjectSchema

/** `triggerKey: null` means "no trigger assigned yet". */
export const altLayerObjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  mode: z.enum(['hold', 'toggle']),
  triggerKey: z.string().nullable(),
  overrides: z.record(z.string(), z.string()),
})
export const altLayerSchema: z.ZodType<AltLayer> = altLayerObjectSchema
