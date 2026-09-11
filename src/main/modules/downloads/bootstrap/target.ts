import { randomUUID } from 'node:crypto'
import { rm, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, sep } from 'node:path'
import type { BootstrapTargetVerdict } from '@shared/modules/downloads'
import type { ValidationResult } from '@shared/types'
import { canonicalizePath, isDirectory, listDir, pathKey } from '../../../lib/fs-utils'
import { inspectInstallation } from '../../../services/inspector'

/**
 * Story 074 D2: computes the target-folder verdict the bootstrap wizard's target-folder step
 * renders (AC3) - "the wizard renders verdicts, it never judges paths itself" (Decisions
 * (Sprint)). Everything here is a pure fact-gathering pass over one folder; the wizard UI (a later
 * deliverable) decides what to *do* with a non-blocking warning.
 */

/** How many directory entries `entries[]` carries at most - just enough for the AC3 warning list. */
export const MAX_TARGET_VERDICT_ENTRIES = 20

/**
 * Windows reserved device names, checked against the target's final path segment without its
 * extension (`NUL.txt` is exactly as unusable as `NUL`). Case-insensitive, like every other check
 * here - Windows paths are.
 */
const RESERVED_DEVICE_NAMES = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9',
])

/** Matches a `\\.\...` or `\\?\...` device/verbatim path, never a real directory a wizard writes to. */
const DEVICE_PATH_RE = /^\\\\[.?]\\/

export interface ComputeTargetVerdictOptions {
  /** Overrides `process.env`, so a test can set `ProgramFiles`/`ProgramFiles(x86)` without
   * touching the real environment. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv
  /**
   * Absolute directories the target must never be inside of - the launcher's own installation
   * directory. Defaults to `[process.resourcesPath]` when it is set; `app.getAppPath()` is
   * deliberately not read here, since that needs the `app` module and this function stays
   * import-free of `electron` on purpose (same reasoning as `7za-path.ts`'s parameterised
   * `isPackaged`/`resourcesPath`) - a caller wired to the real app can widen this list with
   * `app.getAppPath()` once this function is actually reached by an IPC handler (a later
   * deliverable).
   */
  protectedDirs?: string[]
}

/**
 * `looksLikeQuake2` from `src/main/services/installations.ts`, replicated rather than imported:
 * that function is not exported, and this deliverable must not change `installations.ts`'s
 * behavior to get at it. Keep this in sync with that copy if the "what counts as installed" rule
 * ever changes.
 */
function looksLikeQuake2(result: ValidationResult): boolean {
  if (result.status === 'missing') return false
  const missingBaseDir = result.checks.some(
    (check) => check.id === 'base-game-dir' && check.severity === 'error',
  )
  return !missingBaseDir || result.engineKind !== 'unknown'
}

/** True when `child` is `parent` itself or lives somewhere underneath it. Case-insensitive via
 * `pathKey`, since both inputs are expected to already be absolute/canonical. */
function isInsideDir(child: string, parent: string): boolean {
  const childKey = pathKey(child)
  const parentKey = pathKey(parent)
  return childKey === parentKey || childKey.startsWith(parentKey + sep)
}

/** Case-insensitive prefix match against `%ProgramFiles%`/`%ProgramFiles(x86)%`, when set. */
function isUnderProgramFiles(canonicalTarget: string, env: NodeJS.ProcessEnv): boolean {
  const roots = [env.ProgramFiles, env['ProgramFiles(x86)']].filter((v): v is string => !!v)
  return roots.some((root) => isInsideDir(canonicalTarget, root))
}

function isReservedDeviceName(canonicalTarget: string): boolean {
  const stem = basename(canonicalTarget).split('.')[0]?.toLowerCase() ?? ''
  return RESERVED_DEVICE_NAMES.has(stem)
}

/**
 * Walks up from `target` to the nearest ancestor that actually exists, so the writability probe
 * below has somewhere real to write into even when the target folder itself does not exist yet
 * (the common case - the wizard is about to create it).
 */
async function nearestExistingAncestor(target: string): Promise<string> {
  let current = target
  for (;;) {
    if (await isDirectory(current)) return current
    const parent = dirname(current)
    if (parent === current) return current // reached the filesystem root; give up gracefully
    current = parent
  }
}

/** Creates and immediately removes a marker file to cheaply probe writability. */
async function probeWritable(dir: string): Promise<boolean> {
  const marker = `${dir}${sep}.q2-launcher-write-probe-${randomUUID()}`
  try {
    await writeFile(marker, '')
  } catch {
    return false
  }
  await rm(marker, { force: true }).catch(() => {})
  return true
}

/**
 * Story 089 D2: the path-shape half of `computeTargetVerdict`'s `unsafePath` check, pulled out so
 * `game-data-source.ts`'s `inspectGameDataSource` can reject the same class of unsafe paths (device
 * paths, non-absolute paths, reserved Windows device names) without pulling in the target-specific
 * `protectedDirs`/writability/`alreadyInstalled` checks below, which need a *target* path and make
 * no sense for a read-only source folder.
 */
export async function isUnsafeAbsolutePath(path: string): Promise<boolean> {
  const canonical = await canonicalizePath(path)
  return (
    !isAbsolute(path) ||
    !isAbsolute(canonical) ||
    DEVICE_PATH_RE.test(path) ||
    isReservedDeviceName(canonical)
  )
}

export async function computeTargetVerdict(
  targetPath: string,
  options: ComputeTargetVerdictOptions = {},
): Promise<BootstrapTargetVerdict> {
  const env = options.env ?? process.env
  const protectedDirs =
    options.protectedDirs ?? (process.resourcesPath ? [process.resourcesPath] : [])

  const canonicalTarget = await canonicalizePath(targetPath)

  const unsafePath =
    (await isUnsafeAbsolutePath(targetPath)) ||
    protectedDirs.some((dir) => isInsideDir(canonicalTarget, dir))

  const programFiles = isUnderProgramFiles(canonicalTarget, env)

  // Paths from the renderer are never trusted (CLAUDE.md). An unsafe path short-circuits here,
  // before any read of the target's contents, any `inspectInstallation` call or any writability
  // probe against it - none of that ever needs to touch a path this launcher will never write to.
  if (unsafePath) {
    return {
      targetPath: canonicalTarget,
      programFiles,
      notWritable: false,
      entries: [],
      alreadyInstalled: false,
      blocked: true,
      blockedReason: 'unsafePath',
    }
  }

  const exists = await isDirectory(canonicalTarget)
  const entries = exists
    ? (await listDir(canonicalTarget)).names.slice(0, MAX_TARGET_VERDICT_ENTRIES)
    : []

  const alreadyInstalled = exists
    ? looksLikeQuake2(await inspectInstallation(canonicalTarget))
    : false

  const probeDir = exists ? canonicalTarget : await nearestExistingAncestor(canonicalTarget)
  const notWritable = !(await probeWritable(probeDir))

  return {
    targetPath: canonicalTarget,
    programFiles,
    notWritable,
    entries,
    alreadyInstalled,
    blocked: alreadyInstalled,
    ...(alreadyInstalled ? { blockedReason: 'alreadyInstalled' as const } : {}),
  }
}
