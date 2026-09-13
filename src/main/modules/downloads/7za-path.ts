import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * Story 071 D3: resolves the absolute path to the vendored `7za.exe` binary.
 *
 * Dev: `resources/bin/7za.exe` relative to the repo root, found by walking
 * *upward* from this file's own directory to the nearest ancestor that contains
 * a `package.json` (this repo has exactly one, at the root). Counting `..`
 * segments cannot work here, because the number of levels differs per context:
 * electron-vite bundles the whole main process into a single `out/main/index.js`
 * (so `__dirname` is `<repo>/out/main`), while under vitest this module is not
 * bundled at all (`__dirname` is `<repo>/src/main/modules/downloads`). The
 * walk-up is correct for both, and for any future bundle layout. If no marker is
 * found within `MAX_WALK_UP_LEVELS`, it falls back to `process.cwd()`.
 * Packaged: `process.resourcesPath/bin/7za.exe`, matching this module's
 * `electron-builder.yml` `extraResources` entry (`resources/bin` -> `bin`) - the
 * dev walk-up is never used there, since the app lives inside `app.asar`.
 *
 * Deliberately takes its inputs as parameters rather than importing `electron`
 * at module scope, so this is plain, synchronous and testable without a real
 * Electron runtime - point `repoRoot`/`resourcesPath` at a temp directory in
 * tests, or call `findRepoRoot()` with a constructed start directory to exercise
 * the walk-up itself. Never throws: a missing binary is a normal, expected
 * outcome (`downloads.error.extractorMissing`), not a crash.
 */
export interface ExtractorPathInput {
  /** `app.isPackaged` in production; pass `false` in dev and in tests. */
  isPackaged: boolean
  /** `process.resourcesPath` in production; ignored when `isPackaged` is `false`. */
  resourcesPath?: string
  /** Repo root in dev; ignored when `isPackaged` is `true`. Defaults to this file's repo root. */
  repoRoot?: string
}

export interface ExtractorPathResult {
  /** Absolute path the binary is expected at, whether or not it exists. */
  path: string
  /** Whether a file actually exists at `path`. */
  exists: boolean
}

const BINARY_NAME = '7za.exe'

/** The marker file that identifies the repo root - this repo has exactly one, at the root. */
const REPO_ROOT_MARKER = 'package.json'

/** Enough to cover both `out/main` (2) and `src/main/modules/downloads` (4) with room to spare. */
const MAX_WALK_UP_LEVELS = 12

/**
 * Nearest ancestor of `startDir` (inclusive) that contains a `package.json`, or `process.cwd()`
 * when no such directory is found within `maxLevels`. Exported so a test can point the walk-up at
 * a constructed directory tree instead of relying on wherever the test runner happens to load this
 * module from - the exact assumption whose breakage this function exists to prevent.
 */
export function findRepoRoot(startDir: string, maxLevels: number = MAX_WALK_UP_LEVELS): string {
  let current = startDir
  for (let level = 0; level < maxLevels; level += 1) {
    if (existsSync(join(current, REPO_ROOT_MARKER))) return current
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return process.cwd()
}

const DEFAULT_REPO_ROOT = findRepoRoot(__dirname)

export function resolveExtractorPath(input: ExtractorPathInput): ExtractorPathResult {
  const path = input.isPackaged
    ? join(input.resourcesPath ?? '', 'bin', BINARY_NAME)
    : join(input.repoRoot ?? DEFAULT_REPO_ROOT, 'resources', 'bin', BINARY_NAME)

  return { path, exists: existsSync(path) }
}
