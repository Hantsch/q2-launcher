import { basename, join } from 'node:path'
import { BASE_GAME_DIR, KNOWN_GAME_DIRS, NON_GAME_DIRS, RETAIL_PAK_SIZES } from '@shared/constants'
import { ENGINE_DEFINITIONS, type EngineDefinition, type EngineKind } from '@shared/types'
import type {
  BinaryKind,
  CheckSeverity,
  InstallationStatus,
  ValidationCheck,
  ValidationResult,
} from '@shared/types'
import {
  fileSize,
  isDirectory,
  isFile,
  isWritableDir,
  listDir,
  looksExecutable,
  readBinaryKind,
  resolveRelaxed,
} from '../lib/fs-utils'
import { readSteamAppId } from './steam'

/**
 * Decides whether a folder is a usable Quake II installation, what engine it
 * holds, and what is wrong with it.
 *
 * This is the single source of truth for installation health: the add-dialog
 * preview, the detection scan and the periodic revalidation all call it, so the
 * user can never see two different verdicts about the same folder.
 */

export interface InspectOptions {
  /** Prefer this executable if it still exists. */
  executablePath?: string
  /** Separate write directory to test instead of `<root>/baseq2`. */
  writeDirPath?: string
}

const PAK_EXTENSIONS = ['.pak', '.pkz', '.pk3']

function check(
  id: ValidationCheck['id'],
  severity: CheckSeverity,
  messageKey: string,
  extra: { params?: ValidationCheck['params']; fix?: ValidationCheck['fix'] } = {},
): ValidationCheck {
  return {
    id,
    severity,
    messageKey,
    ...(extra.params ? { params: extra.params } : {}),
    ...(extra.fix ? { fix: extra.fix } : {}),
  }
}

function statusFrom(checks: ValidationCheck[], rootMissing: boolean): InstallationStatus {
  if (rootMissing) return 'missing'
  if (checks.some((c) => c.severity === 'error')) return 'invalid'
  if (checks.some((c) => c.severity === 'warn')) return 'warning'
  return 'ok'
}

/** Matches an engine by its marker files first, falling back to executable names. */
async function classifyEngine(
  rootPath: string,
  rootFileNames: Set<string>,
): Promise<{ kind: EngineKind; definition?: EngineDefinition }> {
  for (const definition of ENGINE_DEFINITIONS) {
    for (const marker of definition.markers) {
      // Markers may be nested (`baseq2/game.dll`) or a bare directory (`rerelease`).
      if (marker.includes('/')) {
        if (await resolveRelaxed(rootPath, marker)) return { kind: definition.kind, definition }
      } else if (rootFileNames.has(marker.toLowerCase())) {
        return { kind: definition.kind, definition }
      } else if (await isDirectory(join(rootPath, marker))) {
        return { kind: definition.kind, definition }
      }
    }
  }

  for (const definition of ENGINE_DEFINITIONS) {
    if (definition.executables.some((exe) => rootFileNames.has(exe.toLowerCase()))) {
      return { kind: definition.kind, definition }
    }
  }

  return { kind: 'unknown' }
}

/**
 * Client executables in the root, best first: the identified engine's preferred
 * names, then anything else that looks runnable. Dedicated-server binaries are
 * pushed to the back so they are never auto-selected.
 *
 * Story 103 D2: off Windows, a native binary (`elf`/`script`) outranks a Windows `pe` before any
 * of that name ranking applies - a folder holding both `quake2` and `quake2.exe` on Linux must
 * pick the one the machine can actually execute, and the name ranking alone picks the `.exe`. The
 * name ranking then decides the order *within* each of the two groups, unchanged.
 *
 * On Windows this function is exactly what it has always been (AC8): the platform branch returns
 * before any header is read, so no installation on the platform ~80% of users are on can get a
 * different executable out of this than it did before the story.
 */
async function rankExecutables(
  rootPath: string,
  fileNames: string[],
  definition: EngineDefinition | undefined,
): Promise<string[]> {
  const executables: string[] = []
  for (const name of fileNames) {
    if (await looksExecutable(rootPath, name)) executables.push(name)
  }

  const preferred = definition?.executables.map((e) => e.toLowerCase()) ?? []
  const dedicated = definition?.dedicatedExecutables.map((e) => e.toLowerCase()) ?? []

  const rank = (name: string): number => {
    const lower = name.toLowerCase()
    if (dedicated.includes(lower)) return 900
    if (/ded(icated)?\.exe$/i.test(name)) return 800
    const index = preferred.indexOf(lower)
    if (index >= 0) return index
    // Unrelated tooling that ships next to some ports.
    if (/^(unins|setup|vcredist|dxsetup|launcher)/i.test(name)) return 950
    return 500
  }

  const byName = (a: string, b: string): number => rank(a) - rank(b) || a.localeCompare(b)

  if (process.platform === 'win32') return executables.sort(byName)

  const kinds = new Map<string, BinaryKind>()
  for (const name of executables) {
    kinds.set(name, await readBinaryKind(join(rootPath, name)))
  }
  // Two groups only: what this machine can run natively, and everything else (a `pe`, or a file
  // whose first bytes say nothing - which off Windows is still more likely to be runnable than a
  // Windows binary, but not something to promote over a real ELF).
  const nativeFirst = (name: string): number => {
    const kind = kinds.get(name)
    return kind === 'elf' || kind === 'script' ? 0 : 1
  }

  return executables.sort((a, b) => nativeFirst(a) - nativeFirst(b) || byName(a, b))
}

/**
 * Story 103 D2: the header kind of the executable an inspection settled on, or `undefined` on
 * Windows - where `.exe` is the whole question and AC8 forbids the read. Deliberately reads the
 * chosen path rather than reusing `rankExecutables`' map: the chosen executable may be the
 * caller's own `executablePath`, which does not have to be one of the root's ranked candidates.
 */
async function chosenExecutableKind(executablePath: string): Promise<BinaryKind | undefined> {
  if (process.platform === 'win32') return undefined
  return readBinaryKind(executablePath)
}

/** A sibling directory counts as a game dir if it holds pak files or game code. */
async function isGameDir(rootPath: string, dirName: string): Promise<boolean> {
  if (NON_GAME_DIRS.has(dirName.toLowerCase())) return false
  if ((KNOWN_GAME_DIRS as readonly string[]).includes(dirName.toLowerCase())) return true

  const listing = await listDir(join(rootPath, dirName))
  return listing.files.some((file) => {
    const lower = file.toLowerCase()
    return (
      PAK_EXTENSIONS.some((ext) => lower.endsWith(ext)) ||
      lower === 'game.dll' ||
      lower === 'gamex86.dll' ||
      lower === 'gamex86_64.dll' ||
      lower.endsWith('.so')
    )
  })
}

export async function inspectInstallation(
  rootPath: string,
  options: InspectOptions = {},
): Promise<ValidationResult> {
  const checkedAt = new Date().toISOString()
  const checks: ValidationCheck[] = []

  if (!(await isDirectory(rootPath))) {
    checks.push(
      check('root-exists', 'error', 'validation.rootMissing', {
        params: { path: rootPath },
        fix: 'locate-root',
      }),
    )
    return {
      status: 'missing',
      checks,
      gameDirs: [],
      executables: [],
      engineKind: 'unknown',
      checkedAt,
    }
  }

  const rootListing = await listDir(rootPath)
  const rootFileNames = new Set(rootListing.files.map((f) => f.toLowerCase()))

  const { kind: engineKind, definition } = await classifyEngine(rootPath, rootFileNames)
  if (engineKind === 'unknown') {
    checks.push(
      check('engine-identified', 'warn', 'validation.engineUnknown', { fix: 'select-executable' }),
    )
  }

  // --- base game directory -------------------------------------------------
  const baseDirName = rootListing.byLowerName.get(BASE_GAME_DIR)
  const baseDirPath = baseDirName ? join(rootPath, baseDirName) : null

  if (!baseDirPath) {
    checks.push(
      check('base-game-dir', 'error', 'validation.baseDirMissing', {
        params: { dir: BASE_GAME_DIR },
        fix: 'install-game-files',
      }),
    )
  } else {
    const baseListing = await listDir(baseDirPath)
    const pak0Name = baseListing.byLowerName.get('pak0.pak')
    const hasRetailPaks =
      baseListing.byLowerName.has('pak1.pak') && baseListing.byLowerName.has('pak2.pak')
    const anyPak = baseListing.files.some((f) =>
      PAK_EXTENSIONS.some((ext) => f.toLowerCase().endsWith(ext)),
    )

    if (!pak0Name && !anyPak) {
      checks.push(
        check('base-paks', 'error', 'validation.pak0Missing', { fix: 'install-game-files' }),
      )
    } else if (!pak0Name) {
      // Repacked or remastered installs may not have the classic pak0.pak.
      checks.push(check('base-paks', 'warn', 'validation.pak0MissingButPaksPresent'))
    } else {
      // Size is the cheap way to tell the shareware demo from the full game -
      // the demo ships a much smaller pak0.pak under the same name, and a
      // hash of 180 MB is far too slow for a check that runs on every startup.
      const size = await fileSize(join(baseDirPath, pak0Name))
      if (size !== null && size !== RETAIL_PAK_SIZES['pak0.pak']) {
        checks.push(
          check('base-paks', 'info', 'validation.pak0NotRetail', { fix: 'install-game-files' }),
        )
      } else if (!baseListing.byLowerName.has('pak1.pak')) {
        checks.push(
          check('base-paks', 'warn', 'validation.retailPaksMissing', {
            fix: 'install-game-files',
          }),
        )
      } else if (!hasRetailPaks) {
        // pak0/pak1 are present and retail-sized, only pak2.pak (the 3.20
        // point release) is missing - a narrower, more fixable case than the
        // base retail paks being absent altogether.
        checks.push(
          check('base-paks', 'warn', 'validation.pointReleaseMissing', {
            fix: 'install-game-files',
          }),
        )
      }
    }
  }

  // --- executable ----------------------------------------------------------
  const executables = await rankExecutables(rootPath, rootListing.files, definition)
  let executablePath: string | undefined

  if (options.executablePath && (await isFile(options.executablePath))) {
    executablePath = options.executablePath
  } else if (executables.length > 0) {
    executablePath = join(rootPath, executables[0])
  }

  const executableKind = executablePath ? await chosenExecutableKind(executablePath) : undefined
  const steamAppId = await readSteamAppId(rootPath)

  if (!executablePath) {
    checks.push(
      check('executable', 'error', 'validation.noExecutable', { fix: 'select-executable' }),
    )
  } else if (options.executablePath && options.executablePath !== executablePath) {
    checks.push(
      check('executable', 'warn', 'validation.executableMissing', {
        params: { path: options.executablePath },
        fix: 'select-executable',
      }),
    )
  }

  // Story 103 D3: off Windows, a `.exe` the machine cannot run natively is never silently
  // playable - it needs a runner (Proton/Wine or similar), which D7 lets the user pick.
  //
  // `warn`, not `error`, and that severity is load-bearing: `statusFrom` turns any `error` into
  // status `'invalid'`, which `isPlayable` (renderer `lib/status.ts`) refuses, so an `error` here
  // would grey out Play permanently - even after the user picks a working wine/umu runner in the
  // Runner section (D7), making AC5's "a launch like any other" unreachable through the UI and
  // AC7's "pressing Play refuses with that reason" unpressable. The refusal AC7 asks for belongs
  // to `LaunchService.plan()` (`launch.error.noRunner`, D5), which fires before `spawn` and is
  // toasted by the store's generic launch-error path; this check's job is only to *say* so up
  // front, in visible text (AC2) - which `warn` does, while leaving the installation startable.
  if (executablePath && process.platform !== 'win32' && executableKind === 'pe') {
    checks.push(
      check('executable-runnable', 'warn', 'validation.executableRunnable', {
        params: { executable: basename(executablePath) },
        fix: 'choose-runner',
      }),
    )
  }

  // --- write access --------------------------------------------------------
  const writeTarget = options.writeDirPath ?? baseDirPath ?? rootPath
  if (!(await isWritableDir(writeTarget))) {
    checks.push(
      check('write-access', 'warn', 'validation.notWritable', {
        params: { path: writeTarget },
        fix: 'set-write-dir',
      }),
    )
  }

  // --- game directories ----------------------------------------------------
  const gameDirs: string[] = []
  for (const dir of rootListing.dirs) {
    if (await isGameDir(rootPath, dir)) gameDirs.push(dir)
  }
  gameDirs.sort((a, b) => {
    if (a.toLowerCase() === BASE_GAME_DIR) return -1
    if (b.toLowerCase() === BASE_GAME_DIR) return 1
    return a.localeCompare(b)
  })

  return {
    status: statusFrom(checks, false),
    checks,
    gameDirs,
    executables: executables.map((name) => join(rootPath, name)),
    engineKind,
    ...(executableKind ? { executableKind } : {}),
    ...(steamAppId ? { steamAppId } : {}),
    checkedAt,
  }
}

/**
 * Human-facing default name for a freshly imported installation.
 *
 * Just the folder name. People already name these folders meaningfully
 * ("Quake II - r1q2", "Q2 CTF"), and prefixing the engine label produced
 * duplicates like "R1Q2 - Quake II - r1q2". The engine is shown as a badge
 * everywhere the name appears, so it does not need to be in the name.
 */
export function suggestName(rootPath: string): string {
  return rootPath.split(/[\\/]/).filter(Boolean).pop() ?? 'Quake II'
}
