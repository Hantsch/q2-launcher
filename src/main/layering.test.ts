import { describe, expect, it } from 'vitest'
import { isTestFile, listSourceFiles, readRepoFile } from '../test-support/source-tree'
import { ALLOWED_MAIN_SPAWN_NETWORK_FILES } from '../test-support/spawn-network-allowlist'
import { PRODUCTION_CSP } from './lib/renderer-source'

/**
 * The spawn/network guard, proven against the real source tree rather than a hardcoded file list:
 *  1. No production file under `src/renderer/src` or `src/preload` contains a spawn-or-network
 *     token (`child_process`, `net.fetch`, `7za`, `spawn(`) - a plainer check than parsing every
 *     call shape, and one that also catches a copy-pasted duplicate that was never an import.
 *  2. No production file under `src/main` outside `src/main/modules/downloads/`, other than the
 *     named allowlist in `test-support/spawn-network-allowlist.ts`, contains those tokens.
 *  3. The production CSP (`connect-src 'self'`) is pinned against the exported constant, in
 *     addition to `renderer-source.test.ts`.
 * Every allowlisted path is documented in docs/ARCHITECTURE.md.
 */

const DOWNLOADS_MODULE = 'src/main/modules/downloads'

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
})

describe('archive verification layering', () => {
  // `markVerified` is the extractor's only way in; keeping it to the staging routine means no
  // archive reaches 7za without having gone through the download's size/SHA256 check.
  it('only the staging routine calls markVerified', () => {
    const callers = productionFiles('src/main').filter((file) =>
      readRepoFile(file).includes('markVerified('),
    )
    expect(callers.sort()).toEqual([
      'src/main/lib/archive/extractor.ts',
      'src/main/services/package-staging.ts',
    ])
  })
})

describe('shared helper layering', () => {
  it('clamp01, removeDir and hashFile are defined only in src/main/lib', () => {
    const declaration = /(?:\bfunction\s+|\b(?:const|let)\s+)(?:clamp01|removeDir|hashFile)\b/
    const offenders = listSourceFiles('src/main')
      .filter((file) => !isTestFile(file) && !file.startsWith('src/main/lib/'))
      .filter((file) => declaration.test(readRepoFile(file)))
    expect(offenders).toEqual([])
  })
})

describe('one ManifestService per app', () => {
  it('new ManifestService appears only in context.ts', () => {
    const offenders = listSourceFiles('src/main')
      .filter((file) => !isTestFile(file))
      .filter((file) => readRepoFile(file).includes('new ManifestService('))
      .map((file) => file.split('\\').join('/'))
    expect(offenders).toEqual(['src/main/context.ts'])
  })
})
