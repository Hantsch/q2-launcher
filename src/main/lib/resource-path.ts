import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** The marker file that identifies the repo root - this repo has exactly one, at the root. */
const REPO_ROOT_MARKER = 'package.json'

/** Enough to cover both `out/main` (2) and `src/main/lib/archive` (4) with room to spare. */
const MAX_WALK_UP_LEVELS = 12

/**
 * Nearest ancestor of `startDir` (inclusive) that contains a `package.json`, or `process.cwd()`
 * when no such directory is found within `maxLevels`. Counting `..` segments cannot work: the
 * main process is bundled into `<repo>/out/main/index.js`, while under vitest the sources load
 * unbundled from `<repo>/src/main/...`. Exported so a test can point the walk-up at a constructed
 * tree.
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

export interface ResourceLocation {
  /** `app.isPackaged` in production; pass `false` in dev and in tests. */
  isPackaged: boolean
  /** `process.resourcesPath` in production; ignored when `isPackaged` is `false`. */
  resourcesPath?: string
  /** Repo root in dev; ignored when `isPackaged` is `true`. Defaults to this file's repo root. */
  repoRoot?: string
}

/**
 * Absolute path of a bundled resource: `<resourcesPath>/<segments>` when packaged (the
 * `electron-builder.yml` `extraResources` target), `<repo>/resources/<segments>` in dev. Takes its
 * inputs as parameters instead of importing `electron`, so it is testable without a runtime.
 */
export function resolveResourcePath(location: ResourceLocation, ...segments: string[]): string {
  return location.isPackaged
    ? join(location.resourcesPath ?? '', ...segments)
    : join(location.repoRoot ?? DEFAULT_REPO_ROOT, 'resources', ...segments)
}
