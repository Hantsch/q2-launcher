// Story 096 D3: the expected Windows release asset set, and a check that a build directory
// actually produced all of it. Mirrors `scripts/lib/download-failures.mjs`'s shape: plain ESM,
// JSDoc types, named exports, rich why-comments.
//
// `expectedAssets` is pure - no fs, no path resolution beyond building filenames - so it can be
// unit-tested without touching disk. `collectAssets` is the one function here allowed to touch
// `node:fs`, per the story: it reads a directory, compares it against `expectedAssets`, and
// refuses (throws) when anything is missing, naming exactly what's missing. That refusal is what
// [[097]]'s `electron-updater` depends on never seeing a half-published release.
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Mirrors `electron-builder.yml`'s `productName` field directly. Hardcoded (not read from
 * electron-builder.yml) because this file must stay pure/dependency-free; a future rename of
 * `productName` in electron-builder.yml is caught by drift (this file's expectations stop
 * matching real build output) rather than silently, which `wiring.test.mjs` also guards from
 * the other direction by asserting against the real electron-builder.yml.
 */
const PRODUCT_NAME = 'Q2 Launcher'

/**
 * Mirrors `electron-builder.yml`'s `win.target[].arch` (both `nsis` and `zip` are built for
 * `x64` only). Hardcoded for the same drift-over-silence reason as `PRODUCT_NAME` above.
 */
const ARCH = 'x64'

/**
 * The five files a Windows release must publish, in a stable, fixed order (installer, zip,
 * installer blockmap, zip blockmap, latest.yml) - this order is a contract other code (tests,
 * D4's caller) can rely on, not an implementation detail.
 *
 * Filenames follow `electron-builder.yml`'s `win.artifactName` pattern exactly:
 * `${productName}-${version}-win-${arch}.${ext}`.
 *
 * @param {string} version - e.g. `'1.0.0-beta.1'`.
 * @returns {string[]} the five expected filenames, in stable order.
 */
export function expectedAssets(version) {
  const base = `${PRODUCT_NAME}-${version}-win-${ARCH}`
  return [`${base}.exe`, `${base}.zip`, `${base}.exe.blockmap`, `${base}.zip.blockmap`, 'latest.yml']
}

/**
 * Reads `dir` and confirms all five `expectedAssets(version)` files are present.
 *
 * `dir` is taken as given (e.g. `release/<version>/`) - the caller decides the directory; this
 * function does not hardcode a `release/` prefix.
 *
 * @param {string} dir - directory to read, e.g. `release/1.0.0-beta.1`.
 * @param {string} version
 * @returns {string[]} the five expected files' full paths (joined with `dir`), in the same
 *   stable order as `expectedAssets`.
 * @throws {Error} naming exactly which expected filename(s) are missing, if any are - "the run
 *   refuses when one is missing" (a caller, e.g. D4, catches/propagates this).
 */
export function collectAssets(dir, version) {
  const expected = expectedAssets(version)
  const present = new Set(readdirSync(dir))
  const missing = expected.filter((name) => !present.has(name))
  if (missing.length > 0) {
    throw new Error(
      `collectAssets: missing expected release asset(s) in "${dir}": ${missing.join(', ')}`,
    )
  }
  return expected.map((name) => join(dir, name))
}
