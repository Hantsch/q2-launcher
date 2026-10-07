/**
 * Story 074: the gate every UI-verification backdoor in main goes through, and the one such
 * backdoor that does not belong to a module (`installations:pickFolder`'s folder stub).
 *
 * ## The gate
 *
 * `Q2L_UI_HARNESS === '1'`, and only that - `isDev` is not part of the decision. A packaged
 * AppImage is the only way story 101's CI jobs can drive the real update/self-relaunch path,
 * and `isDev` (`is.dev` from `@electron-toolkit/utils`, `false` whenever `app.isPackaged`) is
 * unconditionally `false` there, so gating on `isDev` as well made every one of these backdoors
 * unreachable in exactly the build the harness has to run against. `Q2L_UI_HARNESS` is the real
 * gate: it is set only by the process that launches the harness (`scripts/lib/harness.mjs`'s
 * `childEnv()`), never by anything shipped in the app itself, never surfaced in the renderer, and
 * never set by electron-builder or the packaged binary's own launcher - so a real user's packaged
 * install still cannot reach any of this without deliberately exporting the variable before
 * starting the binary.
 *
 * This is the same gate `DialogService.pickConfigFiles()` (`src/main/services/dialog.ts`, story 066
 * 4) already writes out inline. It lives in a named function here because story 074 needs the
 * same gate in two more places - `installations:pickFolder` below and the downloads module's
 * download-source override (`src/main/services/content/source.ts`) - and three hand-copied
 * `process.env[...] === '1'` expressions are three places one of them can drift. `DialogService`'s
 * own copy is deliberately left as it is: it is covered by its own four-case test
 * (`dialog.test.ts`) and rewriting a shipped security gate to route through a new helper is a
 * change with no upside.
 *
 * Nothing here reads `process.env` at module scope: `resolveUiHarness` takes the environment as a
 * parameter so a test can exercise every gate combination without mutating the real one. The gate
 * is frozen once per `UiHarness`; fixture variables are read live through `UiHarness.read`.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, delimiter, join } from 'node:path'
import { z } from 'zod'
import type { DetectedRunner } from '@shared/types'
import { moveFile } from './fs-utils'
import { userDataDir } from './paths'
import { scopedLogger } from './logger'

const log = scopedLogger('ui-harness')

/** The one variable that marks a UI-verification launch (`scripts/lib/harness.mjs`'s `childEnv()`). */
export const UI_HARNESS_ENV = 'Q2L_UI_HARNESS' satisfies UiHarnessVar

/**
 * The env var the harness puts the folders in that `installations:pickFolder`'s stub hands back
 * instead of opening a native OS dialog.
 *
 * A `path.delimiter`-joined **list**, in call order, exactly like `DialogService`'s
 * `Q2L_UI_PICK_FILES` - but consumed one entry per call rather than all at once, because a single
 * flow legitimately picks more than one folder: `scripts/flows/bootstrap-wizard.mjs` has to point
 * the wizard's target step at a `Program Files` path first (the first warning) and at its real fixture
 * target second (the second warning, and the folder the job then installs into). The last entry repeats
 * for every further call, so an extra pick - the write-dir remedy button, say - cannot exhaust the
 * list and turn into a surprise cancel.
 */
export const UI_HARNESS_PICK_FOLDER_ENV = 'Q2L_UI_PICK_FOLDER' satisfies UiHarnessVar

/** Every `Q2L_UI_*` variable main reads; `UiHarness.read` accepts nothing else. */
export type UiHarnessVar =
  | 'Q2L_UI_HARNESS'
  | 'Q2L_UI_VISIBLE'
  | 'Q2L_UI_PICK_FOLDER'
  | 'Q2L_UI_PICK_FILES'
  | 'Q2L_UI_CONTENT_REPO_BASE'
  | 'Q2L_UI_HARNESS_STORE_SOURCES'
  | 'Q2L_UI_STEAM_EXECUTABLE'
  | 'Q2L_UI_DETECTED_RUNNERS'
  | 'Q2L_UI_LAN_TARGETS'
  | 'Q2L_UI_SESSION_TYPE'
  | 'Q2L_UI_CINEMA_DISPLAY'
  | 'Q2L_UI_UNLOCK_PUBLIC_KEY'

/**
 * The harness gate, resolved once at boot (`AppContext.harness`). `enabled`/`offscreen` are frozen
 * decisions; `read` looks the variable up in the live env at call time, because flows mutate
 * fixture variables in the running process (`app.evaluate()`) - a value snapshot would miss that.
 */
export interface UiHarness {
  readonly enabled: boolean
  readonly offscreen: boolean
  /** The variable's current value, or `undefined` whenever the gate is closed. */
  read(name: UiHarnessVar): string | undefined
}

export function resolveUiHarness(env: NodeJS.ProcessEnv): UiHarness {
  const enabled = env[UI_HARNESS_ENV] === '1'
  const offscreen = enabled && env['Q2L_UI_VISIBLE'] !== '1'
  return Object.freeze({
    enabled,
    offscreen,
    read: (name: UiHarnessVar) => (enabled ? env[name] : undefined),
  })
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
export function uiHarnessPickedFolders(harness: UiHarness): string[] | undefined {
  if (!harness.enabled) return undefined
  const raw = harness.read(UI_HARNESS_PICK_FOLDER_ENV)
  if (raw === undefined || raw.length === 0) return []
  return raw.split(delimiter).filter((path) => path.length > 0)
}

/**
 * Story 104: the env var the harness names a stand-in Steam executable in, overriding the path
 * `detectRunners()` (`src/main/services/runners.ts`) would otherwise resolve - `<steam root>/steam.exe`
 * on Windows, `steam` on `PATH` elsewhere. It exists for the Windows branch of the `steam-handoff`
 * flow, which cannot put a Steam install into the registry of the machine it runs on.
 */
export const UI_HARNESS_STEAM_EXECUTABLE_ENV = 'Q2L_UI_STEAM_EXECUTABLE' satisfies UiHarnessVar

/**
 * The Steam executable a harness-launched run uses instead of the detected one: `undefined` when
 * the gate is closed or the variable is unset/empty, so the caller detects Steam for real. Like
 * `uiHarnessPickedFolders`, the path is not validated here - the caller still checks it is a file.
 */
export function uiHarnessSteamExecutable(harness: UiHarness): string | undefined {
  const raw = harness.read(UI_HARNESS_STEAM_EXECUTABLE_ENV)
  return raw === undefined || raw.length === 0 ? undefined : raw
}

/**
 * The environment variable the harness names its fixture server's origin in, e.g.
 * `http://127.0.0.1:53129`. Only read when the double gate is open.
 *
 * Story 082: moved here from `src/main/services/content/source.ts` (story 074's original
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
 * Story 099: where a harness-launched run's `app:openExternal` calls land instead of a real
 * `shell.openExternal` - so the upcoming e2e flow can prove the About panel's external links
 * "left through the external path and opened no app window" without a browser actually launching on
 * the test machine. Same double gate as everything else in this file (`UiHarness.enabled`); the
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
  harness: UiHarness,
  url: string,
  options: RecordHarnessExternalUrlOptions = {},
): Promise<void> {
  if (!harness.enabled) return
  const filePath = options.filePath ?? harnessExternalUrlsFilePath()
  const urls = await readHarnessExternalUrls(filePath)
  urls.push(url)
  await writeFile(filePath, JSON.stringify(urls), 'utf8')
}

/**
 * Story 105: the env var the harness names a fixture runner list in - a JSON `DetectedRunner[]`
 * (`src/shared/types/runner.ts`) - overriding what `detectRunners()`
 * (`src/main/services/runners.ts`) would otherwise detect for real. It exists so an e2e flow can
 * exercise the runner-choice UI against a known, deterministic list - Wine/umu-run/Proton/Steam
 * detection depends on what happens to be installed on the machine running the harness, which a CI
 * runner cannot control the way it controls this variable.
 */
export const UI_HARNESS_DETECTED_RUNNERS_ENV = 'Q2L_UI_DETECTED_RUNNERS' satisfies UiHarnessVar

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
export function uiHarnessDetectedRunners(harness: UiHarness): DetectedRunner[] | undefined {
  const raw = harness.read(UI_HARNESS_DETECTED_RUNNERS_ENV)
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

/** Anything missing, unreadable or not a JSON array reads back as "nothing recorded yet" - shared
 * by `recordHarnessRevealedPath` below. */
async function readHarnessExternalUrls(filePath: string): Promise<string[]> {
  return readHarnessJsonArray(filePath)
}

/**
 * Story 156: where a harness-launched run's `demos.reveal` calls land instead of a real
 * `shell.showItemInFolder` - so an e2e flow can prove the reveal action ran, against the right
 * file, without a real OS file manager window popping up on the test machine. Same shape as
 * `HARNESS_EXTERNAL_URLS_FILE`/`recordHarnessExternalUrl` right above: a test fixture, not
 * production data - plain read-modify-write, no schema, no atomic rename.
 */
export const HARNESS_REVEALED_PATHS_FILE = 'ui-harness-revealed.json'

/** `userData/ui-harness-revealed.json`. */
export function harnessRevealedPathsFilePath(): string {
  return join(userDataDir(), HARNESS_REVEALED_PATHS_FILE)
}

export interface RecordHarnessRevealedPathOptions {
  /** Defaults to `harnessRevealedPathsFilePath()`; a parameter so a test writes to a temp path. */
  filePath?: string
}

/** Appends `path` to the recorded list, creating the file (starting from `[]`) if it does not exist. */
export async function recordHarnessRevealedPath(
  harness: UiHarness,
  path: string,
  options: RecordHarnessRevealedPathOptions = {},
): Promise<void> {
  if (!harness.enabled) return
  const filePath = options.filePath ?? harnessRevealedPathsFilePath()
  const paths = await readHarnessJsonArray(filePath)
  paths.push(path)
  await writeFile(filePath, JSON.stringify(paths), 'utf8')
}

/** Anything missing, unreadable or not a JSON array reads back as "nothing recorded yet" - shared
 * by `readHarnessExternalUrls` and `recordHarnessRevealedPath`. */
async function readHarnessJsonArray(filePath: string): Promise<string[]> {
  try {
    const raw = await readFile(filePath, 'utf8')
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as string[]) : []
  } catch {
    return []
  }
}

/**
 * The harness's stand-in for the OS trash: a scripted run must not fill the test machine's real
 * Recycle Bin, yet a trashed file has to leave its folder the way it would for a user. Each file is
 * moved under a numbered name, so two trashed demos of the same name never collide, and its original
 * path is appended to `HARNESS_TRASHED_PATHS_FILE` (story 244)
 */
export const HARNESS_TRASH_DIR = 'harness-trash'
export const HARNESS_TRASHED_PATHS_FILE = 'ui-harness-trashed.json'

/** `userData/harness-trash/`. */
export function harnessTrashDir(): string {
  return join(userDataDir(), HARNESS_TRASH_DIR)
}

export interface TrashHarnessItemOptions {
  /** Defaults to `harnessTrashDir()`; a parameter so a test trashes into a temp dir. */
  trashDir?: string
  /** Defaults to `userData/ui-harness-trashed.json`. */
  filePath?: string
}

export async function trashHarnessItem(
  harness: UiHarness,
  path: string,
  options: TrashHarnessItemOptions = {},
): Promise<void> {
  if (!harness.enabled) return
  const trashDir = options.trashDir ?? harnessTrashDir()
  const filePath = options.filePath ?? join(userDataDir(), HARNESS_TRASHED_PATHS_FILE)
  const paths = await readHarnessJsonArray(filePath)
  await mkdir(trashDir, { recursive: true })
  await moveFile(path, join(trashDir, `${paths.length}-${basename(path)}`))
  paths.push(path)
  await writeFile(filePath, JSON.stringify(paths), 'utf8')
}

/**
 * Story 196: the harness's stand-in for LAN broadcast discovery. A real broadcast cannot be
 * answered by a fixture server on a CI machine, so under this override discovery sends unicast
 * `info` queries to the named loopback fixture servers instead of enumerating interfaces.
 */
export const UI_HARNESS_LAN_TARGETS_ENV = 'Q2L_UI_LAN_TARGETS' satisfies UiHarnessVar

const LAN_TARGET = /^127\.0\.0\.1:(\d{1,5})$/

/**
 * `undefined` - gate closed or variable unset/empty: discover for real. `'none'` - the harness
 * simulates a machine with zero usable interfaces. Otherwise the `127.0.0.1:<port>` entries of the
 * comma-separated list; any other entry (a non-loopback host, a bad port) is dropped, so the harness
 * can never be pointed at a foreign host. A list with no valid entry is `undefined`.
 */
export function uiHarnessLanTargets(harness: UiHarness): string[] | 'none' | undefined {
  const raw = harness.read(UI_HARNESS_LAN_TARGETS_ENV)?.trim()
  if (raw === undefined || raw.length === 0) return undefined
  if (raw === 'none') return 'none'
  const targets = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => {
      const match = LAN_TARGET.exec(entry)
      if (match === null) return false
      const port = Number(match[1])
      return port >= 1 && port <= 65535
    })
  return targets.length > 0 ? targets : undefined
}
