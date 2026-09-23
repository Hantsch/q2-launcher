import { delimiter, join } from 'node:path'
import { NATIVE_RUNNER_CHOICE, type DetectedRunner, type Installation, type RunnerKind } from '@shared/types'
import { listDir, looksExecutable } from '../lib/fs-utils'
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
 * On `win32` the native runner is the only possibility: Wine/umu-run/Proton have no meaning there,
 * so neither `PATH` nor the Steam libraries are touched on this branch at all.
 */
export async function detectRunners(): Promise<DetectedRunner[]> {
  if (process.platform === 'win32') return [NATIVE_RUNNER]

  const [wine, umu, proton] = await Promise.all([
    findOnPath('wine', 'wine'),
    findOnPath('umu', 'umu-run'),
    findProtonBuilds(),
  ])

  return [NATIVE_RUNNER, wine, umu, ...proton]
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
export type RunnerRelevantInstallation = Pick<Installation, 'runner' | 'executableKind'>

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
  kind: 'wine' | 'umu',
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
