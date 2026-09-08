import { describe, expect, it, vi } from 'vitest'
import type { Logger } from '../../lib/logger'
import { parseManifestFile } from './manifest-parse'

/**
 * Story 070 D1: `parseManifestFile`'s contract - envelope refuses, packages
 * drop, pin resolves only against survivors. Covers AC2, AC3, AC5.
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
