import { z } from 'zod'
import { engineKindSchema, harnessLoopbackUrlSchema, httpsUrlSchema, sha256Schema } from '@shared/schemas'
import type { ManifestPackage, ManifestPackageContentEntry } from '@shared/modules/downloads'

/**
 * Runtime validation for the manifest files (`engines/manifest.json`, `gamedata/manifest.json`,
 * fetched from a public GitHub content repo). Mirrors `src/main/modules/config/schemas.ts`'s
 * conventions: strict, structural validation only, no attempt to repair a bad value - a bad *row*
 * is dropped by `manifest-parse.ts`, not softened here.
 */

const manifestPackageContentEntrySchema: z.ZodType<ManifestPackageContentEntry> = z.object({
  from: z.string().min(1),
  to: z.enum(['root', 'baseq2']),
})

/**
 * Fields common to both package kinds - "a package without size,
 * sha256 or mirrors is not a valid package" lives here: each is required and
 * strictly typed, so a row missing (or malforming) any one of them fails this
 * schema and is dropped by `parseManifestFile`, not defaulted.
 *
 * Story 074 made the URL rule a parameter so the two schemas below differ in exactly that one
 * field and in nothing else - a hand-copied second field list is how the harness variant would
 * quietly stop enforcing something the production one still does.
 */
function manifestPackageBaseSchemaWith(urlSchema: z.ZodType<string>) {
  return z.object({
    id: z.string().min(1),
    version: z.string().min(1),
    sizeBytes: z.number().int().positive(),
    sha256: sha256Schema,
    url: urlSchema,
    mirrors: z.array(urlSchema),
    contents: z.array(manifestPackageContentEntrySchema).min(1),
    /**
     * Story 100: the host platforms this package's payload can actually run on, spelled the
     * way the Node platform string spells them (`'win32'`, `'linux'`, `'darwin'`).
     *
     * **Optional, and deliberately not defaulted here** - the "absent reads as `['win32']`" rule
     * is a compatibility reading of an *external* document and lives in exactly one place,
     * `packagePlatforms()` in `manifest-parse.ts`, rather than being half-applied by a schema
     * default and half-checked by the resolver.
     *
     * `z.string()` rather than an enum of the platforms this build knows: the manifest is fetched
     * from a content repo that may name a platform a *later* launcher supports, and refusing the
     * row for an unrecognised platform name would take today's Windows download path down with
     * it. An unknown name simply never matches the running platform.
     */
    platforms: z.array(z.string().min(1)).optional(),
  })
}

/**
 * Story 100: `ManifestPackage` plus the manifest-only `platforms` tag above. Kept as a
 * main-local intersection rather than widening the shared wire type, because the renderer has no
 * business resolving platforms - the pin it is handed (`ManifestSnapshot.pinned`) is already
 * resolved for the running platform by `manifest-parse.ts`.
 */
export type PlatformTaggedManifestPackage = ManifestPackage & { platforms?: string[] }

function manifestPackageSchemaWith(
  urlSchema: z.ZodType<string>,
): z.ZodType<PlatformTaggedManifestPackage> {
  const base = manifestPackageBaseSchemaWith(urlSchema)
  return z.discriminatedUnion('kind', [
    base.extend({
      kind: z.literal('engine'),
      engine: engineKindSchema,
      /** Story 190: the CPU architecture this engine build is (optional; absent = read the binary). */
      arch: z.enum(['x86', 'x86_64']).optional(),
    }),
    base.extend({ kind: z.literal('gamedata'), role: z.enum(['demo', 'point-release']) }),
  ])
}

/**
 * One package row, typed against `ManifestPackage` (`@shared/modules/downloads`)
 * so this schema and the wire type cannot drift apart - same convention as
 * `configCvarSectionSchema` in `main/modules/config/schemas.ts`.
 *
 * **This is the production schema and it is https-only.** Story 074 did not touch that rule;
 * see `harnessLoopbackManifestPackageSchema` below for the harness-only variant and `harness.ts`
 * for the gate that is the only thing able to select it.
 */
export const manifestPackageSchema: z.ZodType<PlatformTaggedManifestPackage> =
  manifestPackageSchemaWith(httpsUrlSchema)

/**
 * Story 074, harness only - identical to `manifestPackageSchema` except that a package/mirror
 * URL may also be a plain-http `127.0.0.1` loopback URL (see `harnessLoopbackUrlSchema`). Selected
 * exclusively by `parseManifestFile`'s `httpsOnly: false` option, which only
 * `resolveDownloadSource()` (`harness.ts`) can produce, and only under its double gate.
 */
export const harnessLoopbackManifestPackageSchema: z.ZodType<PlatformTaggedManifestPackage> =
  manifestPackageSchemaWith(harnessLoopbackUrlSchema)

/**
 * Story 100: what one `pinned` entry may be. **Both shapes are valid, on purpose:**
 *
 *  - a bare string - the shape every manifest published before this field grew a platform
 *    dimension uses, including the live remote one. It reads as `{ win32: id }`
 *    (`manifest-parse.ts`), so a launcher carrying this code still resolves an old manifest's
 *    pins on Windows exactly as it did before.
 *  - a `{ <platform>: <packageId> }` record - the explicit shape, where a platform with no entry
 *    simply has no pinned build.
 *
 * A value that is neither still fails the envelope, exactly as a non-string value did before this
 * union existed - that strictness is unchanged, not newly introduced. The *reading* of the two
 * accepted shapes is `manifest-parse.ts`'s business (it is the file that knows the running
 * platform), the same split `schemaVersion` already has.
 */
const manifestPinnedEntrySchema = z.union([z.string(), z.record(z.string(), z.string())])

/** The two `pinned` value shapes above, as `manifest-parse.ts`'s `resolvePinned` receives them. */
export type ManifestPinnedEntry = z.infer<typeof manifestPinnedEntrySchema>

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
  pinned: z.record(z.string(), manifestPinnedEntrySchema).optional(),
})
