// Path facts shared by every UI-verification script under scripts/.
//
// Everything is derived from this file's own location, never from
// `process.cwd()`: the harness is started from npm scripts, from a plain
// `node scripts/...` in a subfolder and from build sessions, and all three must
// resolve the same repo root and the same output folder.
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** `<repo>/scripts/lib/paths.mjs` -> `<repo>`. */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** The one git-ignored folder every run may write to (fixtures, screenshots, reports). */
export const UI_VERIFY_ROOT = join(REPO_ROOT, '.ui-verify')

/**
 * The harness's own error type. It lives here rather than in `harness.mjs`
 * because the containment guard below throws it and `paths.mjs` must not import
 * `harness.mjs`; `harness.mjs` re-exports it.
 *
 * Scripts treat it as "expected failure, print the message" — everything else
 * is a bug and keeps its stack trace.
 */
export class HarnessError extends Error {
  constructor(message, options) {
    super(message, options)
    this.name = 'HarnessError'
  }
}

/**
 * True when `candidate` is a strict descendant of `parent`.
 *
 * `relative()` does the comparison so `..` segments cannot sneak out and so
 * Windows' case-insensitive paths compare the way the filesystem does. A
 * candidate equal to `parent` is not "inside" it.
 */
export function isInside(parent, candidate) {
  const rel = relative(resolve(parent), resolve(candidate))
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

/** `isInside`, as a guard: throws instead of returning false. */
export function assertInside(parent, candidate, label = 'path') {
  if (isInside(parent, candidate)) return resolve(candidate)
  throw new HarnessError(
    `${label} must be inside ${resolve(parent)}, got ${resolve(candidate)} — refusing to continue`,
  )
}
