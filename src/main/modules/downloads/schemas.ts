import { z } from 'zod'
import { engineKindSchema } from '@shared/schemas'
import type { ManifestPackage, ManifestPackageContentEntry } from '@shared/modules/downloads'

/**
 * Runtime validation for the downloads module's manifest files
 * (`engines/manifest.json`, `gamedata/manifest.json`, fetched by D2/D3 from a
 * public GitHub content repo). Mirrors `src/main/modules/config/schemas.ts`'s
 * conventions: strict, structural validation only, no attempt to repair a bad
 * value - a bad *row* is dropped by `manifest-parse.ts`, not softened here.
 */

/**
 * A SHA-256 digest as the manifest spells it: 64 lowercase hex characters. Not
 * `.toLowerCase()`-normalised - a manifest author writing uppercase hex is a
 * fixture worth rejecting, the same "reject, don't repair" stance the rest of
 * this file takes.
 */
export const sha256Schema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, 'must be a 64-character lowercase hex sha256 digest')

/**
 * Same shape as `urlSchema` in `src/shared/ipc-schemas.ts`, but the manifest's
 * own trust boundary is stricter: every package/mirror URL must be https - a
 * curated manifest naming a plain-http download is a fixture worth rejecting,
 * not a caller mistake to tolerate.
 */
export const httpsUrlSchema = z
  .string()
  .url()
  .refine((value) => /^https:\/\//i.test(value), 'only https URLs are allowed')

const manifestPackageContentEntrySchema: z.ZodType<ManifestPackageContentEntry> = z.object({
  from: z.string().min(1),
  to: z.enum(['root', 'baseq2']),
})

/**
 * Fields common to both package kinds - AC2/AC3's "a package without size,
 * sha256 or mirrors is not a valid package" lives here: each is required and
 * strictly typed, so a row missing (or malforming) any one of them fails this
 * schema and is dropped by `parseManifestFile`, not defaulted.
 */
const manifestPackageBaseSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  sizeBytes: z.number().int().positive(),
  sha256: sha256Schema,
  url: httpsUrlSchema,
  mirrors: z.array(httpsUrlSchema),
  contents: z.array(manifestPackageContentEntrySchema).min(1),
})

/**
 * One package row, typed against `ManifestPackage` (`@shared/modules/downloads`)
 * so this schema and the wire type cannot drift apart - same convention as
 * `configCvarSectionSchema` in `main/modules/config/schemas.ts`.
 */
export const manifestPackageSchema: z.ZodType<ManifestPackage> = z.discriminatedUnion('kind', [
  manifestPackageBaseSchema.extend({ kind: z.literal('engine'), engine: engineKindSchema }),
  manifestPackageBaseSchema.extend({
    kind: z.literal('gamedata'),
    role: z.enum(['demo', 'point-release']),
  }),
])

/**
 * The envelope shape one manifest file (`engines/manifest.json` OR
 * `gamedata/manifest.json`) must have to be readable at all - `schemaVersion`
 * and `packages` are required and strictly typed, so a file missing either
 * key, or carrying a non-array `packages`, fails this schema entirely
 * (`manifest-parse.ts`'s "structurally broken envelope" refusal). `packages`
 * is `z.unknown()` here - each element is parsed row-by-row against
 * `manifestPackageSchema` by `manifest-parse.ts`, not by this schema, so one
 * bad row can be dropped instead of failing the whole envelope.
 *
 * `schemaVersion` is `z.number()`, not `z.literal(1)`: the exact-match-or-
 * refuse rule is `manifest-parse.ts`'s business (it needs to tell "wrong
 * version" apart from "missing/malformed envelope"), not this schema's.
 */
export const manifestEnvelopeSchema = z.object({
  schemaVersion: z.number(),
  packages: z.array(z.unknown()),
  pinned: z.record(z.string(), z.string()).optional(),
})

/**
 * D4: `manifest.get`'s IPC payload - matches `ManifestService.getManifest`'s own
 * `GetManifestOptions` (`manifest-service.ts`). `refresh` is optional: a caller not asking for a
 * forced refetch simply omits it, same "every invoke channel still carries a schema, even a small
 * one" convention as `writeStateInputSchema`/`listInputSchema` in `main/modules/config/schemas.ts`.
 */
export const manifestGetInputSchema = z.object({
  refresh: z.boolean().optional(),
})
