import { describe, expect, it, vi } from 'vitest'
import type { Logger } from '../../lib/logger'
import { parseManifestFile } from './manifest-parse'

/**
 * Story 070 D1: `parseManifestFile`'s contract - envelope refuses, packages
 * drop, pin resolves only against survivors. Covers AC2, AC3, AC5.
 *
 * Story 100 D5: plus the platform dimension (that story's AC5). Every pin test passes an explicit
 * `platform` rather than letting it default to the host's - the parser takes it as a parameter
 * (`ParseManifestFileOptions.platform`), so proving the Linux reading needs no global stub and no
 * test in this file depends on which OS the suite happens to run on.
 */

function fakeLogger(): Logger {
  return { warn: vi.fn() } as unknown as Logger
}

const goodEnginePackage = {
  kind: 'engine',
  engine: 'q2pro',
  id: 'q2pro-1',
  version: '1.0.0',
  sizeBytes: 1024,
  sha256: 'a'.repeat(64),
  url: 'https://example.com/q2pro-1.zip',
  mirrors: ['https://mirror.example.com/q2pro-1.zip'],
  contents: [{ from: 'q2pro.exe', to: 'root' }],
}

const anotherGoodEnginePackage = {
  ...goodEnginePackage,
  id: 'q2pro-2',
  version: '2.0.0',
}

describe('parseManifestFile - envelope refusal', () => {
  it('refuses (not a partial result) when schemaVersion is not exactly 1', () => {
    const log = fakeLogger()
    const result = parseManifestFile(
      { schemaVersion: 2, packages: [goodEnginePackage] },
      log,
    )
    expect(result.ok).toBe(false)
    // A refusal must never carry a `packages` field - proves this is not a
    // partial list dressed up as a failure.
    expect(result).not.toHaveProperty('packages')
    expect(log.warn).toHaveBeenCalled()
  })

  it('refuses when schemaVersion is missing entirely', () => {
    const log = fakeLogger()
    const result = parseManifestFile({ packages: [goodEnginePackage] }, log)
    expect(result.ok).toBe(false)
  })

  it('refuses when packages is missing entirely', () => {
    const log = fakeLogger()
    const result = parseManifestFile({ schemaVersion: 1 }, log)
    expect(result.ok).toBe(false)
  })

  it('refuses when packages is not an array', () => {
    const log = fakeLogger()
    const result = parseManifestFile({ schemaVersion: 1, packages: {} }, log)
    expect(result.ok).toBe(false)
  })
})

describe('parseManifestFile - row-by-row package parse (AC2/AC3)', () => {
  it('drops a package missing sha256, mirrors or sizeBytes, keeping the good ones and logging a warning per drop', () => {
    const log = fakeLogger()
    const missingSha256 = { ...goodEnginePackage, id: 'broken-1', sha256: undefined }
    delete (missingSha256 as Record<string, unknown>).sha256
    const missingMirrors = { ...goodEnginePackage, id: 'broken-2', mirrors: undefined }
    delete (missingMirrors as Record<string, unknown>).mirrors
    const missingSize = { ...goodEnginePackage, id: 'broken-3', sizeBytes: undefined }
    delete (missingSize as Record<string, unknown>).sizeBytes

    const result = parseManifestFile(
      {
        schemaVersion: 1,
        packages: [goodEnginePackage, missingSha256, missingMirrors, missingSize, anotherGoodEnginePackage],
      },
      log,
    )

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok result')
    expect(result.packages.map((p) => p.id)).toEqual(['q2pro-1', 'q2pro-2'])
    // One warn per dropped row.
    expect(log.warn).toHaveBeenCalledTimes(3)
  })

  it('keeps the whole manifest usable when only one package among several is invalid', () => {
    const log = fakeLogger()
    const broken = { ...goodEnginePackage, id: 'broken', sha256: 'not-a-valid-hash' }

    const result = parseManifestFile(
      { schemaVersion: 1, packages: [goodEnginePackage, broken, anotherGoodEnginePackage] },
      log,
    )

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok result')
    expect(result.packages).toHaveLength(2)
    expect(result.packages.find((p) => p.id === 'broken')).toBeUndefined()
    expect(log.warn).toHaveBeenCalledTimes(1)
  })
})

describe('parseManifestFile - pin resolution (AC5)', () => {
  it('resolves pinned.q2pro to the surviving package it references', () => {
    const log = fakeLogger()
    const result = parseManifestFile(
      {
        schemaVersion: 1,
        packages: [goodEnginePackage, anotherGoodEnginePackage],
        pinned: { q2pro: 'q2pro-2' },
      },
      log,
      { platform: 'win32' },
    )

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok result')
    expect(result.pinned.q2pro).toBe('q2pro-2')
  })

  it('drops the pin (and logs it) when it references a package that was dropped, without silently substituting another', () => {
    const log = fakeLogger()
    const broken = { ...goodEnginePackage, id: 'q2pro-broken', sha256: 'not-a-valid-hash' }

    const result = parseManifestFile(
      {
        schemaVersion: 1,
        packages: [broken, anotherGoodEnginePackage],
        pinned: { q2pro: 'q2pro-broken' },
      },
      log,
      { platform: 'win32' },
    )

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok result')
    // Not the dropped id, and not silently substituted for the one surviving package either.
    expect(result.pinned.q2pro).toBeUndefined()
    expect(result.packages.map((p) => p.id)).toEqual(['q2pro-2'])
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('q2pro-broken'))
  })

  it('drops a pin whose engine key is not a recognised EngineKind, without casting it through', () => {
    const log = fakeLogger()

    const result = parseManifestFile(
      {
        schemaVersion: 1,
        packages: [goodEnginePackage],
        pinned: { 'not-a-real-engine': 'q2pro-1' },
      },
      log,
      { platform: 'win32' },
    )

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok result')
    // The bogus key must not appear in the pinned map at all - not as itself,
    // not coerced to some other key.
    expect(result.pinned).toEqual({})
    expect(Object.keys(result.pinned)).toHaveLength(0)
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('not-a-real-engine'))
  })
})

/**
 * Story 100 D5 (that story's AC5). Two shapes have to coexist here, and the second one is the
 * whole reason this deliverable is risky: the *live remote* manifest was published in the old,
 * flat shape, so a launcher carrying this code that refuses it - or resolves nothing from it -
 * kills the Windows download path in production, where no test runs.
 */
describe('parseManifestFile - per-platform pin resolution (story 100 AC5)', () => {
  const windowsPackage = { ...goodEnginePackage, id: 'q2pro-win', platforms: ['win32'] }
  const linuxPackage = { ...goodEnginePackage, id: 'q2pro-linux', platforms: ['linux'] }

  const bothPlatformsManifest = {
    schemaVersion: 1,
    packages: [windowsPackage, linuxPackage],
    pinned: { q2pro: { win32: 'q2pro-win', linux: 'q2pro-linux' } },
  }

  it('the pinned selection resolves per platform', () => {
    const onWindows = parseManifestFile(bothPlatformsManifest, fakeLogger(), { platform: 'win32' })
    const onLinux = parseManifestFile(bothPlatformsManifest, fakeLogger(), { platform: 'linux' })

    if (!onWindows.ok || !onLinux.ok) throw new Error('expected ok results')
    expect(onWindows.pinned.q2pro).toBe('q2pro-win')
    expect(onLinux.pinned.q2pro).toBe('q2pro-linux')
    // Both packages survive parsing on both hosts - the platform decides the *pin*, not which
    // rows are readable, so nothing downstream loses sight of a package it already knows.
    expect(onLinux.packages.map((p) => p.id)).toEqual(['q2pro-win', 'q2pro-linux'])
  })

  it('a manifest with only Windows packages resolves to nothing on linux', () => {
    const log = fakeLogger()
    const result = parseManifestFile(
      { schemaVersion: 1, packages: [windowsPackage], pinned: { q2pro: { win32: 'q2pro-win' } } },
      log,
      { platform: 'linux' },
    )

    if (!result.ok) throw new Error('expected ok result')
    // Nothing for this platform - never the Windows build as a fallback.
    expect(result.pinned).toEqual({})
    expect(result.pinned.q2pro).toBeUndefined()
  })

  it('still resolves a manifest in the OLD flat shape on win32 (no platforms field, bare-string pin)', () => {
    const log = fakeLogger()
    // Byte-for-byte the shape the live remote manifest had before this deliverable: no
    // `platforms` key on any package, `pinned` values plain strings.
    const oldShapeManifest = {
      schemaVersion: 1,
      packages: [goodEnginePackage, anotherGoodEnginePackage],
      pinned: { q2pro: 'q2pro-2' },
    }

    const result = parseManifestFile(oldShapeManifest, log, { platform: 'win32' })

    if (!result.ok) throw new Error('expected ok result')
    expect(result.packages.map((p) => p.id)).toEqual(['q2pro-1', 'q2pro-2'])
    expect(result.pinned.q2pro).toBe('q2pro-2')
    expect(log.warn).not.toHaveBeenCalled()
  })

  it('reads the old flat shape as a Windows-only pin, so it resolves to nothing on linux', () => {
    const result = parseManifestFile(
      { schemaVersion: 1, packages: [goodEnginePackage], pinned: { q2pro: 'q2pro-1' } },
      fakeLogger(),
      { platform: 'linux' },
    )

    if (!result.ok) throw new Error('expected ok result')
    expect(result.pinned).toEqual({})
  })

  it('drops a pin whose package does not declare this platform, without substituting another', () => {
    const log = fakeLogger()
    // A half-migrated manifest: the pin claims a linux build, the package it names is win32-only.
    const result = parseManifestFile(
      { schemaVersion: 1, packages: [windowsPackage], pinned: { q2pro: { linux: 'q2pro-win' } } },
      log,
      { platform: 'linux' },
    )

    if (!result.ok) throw new Error('expected ok result')
    expect(result.pinned).toEqual({})
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('q2pro-win'))
  })

  it('defaults to the running platform when no platform is passed', () => {
    // Not an assertion about which host this is: the fixture simply declares whatever platform
    // the suite runs on, so this proves the *default wiring* on Windows and on Linux alike.
    const hostPackage = { ...goodEnginePackage, id: 'q2pro-host', platforms: [process.platform] }
    const result = parseManifestFile(
      { schemaVersion: 1, packages: [hostPackage], pinned: { q2pro: { [process.platform]: 'q2pro-host' } } },
      fakeLogger(),
    )

    if (!result.ok) throw new Error('expected ok result')
    expect(result.pinned.q2pro).toBe('q2pro-host')
  })
})
