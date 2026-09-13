import {
  HARNESS_CONTENT_REPO_BASE_ENV,
  isUiHarnessEnabled,
  parseHarnessBaseUrl,
  type UiHarnessGateInput,
} from '../../../lib/ui-harness'

/**
 * Story 082 D4: the news half of the same double-gated backdoor `downloads/harness.ts` already has
 * (story 074 D8). The gate itself (`isUiHarnessEnabled`) and the env var / loopback-base parser
 * (`HARNESS_CONTENT_REPO_BASE_ENV`, `parseHarnessBaseUrl`) live in `src/main/lib/ui-harness.ts` so
 * this file reuses them without importing from the `downloads` module.
 *
 * ## Where news diverges from downloads
 *
 * Downloads' `resolveDownloadSource()` falls back to the production source whenever the gate is
 * open but no valid loopback base was named - a manifest fetch is user-triggered (add/verify an
 * installation), so a harness run that forgot the variable just talks to production once.
 *
 * News is different: the story's AC1 fetches at *every app start*, not on demand. If this resolver
 * copied downloads' fallback, every `ui:verify` run - which sets `Q2L_UI_HARNESS=1` but does not
 * necessarily name a news fixture base - would make a real outbound request at startup and break
 * AC10 ("the whole test suite plus `ui:verify` run with no network access"). So here, "gate open but
 * no/invalid loopback base" resolves to `skip`: the caller (D5/D6) must not fetch at all, and the
 * feed falls back to whatever is already cached.
 */

/** Where `home`'s news fetcher should get `news/index.json` and its documents from. */
export type NewsSource =
  | { kind: 'production' }
  | { kind: 'loopback'; base: string }
  | { kind: 'skip' }

/**
 * Resolves the news fetch source for this process.
 *
 *  - gate closed (packaged build, or dev without `Q2L_UI_HARNESS=1`): `production`, always -
 *    `HARNESS_CONTENT_REPO_BASE_ENV` is not even read.
 *  - gate open and the env var names a valid `127.0.0.1` base: `loopback`, with that base.
 *  - gate open but the env var is unset, malformed, or names a non-loopback host: `skip` - never
 *    production, unlike downloads. See the file header for why.
 */
export function resolveNewsSource(input: UiHarnessGateInput): NewsSource {
  if (!isUiHarnessEnabled(input)) return { kind: 'production' }

  const env = input.env ?? process.env
  const base = parseHarnessBaseUrl(env[HARNESS_CONTENT_REPO_BASE_ENV])
  if (base === undefined) return { kind: 'skip' }

  return { kind: 'loopback', base }
}
