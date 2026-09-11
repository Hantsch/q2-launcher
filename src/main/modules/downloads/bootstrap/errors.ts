import { DOWNLOADS_ERROR_KEYS, type DownloadsErrorKey } from '@shared/modules/downloads'

/**
 * Story 074 D4: the mapping from "what went wrong in the bootstrap job" to the fixed
 * `DOWNLOADS_ERROR_KEYS` set (`@shared/modules/downloads`). Pure, so the choice of key is
 * reviewable on its own rather than buried in the orchestrator's control flow.
 *
 * Every failure the job can end with is named here, and nothing here invents prose: `Job.error`
 * carries an i18n key, and CLAUDE.md's "main sends i18n keys, never prose, across IPC" rules out
 * shipping a reason string. Reasons are logged next to the key, where they stay useful.
 */

/**
 * A required package (the pinned engine build, the demo data, the point release) could not be
 * resolved from the manifest. Distinct from `downloads.error.manifestUnavailable`, which is the
 * *fetch* failing and is not a member of the fixed set.
 */
export const PACKAGE_UNAVAILABLE: DownloadsErrorKey = 'downloads.error.packageUnavailable'

/**
 * Story 076 D3 (AC5): a package that *was* resolved, downloaded, verified and extracted, and whose
 * extraction contained none of the candidate paths one of its required allowlist entries accepts
 * (`assemble.ts`'s `missingRequired`). Where `PACKAGE_UNAVAILABLE` fires *before* a single byte is
 * fetched - the manifest does not list the package at all - this one fires *after* the core
 * assemble pass, when the archive arrived intact and simply did not hold what the allowlist looked
 * for. Carries `params: { packageId }`, so the failure names the archive rather than only the
 * end-of-run verdict.
 */
export const PACKAGE_INCOMPLETE: DownloadsErrorKey = 'downloads.error.packageIncomplete'

/**
 * Story 088 fix cycle (review F1): the `store-copy` counterpart to `PACKAGE_INCOMPLETE` above - a
 * detected retail installation verified at the D4 pre-check, and by the time the actual copy ran
 * (e.g. the source was moved or deleted in between) contributed none of the required `baseq2`
 * paks. Nothing was *downloaded* for a `store-copy` run, so reusing `PACKAGE_INCOMPLETE` would
 * either lie about a download that never happened or fall back to the literal string `'retail'` as
 * its `packageId` (`missingRequired`'s `role`, not a real manifest package - there is none to
 * resolve for a copy run). Carries no `params`: unlike `PACKAGE_INCOMPLETE`, there is no package id
 * to name, only "the copy" itself.
 */
export const RETAIL_COPY_INCOMPLETE: DownloadsErrorKey = 'downloads.error.retailCopyIncomplete'

/**
 * Story 089 D1: the `'existing-folder'` counterpart to `RETAIL_COPY_INCOMPLETE` above - a
 * hand-picked folder's `GameDataSourceVerdict` (`@shared/modules/downloads`) came back
 * `kind: 'unusable'` by the time the copy actually ran (e.g. it was edited or emptied out from
 * under the wizard). Own key for the same reason `RETAIL_COPY_INCOMPLETE` has one instead of reusing
 * `PACKAGE_INCOMPLETE`: nothing was downloaded, and there is no package id to name, only the folder.
 */
export const GAME_DATA_SOURCE_UNUSABLE: DownloadsErrorKey = 'downloads.error.gameDataSourceUnusable'

/**
 * Everything downloaded, verified and assembled, and `inspectInstallation` still calls the target
 * `invalid`/`missing` (AC6). The one failure that is decided by the disk rather than by an
 * operation returning an error.
 */
export const NOT_PLAYABLE: DownloadsErrorKey = 'downloads.error.installationNotPlayable'

/**
 * Story 080 D3 (AC5): the pinned engine build needs the x86 Visual C++ runtime
 * (`VCRUNTIME140.dll`) and the bootstrap found neither the `SysWOW64` nor the `System32` copy of
 * it on this machine. Distinct from `NOT_PLAYABLE`: this fires *before* the first revalidation, on
 * a specific, actionable cause the inspector's generic verdict cannot name.
 */
export const MISSING_RUNTIME: DownloadsErrorKey = 'downloads.error.missingRuntime'

/**
 * Story 088 D4: the wizard asked for `dataSource: 'store-copy'` and the `copySourcePath` it named
 * is not among the detected retail sources main itself just re-listed, or that source no longer
 * inspects as retail (`inspection.verified === false`) - "the picker list is a UI convenience, not
 * an authorisation" (Decisions (Sprint)), so the run is refused rather than copying an unverified
 * tree.
 *
 * Deliberately **not** a member of `DOWNLOADS_ERROR_KEYS`, for exactly the reason `TARGET_BLOCKED_KEY`
 * (`job.ts`) is not one either: it is answered by `bootstrap.start` before any installation is
 * registered and before any `Job` exists, so it can never reach a `Job.error` or the failure log.
 * Carries `params: { reason }` - `'pathMissing'`/`'notDetected'`, or the source's own
 * `RetailSourceUnverifiedReasonKey` - as data for the log and a later UI, never as prose.
 */
export const RETAIL_SOURCE_UNVERIFIED = 'downloads.error.retailSourceUnverified'

/**
 * The catch-all for a local operation that failed for an unforeseen reason - a refused path, a
 * copy that threw, an `mkdir` that could not run. Same choice `pipeline.ts` makes for its own
 * unexpected-error path, and the key `fetcher.ts` already uses for a refused local path: of the
 * fixed set, this is the only member that describes "this machine, not the network".
 */
export const LOCAL_FAILURE: DownloadsErrorKey = 'downloads.error.diskWrite'

/**
 * The extractor's `Outcome` carries a plain string, so only a member of the fixed set may reach a
 * job. Same narrowing `pipeline.ts` applies - an unrecognised key becomes
 * `downloads.error.extractionFailed`, which is what the caller was extracting when it happened.
 */
export function asExtractionErrorKey(key: string): DownloadsErrorKey {
  return (DOWNLOADS_ERROR_KEYS as readonly string[]).includes(key)
    ? (key as DownloadsErrorKey)
    : 'downloads.error.extractionFailed'
}
