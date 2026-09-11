import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RETAIL_PAK_SIZES } from '@shared/constants'
import type { DetectedInstallation, DetectionResult } from '@shared/types'
import type { AppContext } from '../../../context'
import { HARNESS_STORE_SOURCES_ENV } from '../harness'
import { detectedRetailSourcesFor } from './sources'

/**
 * Story 090 D1. Proves the new integration point this deliverable actually adds - the wrapper the
 * retail-upgrade action's store-source lister goes through - rather than re-testing [[088]]'s already
 * -tested `listDetectedRetailSources` filtering logic body (`bootstrap/retail-source.test.ts` already
 * covers that). What is new here is the wiring: `detectedRetailSourcesFor` reaches detection through
 * `AppContext.detection` (the real module seam a handler is given, not a hand-built fake), and only
 * `steam`/`gog`/`epic` candidates - each carrying its store and its path - come out the other end.
 */

const UI_HARNESS_ENV = 'Q2L_UI_HARNESS'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'q2-launcher-retail-upgrade-sources-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

async function writePakOfSize(baseq2: string, name: string, size: number): Promise<void> {
  await writeFile(join(baseq2, name), Buffer.alloc(size))
}

function candidate(
  overrides: Partial<DetectedInstallation> & { source: DetectedInstallation['source']; rootPath: string },
): DetectedInstallation {
  return {
    suggestedName: 'Quake II',
    engineKind: 'unknown',
    executables: [],
    gameDirs: [],
    alreadyRegistered: false,
    ...overrides,
  }
}

function fakeAppWithScan(result: DetectionResult): AppContext {
  return {
    isDev: false,
    detection: { scan: async () => result },
  } as unknown as AppContext
}

describe('detectedRetailSourcesFor', () => {
  it('offers only steam/gog/epic candidates, each with its store and its path', async () => {
    const steamRoot = join(dir, 'steam')
    const gogRoot = join(dir, 'gog')
    const epicRoot = join(dir, 'epic')
    for (const root of [steamRoot, gogRoot, epicRoot]) {
      const baseq2 = join(root, 'baseq2')
      await mkdir(baseq2, { recursive: true })
      await writePakOfSize(baseq2, 'pak0.pak', RETAIL_PAK_SIZES['pak0.pak'])
      await writePakOfSize(baseq2, 'pak1.pak', RETAIL_PAK_SIZES['pak1.pak'])
    }

    const app = fakeAppWithScan({
      scanId: 'scan-1',
      cancelled: false,
      durationMs: 1,
      candidates: [
        candidate({ source: 'steam', rootPath: steamRoot }),
        candidate({ source: 'gog', rootPath: gogRoot }),
        candidate({ source: 'epic', rootPath: epicRoot }),
        candidate({ source: 'manual', rootPath: join(dir, 'manual') }),
        candidate({ source: 'unknown', rootPath: join(dir, 'unknown') }),
      ],
    })

    const result = await detectedRetailSourcesFor(app)

    expect(result.map((entry) => entry.source).sort()).toEqual(['epic', 'gog', 'steam'])
    for (const entry of result) {
      expect(Object.keys(entry).sort()).toEqual(['inspection', 'rootPath', 'source'])
      expect(typeof entry.source).toBe('string')
      expect(typeof entry.rootPath).toBe('string')
    }
  })

  it('production (isDev false): a harness fixture env var is ignored - the real scan still runs', async () => {
    const steamRoot = join(dir, 'steam')
    const baseq2 = join(steamRoot, 'baseq2')
    await mkdir(baseq2, { recursive: true })
    await writePakOfSize(baseq2, 'pak0.pak', RETAIL_PAK_SIZES['pak0.pak'])
    await writePakOfSize(baseq2, 'pak1.pak', RETAIL_PAK_SIZES['pak1.pak'])

    const previousHarness = process.env[UI_HARNESS_ENV]
    const previousFixture = process.env[HARNESS_STORE_SOURCES_ENV]
    process.env[UI_HARNESS_ENV] = '1'
    process.env[HARNESS_STORE_SOURCES_ENV] = JSON.stringify([
      { source: 'gog', rootPath: 'C:\\fixture-only', inspection: {} },
    ])
    try {
      const app: AppContext = {
        isDev: false,
        detection: {
          scan: async () => ({
            scanId: 'scan-1',
            cancelled: false,
            durationMs: 1,
            candidates: [candidate({ source: 'steam', rootPath: steamRoot })],
          }),
        },
      } as unknown as AppContext

      const result = await detectedRetailSourcesFor(app)

      expect(result.map((entry) => entry.source)).toEqual(['steam'])
    } finally {
      if (previousHarness === undefined) delete process.env[UI_HARNESS_ENV]
      else process.env[UI_HARNESS_ENV] = previousHarness
      if (previousFixture === undefined) delete process.env[HARNESS_STORE_SOURCES_ENV]
      else process.env[HARNESS_STORE_SOURCES_ENV] = previousFixture
    }
  })
})
