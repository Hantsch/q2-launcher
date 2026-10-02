import { describe, expect, it } from 'vitest'
import { isTestFile, listSourceFiles, readRepoFile } from '../test-support/source-tree'
import { PRODUCTION_CSP } from './lib/renderer-source'

/**
 * The spawn/network guard, proven against the real source tree rather than a hardcoded file list:
 *  1. No production file under `src/renderer/src` or `src/preload` contains a spawn-or-network
 *     token (`child_process`, `net.fetch`, `7za`, `spawn(`) - a plainer check than parsing every
 *     call shape, and one that also catches a copy-pasted duplicate that was never an import.
 *  2. No production file under `src/main` outside `src/main/modules/downloads/`, other than the
 *     named allowlist below, contains those tokens.
 *  3. The production CSP (`connect-src 'self'`) is pinned against the exported constant, in
 *     addition to `renderer-source.test.ts`.
 * Every allowlisted path is documented in docs/ARCHITECTURE.md.
 */

const DOWNLOADS_MODULE = 'src/main/modules/downloads'

/**
 * Pre-existing, unrelated spawn/network use sites in `src/main` that predate this story and have
 * nothing to do with the downloads pipeline - named explicitly so the guard does not false-positive
 * on legitimate code while still catching anything new.
 *
 *  - `services/launch.ts` spawns the game executable (`child_process.spawn`).
 *  - `lib/win-registry.ts` shells out to `reg.exe` (`child_process.execFile`) to read the Windows
 *    registry, since every native alternative needs a prebuild.
 *  - `lib/renderer-source.ts` only *mentions* `net.fetch` in a doc comment (contrasting its own
 *    protocol handler with delegating to `net.fetch(file://...)`) - not an actual network call.
 *  - `modules/home/news/feed-fetcher.ts` (story 082 D5) only *mentions* `net.fetch` in its own
 *    module doc comment, contrasting the global `fetch` it actually uses with `net.fetch` (which it
 *    deliberately does not use, same reasoning as `renderer-source.ts` above) - not an actual
 *    network call via that API. Its real network calls go through the global `fetch`, which this
 *    guard does not - and is not meant to - flag: the `home` module's own `network` capability
 *    (`src/shared/types/module.ts`) is what authorizes them.
 *  - `modules/home/images/fetch-image.ts` (story 084 D2) only *mentions* `net.fetch` in its own
 *    doc comments, contrasting the global `fetch` it actually uses (same wrapper/budget as
 *    `feed-fetcher.ts`) with `net.fetch` (deliberately not used, same reasoning as above) - not an
 *    actual network call via that API.
 *  - `lib/zip-entries.ts` (story 143, spawns the vendored 7-Zip to list and read zip entries).
 *  - `modules/replays/index.ts` (story 143) resolves the vendored 7-Zip binary path
 *    (`resolveExtractorPath`) to hand to the zip scanner; it does not spawn anything itself,
 *    `zip-entries.ts` does.
 */
const ALLOWED_MAIN_SPAWN_NETWORK_FILES = new Set([
  'src/main/services/launch.ts',
  'src/main/lib/win-registry.ts',
  'src/main/lib/renderer-source.ts',
  'src/main/modules/home/news/feed-fetcher.ts',
  'src/main/modules/home/images/fetch-image.ts',
  'src/main/lib/zip-entries.ts',
  'src/main/modules/replays/index.ts',
])

const productionFiles = (root: string): string[] =>
  listSourceFiles(root).filter((file) => !isTestFile(file))

const SPAWN_NETWORK_TOKENS = ['child_process', 'net.fetch', '7za', 'spawn(']

describe('spawn/network layering', () => {
  it('leaves no child_process/net.fetch/7za/spawn( token in src/renderer/src or src/preload', () => {
    const violations: string[] = []

    for (const root of ['src/renderer/src', 'src/preload']) {
      for (const file of productionFiles(root)) {
        const contents = readRepoFile(file)
        for (const token of SPAWN_NETWORK_TOKENS) {
          if (contents.includes(token)) {
            violations.push(`${file} contains "${token}"`)
          }
        }
      }
    }

    expect(violations).toEqual([])
  })

  it('confines child_process/net.fetch/7za/spawn( usage in src/main to the downloads module and the pre-existing allowlist', () => {
    const violations: string[] = []

    for (const file of productionFiles('src/main')) {
      if (file.startsWith(`${DOWNLOADS_MODULE}/`)) continue
      if (ALLOWED_MAIN_SPAWN_NETWORK_FILES.has(file)) continue

      const contents = readRepoFile(file)
      for (const token of SPAWN_NETWORK_TOKENS) {
        if (contents.includes(token)) {
          violations.push(`${file} contains "${token}"`)
        }
      }
    }

    expect(violations).toEqual([])
  })

  it("leaves the production CSP unchanged (connect-src 'self')", () => {
    expect(PRODUCTION_CSP).toContain("connect-src 'self'")
    expect(PRODUCTION_CSP).toBe(
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'",
    )
  })

  it('every allowlisted spawn/network file is documented in docs/ARCHITECTURE.md', () => {
    const doc = readRepoFile('docs/ARCHITECTURE.md')
    expect(
      [...ALLOWED_MAIN_SPAWN_NETWORK_FILES].filter((path) => !doc.includes(`\`${path}\``)),
    ).toEqual([])
  })
})
