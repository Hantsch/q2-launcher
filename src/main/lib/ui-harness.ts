/**
 * Story 074 D8: the double gate every UI-verification backdoor in main goes through, and the one
 * such backdoor that does not belong to a module (`installations:pickFolder`'s folder stub).
 *
 * ## The gate
 *
 * `Q2L_UI_HARNESS === '1'` AND `isDev` - both, never either alone. `isDev` is `is.dev` from
 * `@electron-toolkit/utils` (`AppContext.isDev`), which is `false` in a packaged build regardless
 * of any environment variable a hostile or malformed launch could set, so every branch guarded by
 * `isUiHarnessEnabled()` is unreachable in a packaged build *by construction* - not by convention.
 *
 * This is the same gate `DialogService.pickConfigFiles()` (`src/main/services/dialog.ts`, story 066
 * D4) already writes out inline. It lives in a named function here because story 074 D8 needs the
 * same gate in two more places - `installations:pickFolder` below and the downloads module's
 * download-source override (`src/main/modules/downloads/harness.ts`) - and three hand-copied
 * `isDev && process.env[...] === '1'` expressions are three places one of them can drift.
 * `DialogService`'s own copy is deliberately left as it is: it is covered by its own four-case
 * test (`dialog.test.ts`) and rewriting a shipped security gate to route through a new helper is a
 * change with no upside.
 *
 * Nothing here reads `process.env` at module scope: both functions take the environment as a
 * parameter (defaulting to `process.env`) so a test can exercise all four gate combinations
 * without mutating the real one, and so an audit can see there is no cached decision.
 */

import { delimiter } from 'node:path'

/** The one variable that marks a UI-verification launch (`scripts/lib/harness.mjs`'s `childEnv()`). */
export const UI_HARNESS_ENV = 'Q2L_UI_HARNESS'

/**
 * The env var the harness puts the folders in that `installations:pickFolder`'s stub hands back
 * instead of opening a native OS dialog.
 *
 * A `path.delimiter`-joined **list**, in call order, exactly like `DialogService`'s
 * `Q2L_UI_PICK_FILES` - but consumed one entry per call rather than all at once, because a single
 * flow legitimately picks more than one folder: `scripts/flows/bootstrap-wizard.mjs` has to point
 * the wizard's target step at a `Program Files` path first (AC2's warning) and at its real fixture
 * target second (AC3's warning, and the folder the job then installs into). The last entry repeats
 * for every further call, so an extra pick - the write-dir remedy button, say - cannot exhaust the
 * list and turn into a surprise cancel.
 */
export const UI_HARNESS_PICK_FOLDER_ENV = 'Q2L_UI_PICK_FOLDER'

export interface UiHarnessGateInput {
  /** `AppContext.isDev` - `is.dev` from `@electron-toolkit/utils`; always `false` when packaged. */
  isDev: boolean
  /** Defaults to `process.env`; a parameter so the gate is testable without touching the real one. */
  env?: NodeJS.ProcessEnv
}

/** The double gate, in one place. See the module comment. */
export function isUiHarnessEnabled({ isDev, env = process.env }: UiHarnessGateInput): boolean {
  return isDev && env[UI_HARNESS_ENV] === '1'
}

/**
 * The folders a harness-stubbed `installations:pickFolder` answers with, in call order:
 *
 *  - `undefined` - the gate is closed; the caller must open the real OS dialog. Its own value
 *    rather than being folded into an empty array, because "no stub" and "the stub says cancel"
 *    are different answers and the caller has to branch on the difference.
 *  - `[]` - the gate is open but the harness named no folder: the stub reports a cancel, still
 *    without opening a dialog.
 *  - one or more paths - handed out one per call by the caller, last entry repeating (see
 *    `UI_HARNESS_PICK_FOLDER_ENV`). Which call gets which entry is the *caller's* bookkeeping, so
 *    this function stays pure and there is no hidden counter to reason about here.
 *
 * Playwright cannot drive a native OS dialog at all (`docs/UI-VERIFICATION.md`, "Known blind
 * spots"), and the bootstrap wizard's target step has no typeable field - `PathPicker`'s input is
 * `readOnly` - so without this stub `scripts/flows/bootstrap-wizard.mjs` cannot get past step 2.
 * The paths are *not* validated here: `installations:pickFolder`'s callers already treat its
 * result as untrusted renderer-supplied input (`computeTargetVerdict` re-judges it in main), so a
 * stub that pre-blessed a path would be weaker than the real dialog it stands in for, not stronger.
 */
export function uiHarnessPickedFolders(input: UiHarnessGateInput): string[] | undefined {
  if (!isUiHarnessEnabled(input)) return undefined
  const env = input.env ?? process.env
  const raw = env[UI_HARNESS_PICK_FOLDER_ENV]
  if (raw === undefined || raw.length === 0) return []
  return raw.split(delimiter).filter((path) => path.length > 0)
}

/**
 * The environment variable the harness names its fixture server's origin in, e.g.
 * `http://127.0.0.1:53129`. Only read when the double gate is open.
 *
 * Story 082 D4: moved here from `src/main/modules/downloads/harness.ts` (story 074 D8's original
 * home) so `src/main/modules/home/news/harness.ts` can reuse the same variable and parser without a
 * module-to-module import - both downloads and news fetch from the same community-content repo, so
 * one variable names where "somewhere other than production" is for both.
 */
export const HARNESS_CONTENT_REPO_BASE_ENV = 'Q2L_UI_CONTENT_REPO_BASE'

/**
 * Accepts only an `http://127.0.0.1[:port][/path]` (or https loopback) base, normalised without a
 * trailing slash. Anything else - a public host, a `file:` URL, junk - answers `undefined`; what a
 * caller does with `undefined` is its own decision (downloads falls back to production, news skips
 * the fetch entirely - see `news/harness.ts`).
 */
export function parseHarnessBaseUrl(raw: string | undefined): string | undefined {
  if (raw === undefined || raw.length === 0) return undefined

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return undefined
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
  if (url.hostname !== '127.0.0.1') return undefined

  const base = `${url.origin}${url.pathname}`
  return base.endsWith('/') ? base.slice(0, -1) : base
}
