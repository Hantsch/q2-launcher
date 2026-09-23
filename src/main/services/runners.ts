import { delimiter, join } from 'node:path'
import {
  NATIVE_RUNNER_CHOICE,
  STEAM_APP_CLIENTS,
  STEAM_RUNNER_CHOICE,
  type DetectedRunner,
  type Installation,
  type RunnerKind,
} from '@shared/types'
import { isFile, listDir, looksExecutable } from '../lib/fs-utils'
import { uiHarnessSteamExecutable } from '../lib/ui-harness'
import { findSteamRoot, steamLibraryRoots } from './detection/providers'
import { scopedLogger } from '../lib/logger'

const log = scopedLogger('runners')

/** Folder names Steam gives Proton builds under `steamapps/common/` (`Proton - Experimental`, `Proton 8.0`, ...). */
const PROTON_FOLDER = /^proton/i

const NATIVE_RUNNER: DetectedRunner = { kind: 'native', id: 'native', path: '', available: true }

/**
 * Story 103 D4. Reports every runner found on the host: the OS itself, plus whichever
 * Windows-compatibility layers (Wine, Steam's `umu-run`, Proton) are actually installed. Nothing
 * here decides which runner an installation should use - D5 does that at resolve time - this is
 * just an inventory.
 *
 * On `win32` Wine/umu-run/Proton have no meaning, so neither `PATH` nor the Steam libraries are
 * touched on that branch. Story 104 D3 adds the one runner that does exist there too: Steam
 * (`<steam root>/steam.exe`). Listing it changes nothing about how anything launches - only an
 * installation whose stored choice is `'steam'` ever resolves to it (see `resolveRunner`), and
 * `LaunchService.plan()` does not even call this function on Windows.
 */
export async function detectRunners(): Promise<DetectedRunner[]> {
  if (process.platform === 'win32') return [NATIVE_RUNNER, await findSteam()]

  const [wine, umu, steam, proton] = await Promise.all([
    findOnPath('wine', 'wine'),
    findOnPath('umu', 'umu-run'),
    findSteam(),
    findProtonBuilds(),
  ])

  return [NATIVE_RUNNER, wine, umu, steam, ...proton]
}

/** Why the Steam runner cannot be chosen for one installation - i18n keys, in the order they are judged. */
export type SteamUnavailableReason =
  | 'runner.unavailable.steam'
  | 'runner.unavailable.steamNotOwner'
  | 'runner.unavailable.steamUnknownApp'

/**
 * Story 104 D3: whether the Steam runner is usable for this installation, and if not, why - the one
 * judgement both `installations:listRunners` (what the UI offers) and `resolveRunner` (what
 * actually launches) read, so the two cannot disagree. First failing check wins:
 *
 *  1. no Steam executable was found on this machine;
 *  2. the installation is not a Steam copy (no `steamAppId` - Steam does not own this folder);
 *  3. the appid has no client table, so there is no `steam://launch/<appid>/client/<n>` to hand off.
 */
export function steamUnavailableReason(
  steam: DetectedRunner | undefined,
  installation: Pick<Installation, 'steamAppId'>,
): SteamUnavailableReason | undefined {
  if (!steam?.available) return 'runner.unavailable.steam'
  if (!installation.steamAppId) return 'runner.unavailable.steamNotOwner'
  if (!Object.prototype.hasOwnProperty.call(STEAM_APP_CLIENTS, installation.steamAppId)) {
    return 'runner.unavailable.steamUnknownApp'
  }
  return undefined
}

/**
 * The runner kinds that actually *wrap* a launch, best first (story 103 Q1): `wine <exe> <args>`
 * and `umu-run <exe> <args>` are one-line wrappers, and plain wine comes first because it is the
 * machine-default-prefix behaviour Q2 settled on ("exactly like typing `wine quake2.exe`"). A
 * detected `proton` runner is deliberately absent: Proton is detected and offered only as a future
 * umu-run target, never driven directly.
 */
const WRAPPING_KINDS: RunnerKind[] = ['wine', 'umu']

/** The subset of an installation `resolveRunner` reads - kept narrow so callers (and tests) need no more. */
export type RunnerRelevantInstallation = Pick<
  Installation,
  'runner' | 'executableKind' | 'steamAppId'
>

/**
 * Story 103 D5: whether this installation's executable cannot be run by the OS itself and therefore
 * needs a compatibility runner. True only off Windows and only for a binary whose header actually
 * said `MZ` (D1/D2's `executableKind`) - "absent" means "kind not known", never "not native", so an
 * installation recorded before that field existed keeps launching exactly as it does today.
 *
 * On `win32` this is the single branch that keeps AC8's promise: nothing below it ever runs there.
 */
export function needsCompatRunner(installation: RunnerRelevantInstallation): boolean {
  return process.platform !== 'win32' && installation.executableKind === 'pe'
}

/**
 * Story 103 D5, AC4: which runner this installation's executable should be launched through -
 * `undefined` when nothing on this machine can run it (which is what makes `LaunchService.plan()`
 * refuse, AC7).
 *
 * Story 104 D3 puts one guard in front of the cascade: a stored `'steam'` choice wins - on every
 * platform, whatever the executable's kind - but only while `steamUnavailableReason` finds nothing
 * wrong. Any other stored choice, no choice at all, or a `'steam'` choice Steam cannot serve right
 * now falls straight through to the cascade below, unchanged from story 103. Steam is never a
 * default: nothing but that explicit choice reaches it (`WRAPPING_KINDS` does not list it either).
 *
 * The cascade, in order:
 *
 *  1. native, whenever the executable does not need a wrapper at all - always the answer on
 *     `win32` (AC8), and off Windows for an ELF/script/unknown binary;
 *  2. the user's own choice, when they made one and it is a wrapping runner that is installed
 *     right now. A choice of `'native'` for a Windows PE is *not* honoured: native is exactly what
 *     cannot run it (that is the bug this story fixes), so it falls through like an unavailable
 *     runner does rather than silently reproducing the 4-second phantom launch;
 *  3. the best detected wrapping runner (`WRAPPING_KINDS` order);
 *  4. nothing.
 *
 * Pure: it decides from a `detected` list it is handed, never by looking at the machine itself, so
 * the detection cost is the caller's to pay (and to skip - see `needsCompatRunner`).
 */
export function resolveRunner(
  installation: RunnerRelevantInstallation,
  detected: DetectedRunner[],
): DetectedRunner | undefined {
  if (installation.runner === STEAM_RUNNER_CHOICE) {
    const steam = detected.find((runner) => runner.kind === 'steam')
    if (steam && steamUnavailableReason(steam, installation) === undefined) return steam
  }

  if (!needsCompatRunner(installation)) {
    return detected.find((runner) => runner.kind === 'native') ?? NATIVE_RUNNER
  }

  const usable = detected.filter(
    (runner) => runner.available && WRAPPING_KINDS.includes(runner.kind),
  )
  const chosen =
    installation.runner && installation.runner !== NATIVE_RUNNER_CHOICE
      ? usable.find((runner) => runner.id === installation.runner)
      : undefined

  return (
    chosen ??
    WRAPPING_KINDS.map((kind) => usable.find((runner) => runner.kind === kind)).find(
      (runner) => runner !== undefined,
    )
  )
}

/**
 * Searches every directory on `PATH`, in order, for an executable file named `executableName`.
 * Always returns an entry for `kind` - `available: false` with an empty path when nothing was
 * found - so wine/umu-run are still listed as "not detected" rather than silently omitted (D7
 * renders that; this just supplies the shape).
 */
async function findOnPath(
  kind: 'wine' | 'umu' | 'steam',
  executableName: string,
): Promise<DetectedRunner> {
  const dirs = (process.env['PATH'] ?? '').split(delimiter).filter(Boolean)
  for (const dir of dirs) {
    if (await looksExecutable(dir, executableName)) {
      return { kind, id: kind, path: join(dir, executableName), available: true }
    }
  }
  return { kind, id: kind, path: '', available: false }
}

/**
 * Story 104 D3: the Steam client's executable. Always returns an entry - `available: false` with an
 * empty path when none was found - like `findOnPath` does for wine/umu-run.
 *
 *  - harness override (`Q2L_UI_STEAM_EXECUTABLE`, only behind `isUiHarnessEnabled`) on any
 *    platform - still required to be a real file;
 *  - off Windows: `steam` on `PATH`;
 *  - on Windows: `steam.exe` in the Steam root the registry names (`findSteamRoot`) - no `PATH`
 *    walk, no library scan.
 */
async function findSteam(): Promise<DetectedRunner> {
  // `isDev` is part of the gate's input type but not read by it (see ui-harness.ts).
  const override = uiHarnessSteamExecutable({ isDev: false })
  if (override !== undefined) return steamRunner((await isFile(override)) ? override : undefined)

  if (process.platform !== 'win32') return findOnPath('steam', 'steam')

  const steamRoot = await findSteamRoot()
  const executable = steamRoot ? join(steamRoot, 'steam.exe') : undefined
  return steamRunner(executable && (await isFile(executable)) ? executable : undefined)
}

function steamRunner(path: string | undefined): DetectedRunner {
  return path
    ? { kind: 'steam', id: STEAM_RUNNER_CHOICE, path, available: true }
    : { kind: 'steam', id: STEAM_RUNNER_CHOICE, path: '', available: false }
}

/**
 * Proton builds under each Steam library's `steamapps/common/`. Unlike wine/umu-run, only builds
 * that are actually found are reported - there is no single well-known "the Proton" to report as
 * missing, and the story's AC3 ("nothing is assumed present") applies here too.
 */
async function findProtonBuilds(): Promise<DetectedRunner[]> {
  const steamRoot = await findSteamRoot()
  if (!steamRoot) return []

  const found: DetectedRunner[] = []
  for (const library of await steamLibraryRoots(steamRoot)) {
    const commonDir = join(library, 'steamapps', 'common')
    const listing = await listDir(commonDir)
    for (const dir of listing.dirs) {
      if (!PROTON_FOLDER.test(dir)) continue
      found.push({
        kind: 'proton',
        id: slugify(dir),
        label: dir,
        path: join(commonDir, dir),
        available: true,
      })
    }
  }
  log.debug(`proton: ${found.length} build(s)`)
  return found
}

/** `Proton - Experimental` -> `proton-experimental`, for a stable, filesystem-agnostic id. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
