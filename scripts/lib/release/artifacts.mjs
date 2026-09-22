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
const ARCH_WIN = 'x64'

/**
 * `x86_64` is not pinned by `electron-builder.yml` - unlike `win.target`, its `linux:` block sets
 * no `arch` at all, so this is what electron-builder resolves `${arch}` in `linux.artifactName` to
 * for an AppImage target built on the CI runner (x86_64 Linux), not a config field mirrored here.
 * A non-x86_64 runner building this target would resolve `${arch}` to something else, and
 * `collectAssets` would then correctly refuse (naming this filename as missing) rather than
 * silently accept a wrong one - hardcoded for the same drift-over-silence reason as
 * `PRODUCT_NAME`/`ARCH_WIN` above, distinct from `ARCH_WIN` because the two platforms' `${arch}`
 * values genuinely differ (`x64` vs `x86_64`), not because either is pinned in config.
 */
const ARCH_LINUX = 'x86_64'

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
 * @returns {string[]} the four expected Windows filenames, in stable order.
 */
function expectedWinAssets(version) {
  const base = `${PRODUCT_NAME}-${version}-win-${ARCH_WIN}`
  return [`${base}.exe`, `${base}.zip`, `${base}.exe.blockmap`, 'latest.yml']
}

/**
 * The two files a Linux (AppImage) release must publish, in a stable, fixed order (the AppImage
 * itself, then latest-linux.yml) - mirrors `expectedWinAssets`'s order contract.
 *
 * There is no AppImage blockmap: electron-builder only emits `.blockmap` sidecars for targets its
 * differential downloader supports for that platform, and per electron-builder's own AppImage
 * target docs that is not one of them - unlike Windows `nsis`, an AppImage build produces just the
 * `.AppImage` and the `latest-linux.yml` metadata file, nothing else. Expecting a blockmap here
 * would repeat the exact "phantom file" mistake `expectedWinAssets`'s comment describes for the
 * zip target - do not add one on the assumption Linux mirrors Windows.
 *
 * Filenames follow `electron-builder.yml`'s `linux.artifactName` pattern exactly:
 * `Q2-Launcher-${version}-linux-${arch}.${ext}`, which electron-builder resolves to `.AppImage`
 * with `${arch}` as `x86_64`.
 *
 * @param {string} version - e.g. `'1.0.0-beta.1'`.
 * @returns {string[]} the two expected Linux filenames, in stable order.
 */
function expectedLinuxAssets(version) {
  const base = `${PRODUCT_NAME}-${version}-linux-${ARCH_LINUX}`
  return [`${base}.AppImage`, 'latest-linux.yml']
}

/**
 * The expected release asset filenames for `platform`, in stable order.
 *
 * `platform` gives this a platform dimension: ask for just the Windows set, just the Linux set,
 * or `'all'` for both together (Windows files first, then Linux, matching the order each
 * individual platform's own list uses - callers building a single-run two-platform release check
 * can rely on this order too).
 *
 * @param {string} version - e.g. `'1.0.0-beta.1'`.
 * @param {'win' | 'linux' | 'all'} [platform] - defaults to `'win'` to preserve this function's
 *   pre-existing single-platform behaviour for any caller that has not been updated yet.
 * @returns {string[]} the expected filenames, in stable order.
 */
export function expectedAssets(version, platform = 'win') {
  switch (platform) {
    case 'win':
      return expectedWinAssets(version)
    case 'linux':
      return expectedLinuxAssets(version)
    case 'all':
      return [...expectedWinAssets(version), ...expectedLinuxAssets(version)]
    default:
      throw new Error(`expectedAssets: unknown platform "${platform}"`)
  }
}

/**
 * Reads `dir` and confirms all `expectedAssets(version, platform)` files are present.
 *
 * `dir` is taken as given (e.g. `release/<version>/`) - the caller decides the directory; this
 * function does not hardcode a `release/` prefix.
 *
 * @param {string} dir - directory to read, e.g. `release/1.0.0-beta.1`.
 * @param {string} version
 * @param {'win' | 'linux' | 'all'} [platform] - defaults to `'win'`, see `expectedAssets`.
 * @returns {string[]} the expected files' full paths (joined with `dir`), in the same stable
 *   order as `expectedAssets`.
 * @throws {Error} naming exactly which expected filename(s) are missing, if any are - "the run
 *   refuses when one is missing" (a caller, e.g. D4, catches/propagates this).
 */
export function collectAssets(dir, version, platform = 'win') {
  const expected = expectedAssets(version, platform)
  const present = new Set(readdirSync(dir))
  const missing = expected.filter((name) => !present.has(name))
  if (missing.length > 0) {
    throw new Error(
      `collectAssets: missing expected release asset(s) in "${dir}": ${missing.join(', ')}`,
    )
  }
  return expected.map((name) => join(dir, name))
}
