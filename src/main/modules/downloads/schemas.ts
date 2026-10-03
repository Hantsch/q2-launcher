import { z } from 'zod'
import { absolutePathSchema, engineKindSchema } from '@shared/schemas'
import {
  ARCHIVE_CACHE_BUDGET_CHOICES_GB,
  BOOTSTRAP_SUPPORTED_ENGINES,
  MAX_CONCURRENT_DOWNLOAD_JOBS,
  MIN_CONCURRENT_DOWNLOAD_JOBS,
  REPAIR_OFFER_KINDS,
  type ArchiveCacheBudgetGB,
} from '@shared/modules/downloads'

/**
 * Story 072: `getSettings`/`cacheStatus`/`clearCache` take no meaningful input - same `z.void()`
 * convention as `listInputSchema`/`writeStateInputSchema` in `main/modules/config/schemas.ts`.
 */
export const downloadsNoInputSchema = z.void()

/**
 * Story 073: `dismissFailure`/`restoreFailure`'s payload - one failure-log entry id and nothing
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
 * Story 072: `patchSettings`'s payload - a partial `DownloadsSettings`. Each present field is
 * validated against the exact same bounds `main/modules/downloads/persisted.ts`'s `downloadsSettingsSchema` uses to
 * parse the persisted value (`MIN_CONCURRENT_DOWNLOAD_JOBS`-`MAX_CONCURRENT_DOWNLOAD_JOBS`,
 * `ARCHIVE_CACHE_BUDGET_CHOICES_GB`) - reusing those same constants, not a hand-copied range, is
 * what keeps the two from ever drifting apart.
 *
 * Unlike that persisted schema, this one is strict rather than forgiving: this file's convention
 * is "a bad payload is a caller bug, not a state to repair", so an out-of-range value here is rejected outright by `MainModuleRegistry.invoke()`
 * (`fail('ipc.error.invalidPayload')`) before any handler runs, rather than silently degraded to a
 * default the way a hand-edited `state.json` would be.
 */
/**
 * Story 074: `bootstrapEngineOptions` takes no input - same `z.void()` convention as
 * `downloadsNoInputSchema` above; kept as its own named export so this handler's schema reads
 * self-documenting at the call site rather than reusing an unrelated-sounding name.
 */
export const bootstrapEngineOptionsInputSchema = downloadsNoInputSchema

/**
 * Story 088: `bootstrap.retailSources` takes no input - same `z.void()` convention as
 * `bootstrapEngineOptionsInputSchema` above.
 */
export const bootstrapRetailSourcesInputSchema = downloadsNoInputSchema

/**
 * Story 074: the eventual `bootstrap.targetVerdict` handler's payload - one absolute path, the
 * folder the wizard's target-folder step is considering. `.strict()` for the same "a bad payload is
 * a caller bug" reason as `dismissFailureInputSchema` above; `absolutePathSchema` (`@shared/schemas`)
 * already rejects a non-absolute path (empty, relative, drive-relative) and a NUL byte before this ever reaches `computeTargetVerdict`
 * (`bootstrap/target.ts`), which then does its own, deeper path-safety validation (device paths,
 * reserved names, containment) as part of the verdict itself rather than at the schema layer.
 */
export const bootstrapTargetVerdictInputSchema = z
  .object({ targetPath: absolutePathSchema })
  .strict()

/**
 * Story 089: the eventual `bootstrap.gameDataSource` handler's payload (a later stage wires the handler) -
 * one absolute path, the folder the wizard's game-data step is asking about. Same
 * `bootstrapTargetVerdictInputSchema` convention: `.strict()` because a bad payload is a caller bug,
 * `absolutePathSchema` rejects a non-absolute path/NUL byte before anything looks at the filesystem, and
 * the deeper "does this folder actually hold retail data" judgement is left to the verdict itself.
 */
export const bootstrapGameDataSourceInputSchema = z
  .object({ rootPath: absolutePathSchema })
  .strict()

/**
 * Story 074: the engine a bootstrap may be asked for. Narrower than `engineKindSchema` on
 * purpose - `BOOTSTRAP_SUPPORTED_ENGINES` is the wizard's own list ("offered by this sprint's
 * wizard", not "supported by the launcher in general", see its doc comment), and rejecting an
 * unsupported engine at the schema is better than resolving no package for it three steps later.
 */
const bootstrapEngineSchema = engineKindSchema.refine(
  (value) => BOOTSTRAP_SUPPORTED_ENGINES.includes(value),
  'the bootstrap wizard does not support this engine',
)

/**
 * Story 088: which game-data source a bootstrap run uses (`BootstrapDataSource`,
 * `@shared/modules/downloads`). Optional at both call sites below, defaulted in main rather than
 * here, so a payload written against [[074]]'s wizard keeps meaning `'free-download'` - the schema
 * only decides which values are *representable*.
 */
const bootstrapDataSourceSchema = z.enum(['free-download', 'store-copy', 'existing-folder'])

/**
 * Story 088: `copySourcePath` is meaningful for exactly one `dataSource`, so both halves of that
 * are enforced here rather than left to the handler - a `'store-copy'` payload without a source
 * path, and any other payload carrying one, are equally caller bugs and this file's convention is to
 * reject a caller bug outright. Shared by the two
 * schemas below so "when is a copy source required" cannot come to differ between the confirm step's
 * summary and the run it summarises.
 *
 * It validates only the *combination*: whether the path names a source main actually detected, and
 * whether that source still verifies as retail, is re-decided in main against its own fresh list
 * (`startBootstrap`, `downloads.error.retailSourceUnverified`) - a schema can know neither.
 *
 * Story 089: `'existing-folder'` needs exactly the same `copySourcePath` a `'store-copy'` run
 * does - a hand-picked folder is copied from the same way a detected retail install is - so it
 * joins `storeCopy` below rather than getting a second required-path branch.
 */
function refineCopySource(
  value: {
    dataSource?: 'free-download' | 'store-copy' | 'existing-folder'
    copySourcePath?: string
  },
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
 * Story 074: `bootstrap.summary`'s payload - the same facts `bootstrap.start` takes minus the
 * name, since a summary states what would be downloaded and how large it is, which no name can
 * change. `.strict()` for the same "a bad payload is a caller bug" reason as
 * `dismissFailureInputSchema` above.
 *
 * Story 088: plus the data source and, for a `'store-copy'` one, the path it would copy
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
 * Story 074: `bootstrap.start`'s payload. `targetPath` passes `absolutePathSchema` here and is
 * then re-judged in main by `computeTargetVerdict` (`bootstrap/target.ts`), which is where the real
 * path-safety decision lives - a schema cannot know whether a folder already holds a game.
 *
 * `name` is optional and only shape-checked: an installation name is user data, and main falls back
 * to `DEFAULT_BOOTSTRAP_INSTALLATION_NAME` (or, for a `'store-copy'` run, the engine's label - story
 * 088) for an absent or blank one rather than rejecting it.
 *
 * Story 088: `copySourcePath` passes `absolutePathSchema` here and is then re-resolved in main
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
    // Story 074's remedy: the write-dir path the user picked from the target step's
    // Program-Files warning, if any - same `absolutePathSchema` convention as `targetPath` above.
    writeDirPath: absolutePathSchema.optional(),
    dataSource: bootstrapDataSourceSchema.optional(),
    copySourcePath: absolutePathSchema.optional(),
  })
  .strict()
  .superRefine(refineCopySource)

/**
 * Story 090: `retail.upgradeStart`'s payload - the demo installation to upgrade and which
 * detected store source ([[088]]'s `DetectedRetailSource.rootPath`) to copy `pak0.pak`/`pak1.pak`
 * from. `.strict()` for the same "a bad payload is a caller bug" reason as
 * `dismissFailureInputSchema` above. Like `copySourcePath` elsewhere in this file, `sourceRootPath`
 * is never trusted as-is: the handler re-lists and re-verifies it against main's own fresh
 * `listDetectedRetailSources()` before copying anything (CLAUDE.md's "paths from the renderer are
 * never trusted").
 */
export const startRetailUpgradeInputSchema = z
  .object({
    installationId: z.string().min(1),
    sourceRootPath: absolutePathSchema,
  })
  .strict()

/**
 * Story 092: `engineUpdateStatus`/`engineUpdateStart`/`engineRollbackStart`'s shared shape - one
 * installation id and nothing else. `.strict()` for the same "a bad payload is a caller bug"
 * reason as `dismissFailureInputSchema` above.
 */
export const engineInstallationInputSchema = z
  .object({ installationId: z.string().min(1) })
  .strict()

export const engineUpdateStatusInputSchema = engineInstallationInputSchema

export const startEngineUpdateInputSchema = engineInstallationInputSchema

/**
 * Story 093: `repair.plan`'s payload - one installation id, nothing else. Same single-field
 * shape as `engineInstallationInputSchema` above, kept as its own export since this module's
 * checklist is unrelated to the engine-update surface.
 */
export const repairPlanInputSchema = z.object({ installationId: z.string().min(1) }).strict()

/**
 * Story 093: `repair.start`'s payload - the installation and the offer kinds the user
 * authorised. The enum is `REPAIR_OFFER_KINDS` (`@shared/modules/downloads`) itself, never a
 * hand-copied list, so a kind added to the contract cannot silently fail validation here.
 *
 * `.min(1)`: a repair of nothing is a caller bug, and this file's convention is to reject a bad
 * payload rather than let a handler discover it. Which of the accepted kinds the *job* actually
 * performs is a different question, answered in `repair/job.ts` (`REPAIRS_BY_JOB`) - the schema
 * validates the contract's shape, not one job's scope.
 */
export const startRepairInputSchema = z
  .object({
    installationId: z.string().min(1),
    offers: z.array(z.enum(REPAIR_OFFER_KINDS)).min(1),
  })
  .strict()

export const startEngineRollbackInputSchema = engineInstallationInputSchema

/**
 * Story 092: `engineSetBleedingEdge`'s payload - the installation to flip and the channel to
 * flip it to. `.strict()` for the same reason as the schemas above.
 */
export const setBleedingEdgeInputSchema = z
  .object({
    installationId: z.string().min(1),
    enabled: z.boolean(),
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
