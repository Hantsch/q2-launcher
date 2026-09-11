import { z } from 'zod'
import { absolutePathSchema, engineKindSchema } from '@shared/schemas'
import {
  ARCHIVE_CACHE_BUDGET_CHOICES_GB,
  BOOTSTRAP_SUPPORTED_ENGINES,
  MAX_CONCURRENT_DOWNLOAD_JOBS,
  MIN_CONCURRENT_DOWNLOAD_JOBS,
  type ArchiveCacheBudgetGB,
  type ManifestPackage,
  type ManifestPackageContentEntry,
} from '@shared/modules/downloads'

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

/**
 * Story 074 D8, harness only: the same shape as `httpsUrlSchema` above, plus a plain-http
 * **loopback** URL (`http://127.0.0.1[:port]/...`). Its only consumer is
 * `harnessLoopbackManifestPackageSchema` below, which is only ever built by
 * `parseManifestFile({ httpsOnly: false })`, which only ever happens under the double gate in
 * `harness.ts` (`Q2L_UI_HARNESS === '1' && isDev`) - unreachable in a packaged build, where `isDev`
 * is always `false`.
 *
 * It is a *second, separately named* schema rather than a widened `httpsUrlSchema`, on purpose: a
 * single regex quietly accepting `http://127.0.0.1` would apply to production too, and "which URLs
 * can this build accept" would then be a question about a regex instead of a question about one
 * gated branch. `127.0.0.1` literally, not `localhost` and not any other loopback spelling - the
 * harness's fixture server binds that exact address.
 */
export const harnessLoopbackUrlSchema = z
  .string()
  .url()
  .refine(
    (value) => /^https:\/\//i.test(value) || /^http:\/\/127\.0\.0\.1(:\d{1,5})?\//i.test(value),
    'only https URLs (or, in the UI harness, a http://127.0.0.1 loopback URL) are allowed',
  )

const manifestPackageContentEntrySchema: z.ZodType<ManifestPackageContentEntry> = z.object({
  from: z.string().min(1),
  to: z.enum(['root', 'baseq2']),
})

/**
 * Fields common to both package kinds - AC2/AC3's "a package without size,
 * sha256 or mirrors is not a valid package" lives here: each is required and
 * strictly typed, so a row missing (or malforming) any one of them fails this
 * schema and is dropped by `parseManifestFile`, not defaulted.
 *
 * Story 074 D8 made the URL rule a parameter so the two schemas below differ in exactly that one
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
  })
}

function manifestPackageSchemaWith(urlSchema: z.ZodType<string>): z.ZodType<ManifestPackage> {
  const base = manifestPackageBaseSchemaWith(urlSchema)
  return z.discriminatedUnion('kind', [
    base.extend({ kind: z.literal('engine'), engine: engineKindSchema }),
    base.extend({ kind: z.literal('gamedata'), role: z.enum(['demo', 'point-release']) }),
  ])
}

/**
 * One package row, typed against `ManifestPackage` (`@shared/modules/downloads`)
 * so this schema and the wire type cannot drift apart - same convention as
 * `configCvarSectionSchema` in `main/modules/config/schemas.ts`.
 *
 * **This is the production schema and it is https-only.** Story 074 D8 did not touch that rule;
 * see `harnessLoopbackManifestPackageSchema` below for the harness-only variant and `harness.ts`
 * for the gate that is the only thing able to select it.
 */
export const manifestPackageSchema: z.ZodType<ManifestPackage> =
  manifestPackageSchemaWith(httpsUrlSchema)

/**
 * Story 074 D8, harness only - identical to `manifestPackageSchema` except that a package/mirror
 * URL may also be a plain-http `127.0.0.1` loopback URL (see `harnessLoopbackUrlSchema`). Selected
 * exclusively by `parseManifestFile`'s `httpsOnly: false` option, which only
 * `resolveDownloadSource()` (`harness.ts`) can produce, and only under its double gate.
 */
export const harnessLoopbackManifestPackageSchema: z.ZodType<ManifestPackage> =
  manifestPackageSchemaWith(harnessLoopbackUrlSchema)

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

/**
 * Story 072 D4: `getSettings`/`cacheStatus`/`clearCache` take no meaningful input - same `z.void()`
 * convention as `listInputSchema`/`writeStateInputSchema` in `main/modules/config/schemas.ts`.
 */
export const downloadsNoInputSchema = z.void()

/**
 * Story 073 D2: `dismissFailure`/`restoreFailure`'s payload - one failure-log entry id and nothing
 * else. Shape-identical, so the two alias one schema rather than duplicate it (same convention as
 * `unassignProfileInputSchema`/`setDefaultProfileInputSchema` in `main/modules/config/schemas.ts`),
 * and shape-only on purpose: whether the id names an entry the log actually holds depends on
 * persisted data this schema never sees, and a missing id is already a documented no-op in
 * `failure-log.ts`, not an invalid payload.
 *
 * `.strict()` for the same reason `patchDownloadsSettingsInputSchema` below is strict - a payload
 * carrying anything beyond the id is a caller bug, and this file's convention is to reject a caller
 * bug rather than quietly ignore part of it.
 */
export const dismissFailureInputSchema = z.object({ id: z.string().min(1) }).strict()

export const restoreFailureInputSchema = dismissFailureInputSchema

/**
 * Story 072 D4: `patchSettings`'s payload - a partial `DownloadsSettings`. Each present field is
 * validated against the exact same bounds `main/lib/schemas.ts`'s `downloadsSettingsSchema` uses to
 * parse the persisted value (`MIN_CONCURRENT_DOWNLOAD_JOBS`-`MAX_CONCURRENT_DOWNLOAD_JOBS`,
 * `ARCHIVE_CACHE_BUDGET_CHOICES_GB`) - reusing those same constants, not a hand-copied range, is
 * what keeps the two from ever drifting apart.
 *
 * Unlike that persisted schema, this one is strict rather than forgiving: this file's convention
 * (see `manifestGetInputSchema`'s own doc comment) is "a bad payload is a caller bug, not a state to
 * repair", so an out-of-range value here is rejected outright by `MainModuleRegistry.invoke()`
 * (`fail('ipc.error.invalidPayload')`) before any handler runs, rather than silently degraded to a
 * default the way a hand-edited `state.json` would be.
 */
/**
 * Story 074 D1: `bootstrapEngineOptions` takes no input - same `z.void()` convention as
 * `downloadsNoInputSchema` above; kept as its own named export so this handler's schema reads
 * self-documenting at the call site rather than reusing an unrelated-sounding name.
 */
export const bootstrapEngineOptionsInputSchema = downloadsNoInputSchema

/**
 * Story 088 D2: `bootstrap.retailSources` takes no input - same `z.void()` convention as
 * `bootstrapEngineOptionsInputSchema` above.
 */
export const bootstrapRetailSourcesInputSchema = downloadsNoInputSchema

/**
 * Story 074 D2: the eventual `bootstrap.targetVerdict` handler's payload - one absolute path, the
 * folder the wizard's target-folder step is considering. `.strict()` for the same "a bad payload is
 * a caller bug" reason as `dismissFailureInputSchema` above; `absolutePathSchema` (`@shared/schemas`)
 * already rejects an empty string and a NUL byte before this ever reaches `computeTargetVerdict`
 * (`bootstrap/target.ts`), which then does its own, deeper path-safety validation (device paths,
 * reserved names, containment) as part of the verdict itself rather than at the schema layer.
 */
export const bootstrapTargetVerdictInputSchema = z.object({ targetPath: absolutePathSchema }).strict()

/**
 * Story 089 D1: the eventual `bootstrap.gameDataSource` handler's payload (D3 wires the handler) -
 * one absolute path, the folder the wizard's game-data step is asking about. Same
 * `bootstrapTargetVerdictInputSchema` convention: `.strict()` because a bad payload is a caller bug,
 * `absolutePathSchema` rejects an empty string/NUL byte before anything looks at the filesystem, and
 * the deeper "does this folder actually hold retail data" judgement is left to the verdict itself.
 */
export const bootstrapGameDataSourceInputSchema = z.object({ rootPath: absolutePathSchema }).strict()

/**
 * Story 074 D4: the engine a bootstrap may be asked for. Narrower than `engineKindSchema` on
 * purpose - `BOOTSTRAP_SUPPORTED_ENGINES` is the wizard's own list ("offered by this sprint's
 * wizard", not "supported by the launcher in general", see its doc comment), and rejecting an
 * unsupported engine at the schema is better than resolving no package for it three steps later.
 */
const bootstrapEngineSchema = engineKindSchema.refine(
  (value) => BOOTSTRAP_SUPPORTED_ENGINES.includes(value),
  'the bootstrap wizard does not support this engine',
)

/**
 * Story 088 D4: which game-data source a bootstrap run uses (`BootstrapDataSource`,
 * `@shared/modules/downloads`). Optional at both call sites below, defaulted in main rather than
 * here, so a payload written against [[074]]'s wizard keeps meaning `'free-download'` - the schema
 * only decides which values are *representable*.
 */
const bootstrapDataSourceSchema = z.enum(['free-download', 'store-copy', 'existing-folder'])

/**
 * Story 088 D4: `copySourcePath` is meaningful for exactly one `dataSource`, so both halves of that
 * are enforced here rather than left to the handler - a `'store-copy'` payload without a source
 * path, and any other payload carrying one, are equally caller bugs and this file's convention is to
 * reject a caller bug outright (see `manifestGetInputSchema`'s own doc comment). Shared by the two
 * schemas below so "when is a copy source required" cannot come to differ between the confirm step's
 * summary and the run it summarises.
 *
 * It validates only the *combination*: whether the path names a source main actually detected, and
 * whether that source still verifies as retail, is re-decided in main against its own fresh list
 * (`startBootstrap`, `downloads.error.retailSourceUnverified`) - a schema can know neither.
 *
 * Story 089 D1: `'existing-folder'` needs exactly the same `copySourcePath` a `'store-copy'` run
 * does - a hand-picked folder is copied from the same way a detected retail install is - so it
 * joins `storeCopy` below rather than getting a second required-path branch.
 */
function refineCopySource(
  value: { dataSource?: 'free-download' | 'store-copy' | 'existing-folder'; copySourcePath?: string },
  ctx: z.RefinementCtx,
): void {
  const storeCopy = value.dataSource === 'store-copy' || value.dataSource === 'existing-folder'
  if (storeCopy && value.copySourcePath === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "a 'store-copy' or 'existing-folder' run must name the source it copies from",
      path: ['copySourcePath'],
    })
  }
  if (!storeCopy && value.copySourcePath !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "'copySourcePath' is only meaningful for a 'store-copy' or 'existing-folder' run",
      path: ['copySourcePath'],
    })
  }
}

/**
 * Story 074 D4: `bootstrap.summary`'s payload - the same facts `bootstrap.start` takes minus the
 * name, since a summary states what would be downloaded and how large it is (AC4), which no name can
 * change. `.strict()` for the same "a bad payload is a caller bug" reason as
 * `dismissFailureInputSchema` above.
 *
 * Story 088 D4 (AC5): plus the data source and, for a `'store-copy'` one, the path it would copy
 * from - so the confirm step's summary is computed from exactly the payload the run will be started
 * with, not from a subset of it.
 */
export const bootstrapSummaryInputSchema = z
  .object({
    engine: bootstrapEngineSchema,
    targetPath: absolutePathSchema,
    includeVideoAndPlayers: z.boolean(),
    dataSource: bootstrapDataSourceSchema.optional(),
    copySourcePath: absolutePathSchema.optional(),
  })
  .strict()
  .superRefine(refineCopySource)

/**
 * Story 074 D4: `bootstrap.start`'s payload. `targetPath` passes `absolutePathSchema` here and is
 * then re-judged in main by `computeTargetVerdict` (`bootstrap/target.ts`), which is where the real
 * path-safety decision lives - a schema cannot know whether a folder already holds a game.
 *
 * `name` is optional and only shape-checked: an installation name is user data, and main falls back
 * to `DEFAULT_BOOTSTRAP_INSTALLATION_NAME` (or, for a `'store-copy'` run, the engine's label - story
 * 088 D4) for an absent or blank one rather than rejecting it.
 *
 * Story 088 D4: `copySourcePath` passes `absolutePathSchema` here and is then re-resolved in main
 * against its own freshly listed detected sources - the same "the schema checks the shape, main
 * makes the decision" split `targetPath` already has, and the reason a path that merely *looks*
 * fine still cannot get a run past `startBootstrap`.
 */
export const startBootstrapInputSchema = z
  .object({
    engine: bootstrapEngineSchema,
    targetPath: absolutePathSchema,
    name: z.string().min(1).max(120).optional(),
    includeVideoAndPlayers: z.boolean(),
    // Story 074 AC2's remedy: the write-dir path the user picked from the target step's
    // Program-Files warning, if any - same `absolutePathSchema` convention as `targetPath` above.
    writeDirPath: absolutePathSchema.optional(),
    dataSource: bootstrapDataSourceSchema.optional(),
    copySourcePath: absolutePathSchema.optional(),
  })
  .strict()
  .superRefine(refineCopySource)

/**
 * Story 090 D1: `retail.upgradeStart`'s payload - the demo installation to upgrade and which
 * detected store source ([[088]]'s `DetectedRetailSource.rootPath`) to copy `pak0.pak`/`pak1.pak`
 * from. `.strict()` for the same "a bad payload is a caller bug" reason as
 * `dismissFailureInputSchema` above. Like `copySourcePath` elsewhere in this file, `sourceRootPath`
 * is never trusted as-is: D2's handler re-lists and re-verifies it against main's own fresh
 * `listDetectedRetailSources()` before copying anything (CLAUDE.md's "paths from the renderer are
 * never trusted").
 */
export const startRetailUpgradeInputSchema = z
  .object({
    installationId: z.string().min(1),
    sourceRootPath: absolutePathSchema,
  })
  .strict()

export const patchDownloadsSettingsInputSchema = z
  .object({
    concurrentJobs: z
      .number()
      .int()
      .min(MIN_CONCURRENT_DOWNLOAD_JOBS)
      .max(MAX_CONCURRENT_DOWNLOAD_JOBS)
      .optional(),
    archiveCacheBudgetGB: z
      .number()
      .refine((value): value is ArchiveCacheBudgetGB =>
        ARCHIVE_CACHE_BUDGET_CHOICES_GB.includes(value as ArchiveCacheBudgetGB),
      )
      .optional(),
    downloadWhilePlayingAllowed: z.boolean().optional(),
  })
  .strict()
