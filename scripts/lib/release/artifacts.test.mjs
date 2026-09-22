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
  test('returns the exact 4 expected filenames for a version, in stable order', () => {
    expect(expectedAssets(VERSION)).toEqual([
      'Q2-Launcher-1.0.0-beta.1-win-x64.exe',
      'Q2-Launcher-1.0.0-beta.1-win-x64.zip',
      'Q2-Launcher-1.0.0-beta.1-win-x64.exe.blockmap',
      'latest.yml',
    ])
  })

  test('no name carries a space, so latest.yml, the file on disk and the GitHub asset agree', () => {
    // The regression this guards: with `${productName}` in `win.artifactName` the built file was
    // `Q2 Launcher-...exe` while electron-builder wrote `Q2-Launcher-...exe` into latest.yml's
    // `url` - electron-updater then asked the release for an asset that does not exist.
    for (const name of expectedAssets(VERSION)) {
      expect(name).not.toContain(' ')
    }
  })

  test('returns the exact 2 expected Linux filenames for a version, in stable order', () => {
    expect(expectedAssets(VERSION, 'linux')).toEqual([
      'Q2-Launcher-1.0.0-beta.1-linux-x86_64.AppImage',
      'latest-linux.yml',
    ])
  })

  test('latest.yml and latest-linux.yml are both expected, and neither platform\'s set contains the other\'s metadata file', () => {
    const win = expectedAssets(VERSION, 'win')
    const linux = expectedAssets(VERSION, 'linux')

    expect(win).toContain('latest.yml')
    expect(linux).toContain('latest-linux.yml')
    expect(win).not.toContain('latest-linux.yml')
    expect(linux).not.toContain('latest.yml')

    const all = expectedAssets(VERSION, 'all')
    expect(all).toEqual([...win, ...linux])
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

  test('the asset set is installer, zip, the installer blockmap and latest.yml, and a missing one refuses', () => {
    for (const name of expectedAssets(VERSION)) {
      writeFileSync(join(dir, name), '')
    }

    const collected = collectAssets(dir, VERSION)
    expect(collected).toEqual(expectedAssets(VERSION).map((name) => join(dir, name)))

    // Remove one of the 4 (the installer blockmap) and confirm the run refuses, naming it
    // specifically.
    const installerBlockmap = 'Q2-Launcher-1.0.0-beta.1-win-x64.exe.blockmap'
    unlinkSync(join(dir, installerBlockmap))

    expect(() => collectAssets(dir, VERSION)).toThrow(installerBlockmap)
  })

  test('the Linux asset set is the AppImage and latest-linux.yml, and a missing one refuses', () => {
    for (const name of expectedAssets(VERSION, 'linux')) {
      writeFileSync(join(dir, name), '')
    }

    const collected = collectAssets(dir, VERSION, 'linux')
    expect(collected).toEqual(
      expectedAssets(VERSION, 'linux').map((name) => join(dir, name)),
    )

    const appImage = 'Q2-Launcher-1.0.0-beta.1-linux-x86_64.AppImage'
    unlinkSync(join(dir, appImage))

    expect(() => collectAssets(dir, VERSION, 'linux')).toThrow(appImage)
  })

  test('a two-platform check names only the missing Linux asset and refuses', () => {
    for (const name of expectedAssets(VERSION, 'win')) {
      writeFileSync(join(dir, name), '')
    }
    // Linux set present except the AppImage itself - latest-linux.yml is there.
    writeFileSync(join(dir, 'latest-linux.yml'), '')

    const appImage = 'Q2-Launcher-1.0.0-beta.1-linux-x86_64.AppImage'

    expect(() => collectAssets(dir, VERSION, 'all')).toThrow(appImage)
    try {
      collectAssets(dir, VERSION, 'all')
      throw new Error('expected collectAssets to throw')
    } catch (error) {
      // Names only the AppImage - no Windows file, no latest-linux.yml, is mentioned as missing.
      for (const name of [...expectedAssets(VERSION, 'win'), 'latest-linux.yml']) {
        expect(error.message).not.toContain(name)
      }
      expect(error.message).toContain(appImage)
    }
  })
})
