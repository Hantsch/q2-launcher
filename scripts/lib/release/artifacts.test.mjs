import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { collectAssets, expectedAssets } from './artifacts.mjs'

/**
 * Story 096 D3: direct unit coverage of the pure `expectedAssets` and the fs-backed
 * `collectAssets`, using a real temp directory (not a mocked fs) so the "reads a directory,
 * refuses when incomplete" behaviour is proven against real `node:fs` semantics. Mirrors
 * `changelog.test.mjs`'s describe/test style.
 */

const VERSION = '1.0.0-beta.1'

describe('expectedAssets', () => {
  test("returns the exact 5 expected filenames for a version, in stable order", () => {
    expect(expectedAssets(VERSION)).toEqual([
      'Q2 Launcher-1.0.0-beta.1-win-x64.exe',
      'Q2 Launcher-1.0.0-beta.1-win-x64.zip',
      'Q2 Launcher-1.0.0-beta.1-win-x64.exe.blockmap',
      'Q2 Launcher-1.0.0-beta.1-win-x64.zip.blockmap',
      'latest.yml',
    ])
  })
})

describe('collectAssets', () => {
  let dir

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'q2-launcher-release-artifacts-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  test('the asset set is installer, zip, both blockmaps and latest.yml, and a missing one refuses', () => {
    for (const name of expectedAssets(VERSION)) {
      writeFileSync(join(dir, name), '')
    }

    const collected = collectAssets(dir, VERSION)
    expect(collected).toEqual(expectedAssets(VERSION).map((name) => join(dir, name)))

    // Remove one of the 5 (the zip blockmap) and confirm the run refuses, naming it specifically.
    const zipBlockmap = 'Q2 Launcher-1.0.0-beta.1-win-x64.zip.blockmap'
    unlinkSync(join(dir, zipBlockmap))

    expect(() => collectAssets(dir, VERSION)).toThrow(zipBlockmap)
  })
})
