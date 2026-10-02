import { z } from 'zod'
import {
  ARCHIVE_CACHE_BUDGET_CHOICES_GB,
  DEFAULT_DOWNLOADS_SETTINGS,
  MAX_CONCURRENT_DOWNLOAD_JOBS,
  MIN_CONCURRENT_DOWNLOAD_JOBS,
  type ArchiveCacheBudgetGB,
  type DownloadFailure,
  type DownloadsSettings,
} from '@shared/modules/downloads'
import { parseForgivingRows } from '../../lib/forgiving'
import type { StateSection, StateSectionSpec, StateStore } from '../../services/state'
import { pruneFailures } from './failure-log'

/**
 * Story 071 D1: the persisted `downloads` top-level `state.json` key. Forgiving, never throws: a malformed or out-of-range
 * `concurrentJobs` (not an integer, or outside 1-6) falls back to the default rather than
 * rejecting the whole file, and a `downloads` value that isn't even an object falls back to
 * `DEFAULT_DOWNLOADS_SETTINGS` wholesale.
 *
 * Story 072 D2 extends this with `archiveCacheBudgetGB` (must be one of
 * `ARCHIVE_CACHE_BUDGET_CHOICES_GB`) and `downloadWhilePlayingAllowed` (a plain boolean), each with
 * its own `.catch()` default so a corrupt field costs only that field.
 */
export const downloadsSettingsSchema = z
  .object({
    concurrentJobs: z
      .number()
      .int()
      .min(MIN_CONCURRENT_DOWNLOAD_JOBS)
      .max(MAX_CONCURRENT_DOWNLOAD_JOBS)
      .catch(DEFAULT_DOWNLOADS_SETTINGS.concurrentJobs),
    archiveCacheBudgetGB: z
      .number()
      .refine((value): value is ArchiveCacheBudgetGB =>
        ARCHIVE_CACHE_BUDGET_CHOICES_GB.includes(value as ArchiveCacheBudgetGB),
      )
      .catch(DEFAULT_DOWNLOADS_SETTINGS.archiveCacheBudgetGB),
    downloadWhilePlayingAllowed: z
      .boolean()
      .catch(DEFAULT_DOWNLOADS_SETTINGS.downloadWhilePlayingAllowed),
  })
  .catch(() => ({ ...DEFAULT_DOWNLOADS_SETTINGS }))

export function parseDownloadsSettings(raw: unknown): DownloadsSettings {
  return downloadsSettingsSchema.parse(raw)
}

/**
 * Story 075 D1: one persisted `DownloadDiagnostics` record. Deliberately forgiving field-by-field
 * (each optional field `.catch(undefined)`, same convention as the object it lives on) rather than
 * one big `.catch(undefined)` around the whole shape - a single malformed package or log line
 * should not have to cost the whole diagnostics record, only `downloadFailureObjectSchema`'s outer
 * `.optional().catch(undefined)` (below) needs to catch a `diagnostics` value that is not even an
 * object.
 */
const downloadDiagnosticsPackageSchema = z.object({
  id: z.string().min(1),
  url: z.string().min(1),
  sizeBytes: z.number().finite(),
  verified: z.boolean(),
  extracted: z.boolean(),
  // Story 078 D1 (AC8): forgiving field-by-field like every other field on this row.
  contents: z.array(z.string()).optional().catch(undefined),
  contentsTruncated: z.boolean().optional().catch(undefined),
  contributed: z.boolean().optional().catch(undefined),
})

// Story 078 D1 (AC7): mirrors `downloadDiagnosticsPackageSchema`'s forgiving-field convention.
const downloadDiagnosticsAssemblyEntrySchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  found: z.boolean(),
  sourcePackageId: z.string().min(1).optional().catch(undefined),
})

const downloadDiagnosticsTargetSchema = z.object({
  targetPath: z.string().min(1),
  verdict: z.enum(['ok', 'warning', 'invalid', 'missing', 'unknown']),
  missingChecks: z.array(
    z.object({
      // Mirrors `ValidationCheckId` (`@shared/types/installation`) - literal, not imported, since
      // `z.enum` needs its own literal tuple; keep this list in sync with that type.
      id: z.enum([
        'root-exists',
        'base-game-dir',
        'base-paks',
        'executable',
        'engine-identified',
        'write-access',
      ]),
      messageKey: z.string().min(1),
    }),
  ),
})

const downloadDiagnosticsSchema = z
  .object({
    jobId: z.string().min(1),
    kind: z.string().min(1),
    startedAt: z.string().min(1),
    finishedAt: z.string().min(1),
    errorKey: z.string().min(1),
    packages: z.array(downloadDiagnosticsPackageSchema).catch([]),
    target: downloadDiagnosticsTargetSchema.optional().catch(undefined),
    // Story 078 D1 (AC7): same optional-field convention as `target` - a malformed `assembly`
    // value costs only this field, never the whole diagnostics record.
    assembly: z.array(downloadDiagnosticsAssemblyEntrySchema).optional().catch(undefined),
    logTail: z.array(z.string()).catch([]),
    truncated: z.boolean().optional().catch(undefined),
  })
  .optional()
  .catch(undefined)

const downloadFailureObjectSchema = z.object({
  id: z.string().min(1),
  jobId: z.string().min(1),
  labelKey: z.string().min(1),
  labelParams: z
    .record(z.string(), z.union([z.string(), z.number()]))
    .optional()
    .catch(undefined),
  installationId: z.string().min(1).optional().catch(undefined),
  error: z.object({
    key: z.string().min(1),
    params: z
      .record(z.string(), z.union([z.string(), z.number()]))
      .optional()
      .catch(undefined),
  }),
  createdAt: z.number().finite(),
  dismissedAt: z.number().finite().optional().catch(undefined),
  diagnostics: downloadDiagnosticsSchema,
})

/**
 * The persisted `downloadFailures` top-level `state.json` key. A malformed row is dropped on its own, a missing/garbled key loads
 * as `[]`. Retention (7-day prune of dismissed entries, the 50-entry cap) is applied by
 * `main/modules/downloads/failure-log.ts`, not here - this function only guards the shape.
 */
export function parseDownloadFailures(raw: unknown): DownloadFailure[] {
  return parseForgivingRows(downloadFailureObjectSchema, raw)
}

const settingsSpec: StateSectionSpec<DownloadsSettings> = {
  key: 'downloads',
  parse: parseDownloadsSettings,
  defaults: () => ({ ...DEFAULT_DOWNLOADS_SETTINGS }),
}

const failuresSpec: StateSectionSpec<DownloadFailure[]> = {
  key: 'downloadFailures',
  parse: parseDownloadFailures,
  defaults: () => [],
}

/**
 * The failure log with retention applied on both sides of the store: a dismissed entry past its
 * window never reaches a reader even if it is still in a file written earlier, and nothing can
 * write an unpruned list to disk whichever call site produced it.
 */
function keepIfUnpruned(list: DownloadFailure[]): DownloadFailure[] {
  const pruned = pruneFailures(list, Date.now())
  return pruned.length === list.length ? list : pruned
}

function prunedFailures(section: StateSection<DownloadFailure[]>): StateSection<DownloadFailure[]> {
  return {
    get: () => keepIfUnpruned(section.get()),
    // An update that hands back its input unchanged must stay a no-op: `pruneFailures` always
    // returns a fresh array, so identity is preserved whenever pruning removed nothing.
    update: (fn) =>
      section.update((live) => {
        const base = keepIfUnpruned(live)
        const next = fn(base)
        return next === base ? base : keepIfUnpruned(next)
      }),
  }
}

const prunedByState = new WeakMap<StateStore, StateSection<DownloadFailure[]>>()

/** The downloads module's persisted sections; the same handles on every call for one store. */
export function downloadsState(state: StateStore): {
  settings: StateSection<DownloadsSettings>
  failures: StateSection<DownloadFailure[]>
} {
  let failures = prunedByState.get(state)
  if (!failures) {
    failures = prunedFailures(state.section(failuresSpec))
    prunedByState.set(state, failures)
  }
  return { settings: state.section(settingsSpec), failures }
}
