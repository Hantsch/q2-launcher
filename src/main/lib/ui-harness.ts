/**
 * Story 074 D8: the gate every UI-verification backdoor in main goes through, and the one such
 * backdoor that does not belong to a module (`installations:pickFolder`'s folder stub).
 *
 * ## The gate
 *
 * `Q2L_UI_HARNESS === '1'`, and only that - `isDev` is not part of the decision. A packaged
 * AppImage is the only way story 101's D5/D6 CI jobs can drive the real update/self-relaunch path,
 * and `isDev` (`is.dev` from `@electron-toolkit/utils`, `false` whenever `app.isPackaged`) is
 * unconditionally `false` there, so gating on `isDev` as well made every one of these backdoors
 * unreachable in exactly the build the harness has to run against. `Q2L_UI_HARNESS` is the real
 * gate: it is set only by the process that launches the harness (`scripts/lib/harness.mjs`'s
 * `childEnv()`), never by anything shipped in the app itself, never surfaced in the renderer, and
 * never set by electron-builder or the packaged binary's own launcher - so a real user's packaged
 * install still cannot reach any of this without deliberately exporting the variable before
 * starting the binary.
 *
 * `UiHarnessGateInput.isDev` is kept on the type (dev builds still get `registerDevIpc` itself
 * registered unconditionally, via `src/main/ipc/index.ts`'s own `isDev ||` check) but is no longer
 * read by the functions below - see each one's comment.
 *
 * This is the same gate `DialogService.pickConfigFiles()` (`src/main/services/dialog.ts`, story 066
 * D4) already writes out inline. It lives in a named function here because story 074 D8 needs the
 * same gate in two more places - `installations:pickFolder` below and the downloads module's
 * download-source override (`src/main/modules/downloads/harness.ts`) - and three hand-copied
 * `process.env[...] === '1'` expressions are three places one of them can drift. `DialogService`'s
 * own copy is deliberately left as it is: it is covered by its own four-case test
 * (`dialog.test.ts`) and rewriting a shipped security gate to route through a new helper is a
 * change with no upside.
 *
 * Nothing here reads `process.env` at module scope: both functions take the environment as a
 * parameter (defaulting to `process.env`) so a test can exercise every gate combination without
 * mutating the real one, and so an audit can see there is no cached decision.
 */

import { readFile, writeFile } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import { z } from 'zod'
import type { DetectedRunner } from '@shared/types'
import { userDataDir } from './paths'
import { scopedLogger } from './logger'

const log = scopedLogger('ui-harness')

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
  /**
   * `AppContext.isDev` - `is.dev` from `@electron-toolkit/utils`; always `false` when packaged.
   * Kept on this type so every existing call site stays unchanged, but no longer read by
   * `isUiHarnessEnabled()` itself - see the module comment for why the gate dropped it.
   */
  isDev: boolean
  /** Defaults to `process.env`; a parameter so the gate is testable without touching the real one. */
  env?: NodeJS.ProcessEnv
}

/** The one gate, in one place. See the module comment. */
export function isUiHarnessEnabled({ env = process.env }: UiHarnessGateInput): boolean {
  return env[UI_HARNESS_ENV] === '1'
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
 * Story 104 D3: the env var the harness names a stand-in Steam executable in, overriding the path
 * `detectRunners()` (`src/main/services/runners.ts`) would otherwise resolve - `<steam root>/steam.exe`
 * on Windows, `steam` on `PATH` elsewhere. It exists for the Windows branch of the `steam-handoff`
 * flow, which cannot put a Steam install into the registry of the machine it runs on.
 */
export const UI_HARNESS_STEAM_EXECUTABLE_ENV = 'Q2L_UI_STEAM_EXECUTABLE'

/**
 * The Steam executable a harness-launched run uses instead of the detected one: `undefined` when
 * the gate is closed or the variable is unset/empty, so the caller detects Steam for real. Like
 * `uiHarnessPickedFolders`, the path is not validated here - the caller still checks it is a file.
 */
export function uiHarnessSteamExecutable(input: UiHarnessGateInput): string | undefined {
  if (!isUiHarnessEnabled(input)) return undefined
  const env = input.env ?? process.env
  const raw = env[UI_HARNESS_STEAM_EXECUTABLE_ENV]
  return raw === undefined || raw.length === 0 ? undefined : raw
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

/**
 * Story 099 D6: where a harness-launched run's `app:openExternal` calls land instead of a real
 * `shell.openExternal` - so the upcoming e2e flow (D7) can prove the About panel's external links
 * "left through the external path and opened no app window" without a browser actually launching on
 * the test machine. Same double gate as everything else in this file (`isUiHarnessEnabled()`); the
 * caller (`src/main/ipc/app.ts`) decides whether to record or to call `shell.openExternal`, this
 * file only owns the file itself.
 *
 * This is a test fixture, not production data: no `JsonStore` corruption-recovery machinery, no
 * schema, no atomic rename - a plain read-modify-write with a `try`/`catch` that treats anything
 * unreadable or malformed as "no urls recorded yet" is enough.
 */
export const HARNESS_EXTERNAL_URLS_FILE = 'ui-harness-external.json'

/** `userData/ui-harness-external.json`. */
export function harnessExternalUrlsFilePath(): string {
  return join(userDataDir(), HARNESS_EXTERNAL_URLS_FILE)
}

export interface RecordHarnessExternalUrlOptions {
  /** Defaults to `harnessExternalUrlsFilePath()`; a parameter so a test writes to a temp path. */
  filePath?: string
}

/** Appends `url` to the recorded list, creating the file (starting from `[]`) if it does not exist. */
export async function recordHarnessExternalUrl(
  url: string,
  options: RecordHarnessExternalUrlOptions = {},
): Promise<void> {
  const filePath = options.filePath ?? harnessExternalUrlsFilePath()
  const urls = await readHarnessExternalUrls(filePath)
  urls.push(url)
  await writeFile(filePath, JSON.stringify(urls), 'utf8')
}

/**
 * Story 105 D3: the env var the harness names a fixture runner list in - a JSON `DetectedRunner[]`
 * (`src/shared/types/runner.ts`) - overriding what `detectRunners()`
 * (`src/main/services/runners.ts`) would otherwise detect for real. It exists so an e2e flow can
 * exercise the runner-choice UI (D2) against a known, deterministic list - Wine/umu-run/Proton/Steam
 * detection depends on what happens to be installed on the machine running the harness, which a CI
 * runner cannot control the way it controls this variable.
 */
export const UI_HARNESS_DETECTED_RUNNERS_ENV = 'Q2L_UI_DETECTED_RUNNERS'

/** Validates the JSON payload of `UI_HARNESS_DETECTED_RUNNERS_ENV` - the exact shape of `DetectedRunner`. */
const detectedRunnerSchema = z.object({
  kind: z.enum(['native', 'wine', 'umu', 'proton', 'steam']),
  id: z.string(),
  label: z.string().optional(),
  path: z.string(),
  available: z.boolean(),
})

const detectedRunnersSchema = z.array(detectedRunnerSchema)

/**
 * The fixture runner list a harness-launched run uses instead of real detection: `undefined` when
 * the gate is closed, the variable is unset/empty, or its contents are not a valid
 * `DetectedRunner[]` - in the last case a warning is logged so a malformed fixture fails loudly in
 * the harness's own logs rather than silently falling back to whatever the test machine happens to
 * have installed. Like `uiHarnessSteamExecutable`, the caller (`detectRunners()`) returns this list
 * verbatim; nothing here re-derives `toRunnerOption`/collapse/IPC output from it.
 */
export function uiHarnessDetectedRunners(input: UiHarnessGateInput): DetectedRunner[] | undefined {
  if (!isUiHarnessEnabled(input)) return undefined
  const env = input.env ?? process.env
  const raw = env[UI_HARNESS_DETECTED_RUNNERS_ENV]
  if (raw === undefined || raw.length === 0) return undefined

  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(raw)
  } catch (error) {
    log.warn(`${UI_HARNESS_DETECTED_RUNNERS_ENV} is not valid JSON, ignoring`, error)
    return undefined
  }

  const result = detectedRunnersSchema.safeParse(parsedJson)
  if (!result.success) {
    log.warn(
      `${UI_HARNESS_DETECTED_RUNNERS_ENV} does not match DetectedRunner[], ignoring`,
      result.error,
    )
    return undefined
  }
  return result.data
}

/** Anything missing, unreadable or not a JSON array reads back as "nothing recorded yet". */
async function readHarnessExternalUrls(filePath: string): Promise<string[]> {
  try {
    const raw = await readFile(filePath, 'utf8')
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as string[]) : []
  } catch {
    return []
  }
}
