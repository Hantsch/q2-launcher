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
 * Mirrors the literal prefix of `electron-builder.yml`'s `win.artifactName` - deliberately the
 * hyphenated `Q2-Launcher`, not the spaced `productName`, because a space in an artifact name
 * breaks electron-updater (see that field's comment). Hardcoded (not read from
 * electron-builder.yml) because this file must stay pure/dependency-free; a future rename there
 * is caught by drift (this file's expectations stop matching real build output) rather than
 * silently, which `wiring.test.mjs` also guards from the other direction by asserting against
 * the real electron-builder.yml.
 */
const PRODUCT_NAME = 'Q2-Launcher'

/**
 * Mirrors `electron-builder.yml`'s `win.target[].arch` (both `nsis` and `zip` are built for
 * `x64` only). Hardcoded for the same drift-over-silence reason as `PRODUCT_NAME` above.
 */
const ARCH = 'x64'

/**
 * The four files a Windows release must publish, in a stable, fixed order (installer, zip,
 * installer blockmap, latest.yml) - this order is a contract other code (tests, D4's caller) can
 * rely on, not an implementation detail.
 *
 * There is no zip blockmap: electron-builder emits `.blockmap` sidecars for the targets its
 * differential downloader can use, which on Windows is `nsis` only (a macOS `zip` gets one, a
 * Windows `zip` does not). Expecting a fifth file made every real build refuse - the zip is
 * published as a plain archive for people who don't want the installer, nothing more.
 *
 * Filenames follow `electron-builder.yml`'s `win.artifactName` pattern exactly:
 * `Q2-Launcher-${version}-win-${arch}.${ext}`.
 *
 * @param {string} version - e.g. `'1.0.0-beta.1'`.
 * @returns {string[]} the four expected filenames, in stable order.
 */
export function expectedAssets(version) {
  const base = `${PRODUCT_NAME}-${version}-win-${ARCH}`
  return [`${base}.exe`, `${base}.zip`, `${base}.exe.blockmap`, 'latest.yml']
}

/**
 * Reads `dir` and confirms all four `expectedAssets(version)` files are present.
 *
 * `dir` is taken as given (e.g. `release/<version>/`) - the caller decides the directory; this
 * function does not hardcode a `release/` prefix.
 *
 * @param {string} dir - directory to read, e.g. `release/1.0.0-beta.1`.
 * @param {string} version
 * @returns {string[]} the four expected files' full paths (joined with `dir`), in the same
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
