import { mkdir, mkdtemp, rm, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BASE_GAME_DIR, RETAIL_PAK_SIZES } from '@shared/constants'
import { inspectInstallation } from './inspector'

/**
 * Story 093 D1: the inspector used to report one message, `validation.retailPaksMissing`, for two
 * different situations - pak0/pak1 present and retail-sized but pak2.pak missing (a narrow, fixable
 * "point release" gap), and the retail base paks themselves missing (a much bigger gap, closer to
 * the shareware demo). This suite pins the split: pak2-only-missing now gets its own
 * `validation.pointReleaseMissing` key, pak1-also-missing keeps `validation.retailPaksMissing`, and
 * both (plus the untouched `validation.pak0NotRetail`) now carry `fix: 'install-game-files'`. The
 * derived installation `status` must not move either way, since no severity changed - only messages
 * and the `fix` field did.
 */

let dir: string
let rootPath: string
let baseDir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'q2-launcher-inspector-'))
  rootPath = join(dir, 'game')
  baseDir = join(rootPath, BASE_GAME_DIR)
  await mkdir(baseDir, { recursive: true })
  // A root-level executable so the `executable` check doesn't add noise to these `base-paks`
  // assertions.
  await writeFile(join(rootPath, 'q2pro.exe'), 'stand-in executable')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

/** Writes a fixture pak of an exact byte length instantly, via a sparse file - see upgrade-job.test.ts. */
async function writePakOfSize(name: string, size: number): Promise<void> {
  const path = join(baseDir, name)
  await writeFile(path, '')
  await truncate(path, size)
}

async function writeRetailPak0AndPak1(): Promise<void> {
  await writePakOfSize('pak0.pak', RETAIL_PAK_SIZES['pak0.pak'])
  await writePakOfSize('pak1.pak', RETAIL_PAK_SIZES['pak1.pak'])
}

function findCheck(checks: { id: string }[], id: string) {
  return checks.find((c) => c.id === id)
}

describe('inspectInstallation base-paks', () => {
  it('reports validation.pointReleaseMissing when only pak2.pak is missing', async () => {
    await writeRetailPak0AndPak1()

    const result = await inspectInstallation(rootPath)

    const basePaks = findCheck(result.checks, 'base-paks')
    expect(basePaks).toEqual(
      expect.objectContaining({
        severity: 'warn',
        messageKey: 'validation.pointReleaseMissing',
        fix: 'install-game-files',
      }),
    )
    expect(result.status).toBe('warning')
  })

  it('still reports validation.retailPaksMissing, now with a fix, when pak1.pak is also missing', async () => {
    await writePakOfSize('pak0.pak', RETAIL_PAK_SIZES['pak0.pak'])
    // pak1.pak intentionally absent - the base retail paks themselves are missing, not just pak2.

    const result = await inspectInstallation(rootPath)

    const basePaks = findCheck(result.checks, 'base-paks')
    expect(basePaks).toEqual(
      expect.objectContaining({
        severity: 'warn',
        messageKey: 'validation.retailPaksMissing',
        fix: 'install-game-files',
      }),
    )
    expect(result.status).toBe('warning')
  })

  it('still reports validation.pak0NotRetail at info severity, now with a fix, for a non-retail pak0.pak', async () => {
    await writePakOfSize('pak0.pak', RETAIL_PAK_SIZES['pak0.pak'] - 1)
    await writePakOfSize('pak1.pak', RETAIL_PAK_SIZES['pak1.pak'])
    await writePakOfSize('pak2.pak', RETAIL_PAK_SIZES['pak2.pak'])

    const result = await inspectInstallation(rootPath)

    const basePaks = findCheck(result.checks, 'base-paks')
    expect(basePaks).toEqual(
      expect.objectContaining({
        severity: 'info',
        messageKey: 'validation.pak0NotRetail',
        fix: 'install-game-files',
      }),
    )
    // Only an `info`-severity check is present, so the derived status is unchanged: still 'ok'.
    expect(result.status).toBe('ok')
  })

  it('reports no base-paks check at all when pak0/pak1/pak2 are all present and retail-sized', async () => {
    await writeRetailPak0AndPak1()
    await writePakOfSize('pak2.pak', RETAIL_PAK_SIZES['pak2.pak'])

    const result = await inspectInstallation(rootPath)

    expect(findCheck(result.checks, 'base-paks')).toBeUndefined()
    expect(result.status).toBe('ok')
  })
})
