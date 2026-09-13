import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RETAIL_PAK_SIZES } from '@shared/constants'
import type { DetectedInstallation, DetectionResult } from '@shared/types'
import { copyRetailGameData, inspectRetailSource, listDetectedRetailSources } from './retail-source'

/**
 * Story 088 D1. Proves AC3 at the core level: a source whose paks do not match the launcher's known
 * retail sizes verdicts unverified, with a reason and the actual size found. Real temp dirs, same
 * fixture style as `target.test.ts` - pak files are created at the exact byte length via a zero-
 * filled buffer, never real pak content.
 */

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'q2-launcher-retail-source-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

async function writePakOfSize(baseq2: string, name: string, size: number): Promise<void> {
  await writeFile(join(baseq2, name), Buffer.alloc(size))
}

describe('inspectRetailSource', () => {
  it('verifies when pak0.pak and pak1.pak exactly match the known retail sizes', async () => {
    const baseq2 = join(dir, 'baseq2')
    await mkdir(baseq2, { recursive: true })
    await writePakOfSize(baseq2, 'pak0.pak', RETAIL_PAK_SIZES['pak0.pak'])
    await writePakOfSize(baseq2, 'pak1.pak', RETAIL_PAK_SIZES['pak1.pak'])

    const result = await inspectRetailSource(dir)

    expect(result.verified).toBe(true)
    expect(result.unverifiedReason).toBeUndefined()
    expect(result.pak0).toEqual({
      exists: true,
      sizeBytes: RETAIL_PAK_SIZES['pak0.pak'],
      matchesRetailSize: true,
    })
    expect(result.pak1.matchesRetailSize).toBe(true)
  })

  it('pak2.pak being absent never blocks verification', async () => {
    const baseq2 = join(dir, 'baseq2')
    await mkdir(baseq2, { recursive: true })
    await writePakOfSize(baseq2, 'pak0.pak', RETAIL_PAK_SIZES['pak0.pak'])
    await writePakOfSize(baseq2, 'pak1.pak', RETAIL_PAK_SIZES['pak1.pak'])

    const result = await inspectRetailSource(dir)

    expect(result.pak2).toEqual({ exists: false, sizeBytes: null, matchesRetailSize: false })
    expect(result.verified).toBe(true)
  })

  it('a wrong-size pak0.pak fails verification and captures the actual size found', async () => {
    const baseq2 = join(dir, 'baseq2')
    await mkdir(baseq2, { recursive: true })
    const wrongSize = RETAIL_PAK_SIZES['pak0.pak'] - 1
    await writePakOfSize(baseq2, 'pak0.pak', wrongSize)
    await writePakOfSize(baseq2, 'pak1.pak', RETAIL_PAK_SIZES['pak1.pak'])

    const result = await inspectRetailSource(dir)

    expect(result.verified).toBe(false)
    expect(result.unverifiedReason).toBe('bootstrap.retailSource.pak0SizeMismatch')
    expect(result.pak0.exists).toBe(true)
    expect(result.pak0.matchesRetailSize).toBe(false)
    expect(result.pak0.sizeBytes).toBe(wrongSize)
  })

  it('a missing pak1.pak fails verification', async () => {
    const baseq2 = join(dir, 'baseq2')
    await mkdir(baseq2, { recursive: true })
    await writePakOfSize(baseq2, 'pak0.pak', RETAIL_PAK_SIZES['pak0.pak'])

    const result = await inspectRetailSource(dir)

    expect(result.verified).toBe(false)
    expect(result.unverifiedReason).toBe('bootstrap.retailSource.pak1Missing')
    expect(result.pak1).toEqual({ exists: false, sizeBytes: null, matchesRetailSize: false })
  })

  it('reports hasVideo/hasPlayers reflecting baseq2/video and baseq2/players presence', async () => {
    const baseq2 = join(dir, 'baseq2')
    await mkdir(join(baseq2, 'video'), { recursive: true })
    await writePakOfSize(baseq2, 'pak0.pak', RETAIL_PAK_SIZES['pak0.pak'])
    await writePakOfSize(baseq2, 'pak1.pak', RETAIL_PAK_SIZES['pak1.pak'])

    const result = await inspectRetailSource(dir)

    expect(result.hasVideo).toBe(true)
    expect(result.hasPlayers).toBe(false)
  })

  it('never probes rerelease/ - a rerelease-only layout reports unverified, not discovered', async () => {
    const rereleaseBaseq2 = join(dir, 'rerelease', 'baseq2')
    await mkdir(rereleaseBaseq2, { recursive: true })
    await writePakOfSize(rereleaseBaseq2, 'pak0.pak', RETAIL_PAK_SIZES['pak0.pak'])
    await writePakOfSize(rereleaseBaseq2, 'pak1.pak', RETAIL_PAK_SIZES['pak1.pak'])

    const result = await inspectRetailSource(dir)

    expect(result.verified).toBe(false)
    expect(result.unverifiedReason).toBe('bootstrap.retailSource.baseDirMissing')
    expect(result.pak0.exists).toBe(false)
    expect(result.pak1.exists).toBe(false)
  })

  it('a missing baseq2 entirely reports unverified with baseDirMissing', async () => {
    const result = await inspectRetailSource(dir)

    expect(result.verified).toBe(false)
    expect(result.unverifiedReason).toBe('bootstrap.retailSource.baseDirMissing')
    expect(result.hasVideo).toBe(false)
    expect(result.hasPlayers).toBe(false)
  })
})

/**
 * Story 088 D2. Proves AC1/AC2 (data): `listDetectedRetailSources` reaches detection only through
 * the module seam (a fake `RetailSourceDetection`, never a real `DetectionService`), keeps only
 * `steam`/`gog`/`epic` candidates, and re-inspects each surviving one with `inspectRetailSource`
 * above rather than trusting the detector's own verdict.
 */
describe('listDetectedRetailSources', () => {
  function candidate(overrides: Partial<DetectedInstallation> & { source: DetectedInstallation['source']; rootPath: string }): DetectedInstallation {
    return {
      suggestedName: 'Quake II',
      engineKind: 'unknown',
      executables: [],
      gameDirs: [],
      alreadyRegistered: false,
      ...overrides,
    }
  }

  function fakeDetectionOf(result: DetectionResult) {
    return { detection: { scan: async () => result } }
  }

  it('only steam, gog and epic candidates become retail sources', async () => {
    const steamRoot = join(dir, 'steam')
    const gogRoot = join(dir, 'gog')
    await mkdir(join(steamRoot, 'baseq2'), { recursive: true })
    await mkdir(join(gogRoot, 'baseq2'), { recursive: true })
    await writePakOfSize(join(steamRoot, 'baseq2'), 'pak0.pak', RETAIL_PAK_SIZES['pak0.pak'])
    await writePakOfSize(join(steamRoot, 'baseq2'), 'pak1.pak', RETAIL_PAK_SIZES['pak1.pak'])
    await writePakOfSize(join(gogRoot, 'baseq2'), 'pak0.pak', RETAIL_PAK_SIZES['pak0.pak'])
    await writePakOfSize(join(gogRoot, 'baseq2'), 'pak1.pak', RETAIL_PAK_SIZES['pak1.pak'])

    const result = await listDetectedRetailSources(
      fakeDetectionOf({
        scanId: 'scan-1',
        cancelled: false,
        durationMs: 1,
        candidates: [
          candidate({ source: 'steam', rootPath: steamRoot }),
          candidate({ source: 'manual', rootPath: join(dir, 'manual') }),
          candidate({ source: 'gog', rootPath: gogRoot }),
          candidate({ source: 'unknown', rootPath: join(dir, 'unknown') }),
        ],
      }),
    )

    expect(result.map((entry) => entry.source).sort()).toEqual(['gog', 'steam'])
  })

  it('each detected source carries its store and its root path, and nothing else', async () => {
    const steamRoot = join(dir, 'steam')
    await mkdir(join(steamRoot, 'baseq2'), { recursive: true })
    await writePakOfSize(join(steamRoot, 'baseq2'), 'pak0.pak', RETAIL_PAK_SIZES['pak0.pak'])
    await writePakOfSize(join(steamRoot, 'baseq2'), 'pak1.pak', RETAIL_PAK_SIZES['pak1.pak'])

    const result = await listDetectedRetailSources(
      fakeDetectionOf({
        scanId: 'scan-1',
        cancelled: false,
        durationMs: 1,
        candidates: [candidate({ source: 'steam', rootPath: steamRoot })],
      }),
    )

    expect(result).toHaveLength(1)
    const [entry] = result
    expect(Object.keys(entry).sort()).toEqual(['inspection', 'rootPath', 'source'])
    expect(entry.source).toBe('steam')
    expect(entry.rootPath).toBe(steamRoot)
    expect(entry.inspection).toEqual(await inspectRetailSource(steamRoot))
  })

  it('requests a fast pass only - no deep scan, no drives', async () => {
    let seenOptions: unknown
    const result = await listDetectedRetailSources({
      detection: {
        scan: async (options) => {
          seenOptions = options
          return { scanId: 'scan-1', cancelled: false, durationMs: 1, candidates: [] }
        },
      },
    })

    expect(seenOptions).toEqual({})
    expect(result).toEqual([])
  })
})

/**
 * Story 088 D3 (AC4/AC7). Named per the story's "Acceptance Tests" table: "copyRetailGameData
 * copies the paks, never links them". Pak content here is small and distinctive (not padded to
 * `RETAIL_PAK_SIZES`) - proving "real, independent bytes" doesn't need multi-hundred-MB fixtures;
 * the size-gating of `pak2.pak` is `assembleInstallation`'s own concern and is proven in
 * `assemble.test.ts` instead.
 */
describe('copyRetailGameData', () => {
  let sourceRoot: string
  let targetRoot: string

  beforeEach(async () => {
    sourceRoot = await mkdtemp(join(tmpdir(), 'q2-launcher-retail-copy-src-'))
    targetRoot = await mkdtemp(join(tmpdir(), 'q2-launcher-retail-copy-dst-'))
  })

  afterEach(async () => {
    await rm(sourceRoot, { recursive: true, force: true })
    await rm(targetRoot, { recursive: true, force: true })
  })

  it('copies the paks, never links them', async () => {
    const baseq2 = join(sourceRoot, 'baseq2')
    await mkdir(baseq2, { recursive: true })
    await writeFile(join(baseq2, 'pak0.pak'), 'retail-pak0-content')
    await writeFile(join(baseq2, 'pak1.pak'), 'retail-pak1-content')
    // AC7 payloads: must never end up in the target either.
    await mkdir(join(sourceRoot, 'ctf'), { recursive: true })
    await writeFile(join(sourceRoot, 'ctf', 'pak0.pak'), 'ctf-data')

    const result = await copyRetailGameData({
      sourceRoot,
      targetRoot,
      includeVideoAndPlayers: false,
    })

    expect(result.copiedFiles.sort()).toEqual(['baseq2/pak0.pak', 'baseq2/pak1.pak'])

    const targetPak0Path = join(targetRoot, 'baseq2', 'pak0.pak')
    const targetPak1Path = join(targetRoot, 'baseq2', 'pak1.pak')
    const [copiedPak0, copiedPak1] = await Promise.all([
      readFile(targetPak0Path, 'utf8'),
      readFile(targetPak1Path, 'utf8'),
    ])
    expect(copiedPak0).toBe('retail-pak0-content')
    expect(copiedPak1).toBe('retail-pak1-content')

    // Never linked/referenced: mutating the source afterwards must not change the copy.
    await writeFile(join(baseq2, 'pak0.pak'), 'mutated-after-copy')
    expect(await readFile(targetPak0Path, 'utf8')).toBe('retail-pak0-content')

    // AC7: no ctf/ (or anything else outside baseq2) at the target.
    expect(await readdir(targetRoot)).toEqual(['baseq2'])
    expect((await readdir(join(targetRoot, 'baseq2'))).sort()).toEqual(['pak0.pak', 'pak1.pak'])
  })

  it('the video/players toggle: off leaves them out, on brings them in when present', async () => {
    const baseq2 = join(sourceRoot, 'baseq2')
    await mkdir(join(baseq2, 'video'), { recursive: true })
    await mkdir(join(baseq2, 'players', 'male'), { recursive: true })
    await writeFile(join(baseq2, 'pak0.pak'), 'p0')
    await writeFile(join(baseq2, 'pak1.pak'), 'p1')
    await writeFile(join(baseq2, 'video', 'idlog.cin'), 'cin')
    await writeFile(join(baseq2, 'players', 'male', 'skin.pcx'), 'skin')

    const off = await copyRetailGameData({ sourceRoot, targetRoot, includeVideoAndPlayers: false })
    expect(off.copiedFiles).not.toContain(join('baseq2', 'video', 'idlog.cin'))
    expect(await readdir(join(targetRoot, 'baseq2')).catch(() => [])).not.toContain('video')

    const targetRoot2 = await mkdtemp(join(tmpdir(), 'q2-launcher-retail-copy-dst2-'))
    try {
      const on = await copyRetailGameData({
        sourceRoot,
        targetRoot: targetRoot2,
        includeVideoAndPlayers: true,
      })
      expect(on.copiedFiles).toContain(join('baseq2', 'video', 'idlog.cin'))
      expect(await readdir(join(targetRoot2, 'baseq2', 'video'))).toEqual(['idlog.cin'])
      expect(await readdir(join(targetRoot2, 'baseq2', 'players'))).toEqual(['male'])
    } finally {
      await rm(targetRoot2, { recursive: true, force: true })
    }
  })
})
