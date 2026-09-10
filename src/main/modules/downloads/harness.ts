import { CONTENT_REPO_RAW_BASE } from '../../lib/content-repo'
import {
  HARNESS_CONTENT_REPO_BASE_ENV,
  isUiHarnessEnabled,
  parseHarnessBaseUrl,
  type UiHarnessGateInput,
} from '../../lib/ui-harness'

/**
 * Re-exported so nothing that already imports the env var name from this module (e.g.
 * `harness.test.ts`) has to change: story 082 D4 moved the constant itself to
 * `src/main/lib/ui-harness.ts` (shared with `home/news/harness.ts`), this file's own public API is
 * unchanged.
 */
export { HARNESS_CONTENT_REPO_BASE_ENV }

/**
 * Story 074 D8: the ONE place that can point this module's manifest/package traffic somewhere
 * other than the curated public content repo.
 *
 * ## Why this exists at all
 *
 * The story's acceptance is an end-to-end run of the bootstrap wizard - manifest fetch, three
 * verified downloads, three real 7-Zip extractions, assemble, revalidate - "with no outbound
 * network access". Playwright cannot intercept what the *main* process fetches, so the only way to
 * make that run offline is to let the harness name the `127.0.0.1` origin its own fixture server
 * is listening on. That is a download-source override, i.e. exactly the kind of backdoor that must
 * never be reachable by a real user - hence the gate below and `harness.test.ts` next to it.
 *
 * ## Unreachable in production, by construction
 *
 * The decision is `isUiHarnessEnabled()` (`src/main/lib/ui-harness.ts`): `Q2L_UI_HARNESS === '1'`
 * AND `isDev`, both, never either alone. `isDev` is `false` in a packaged build whatever the
 * environment says, so the harness branch cannot be entered there at all. Same discipline as
 * `DialogService`'s stub (`src/main/services/dialog.ts`), including the four-case gate test.
 *
 * ## What is deliberately NOT done here
 *
 *  - **Nothing reads `process.env` implicitly and forever.** `resolveDownloadSource()` is called
 *    exactly once, when the downloads module registers its handlers (`index.ts`), and its result is
 *    a plain value threaded into `ManifestService`. A later change of environment cannot flip an
 *    already-running app onto a different download source, and there is no cached decision hiding
 *    inside a schema's `.refine()`.
 *  - **The production schema is never widened.** `manifestPackageSchema` (`schemas.ts`) keeps its
 *    https-only rule untouched. The harness path selects a *different, separately named* schema
 *    (`harnessLoopbackManifestPackageSchema`) via the `httpsOnly: false` flag below - two textually
 *    distinct schemas, so "which one can a packaged build reach" is answered by reading this file
 *    rather than by tracing a regex.
 *  - **The override is not a free-form URL.** `parseHarnessBaseUrl()` accepts only an
 *    `http(s)://127.0.0.1[:port]` origin. Even inside the harness branch the override cannot point
 *    at a public host, so a stray `Q2L_UI_CONTENT_REPO_BASE` in a developer's shell can at worst
 *    break that developer's own dev run - it can never redirect it somewhere.
 */

/** Where manifests and packages come from, and how strictly package URLs are validated. */
export interface DownloadSource {
  /** Base URL `fetchContentJson()` joins a manifest path onto. */
  baseUrl: string
  /**
   * `true` for production: every package/mirror URL in a manifest must be https
   * (`manifestPackageSchema`). `false` only under the double gate, where
   * `harnessLoopbackManifestPackageSchema` additionally accepts a plain-http loopback URL.
   *
   * The fixture server has no certificate, and giving it one would mean relaxing certificate trust
   * in two separate HTTP stacks - Node's global `fetch` (undici) for the manifests, Chromium's
   * `net.fetch` for the packages - which is a strictly larger hole than this one flag, spread over
   * more code, and switched on for the whole process rather than for one schema.
   */
  httpsOnly: boolean
}

/** The production source: the curated public content repo, https-only. Never overridable. */
export const PRODUCTION_DOWNLOAD_SOURCE: DownloadSource = {
  baseUrl: CONTENT_REPO_RAW_BASE,
  httpsOnly: true,
}

/**
 * The download source this process may use. Production unless BOTH gates are open AND the harness
 * named a loopback origin - so a packaged build, a normal `npm run dev`, and a harness launch that
 * forgot the variable all resolve to exactly the same production value.
 */
export function resolveDownloadSource(input: UiHarnessGateInput): DownloadSource {
  if (!isUiHarnessEnabled(input)) return PRODUCTION_DOWNLOAD_SOURCE

  const env = input.env ?? process.env
  const baseUrl = parseHarnessBaseUrl(env[HARNESS_CONTENT_REPO_BASE_ENV])
  if (baseUrl === undefined) return PRODUCTION_DOWNLOAD_SOURCE

  return { baseUrl, httpsOnly: false }
}
