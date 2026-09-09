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
 * Everything downloaded, verified and assembled, and `inspectInstallation` still calls the target
 * `invalid`/`missing` (AC6). The one failure that is decided by the disk rather than by an
 * operation returning an error.
 */
export const NOT_PLAYABLE: DownloadsErrorKey = 'downloads.error.installationNotPlayable'

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
