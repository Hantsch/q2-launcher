import { chmod, mkdir, mkdtemp, rm, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BASE_GAME_DIR, RETAIL_PAK_SIZES } from '@shared/constants'
import { stubPlatform } from '../../test-support/platform'
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
  // assertions. On non-Windows, `looksExecutable` (fs-utils.ts) checks the exec bit rather than
  // the `.exe` extension, so the fixture needs it set too (story 100 D3's established pattern,
  // see `installations.test.ts`'s `writePlayableRoot`).
  await writeFile(join(rootPath, 'q2pro.exe'), 'stand-in executable')
  if (process.platform !== 'win32') await chmod(join(rootPath, 'q2pro.exe'), 0o755)
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

/** Writes a fixture pak of an exact byte length instantly, via a sparse file - see upgrade-job.test.ts. */
async function writePakOfSizeIn(dirPath: string, name: string, size: number): Promise<void> {
  const path = join(dirPath, name)
  await writeFile(path, '')
  await truncate(path, size)
}

async function writePakOfSize(name: string, size: number): Promise<void> {
  await writePakOfSizeIn(baseDir, name, size)
}

async function writeRetailPak0AndPak1(): Promise<void> {
  await writePakOfSize('pak0.pak', RETAIL_PAK_SIZES['pak0.pak'])
  await writePakOfSize('pak1.pak', RETAIL_PAK_SIZES['pak1.pak'])
}

function findCheck(checks: { id: string }[], id: string) {
  return checks.find((c) => c.id === id)
}

/**
 * Story 100 D4: Q2PRO and yquake2 gained Linux markers/executables alongside the existing Windows
 * ones (`.so` markers, extension-less binary names) in `src/shared/types/engine.ts`. These tests
 * prove `classifyEngine` (exercised indirectly through `inspectInstallation`) matches the new
 * Linux-shaped roots without disturbing the existing Windows-shaped ones, and that classification
 * never branches on the host platform - a folder already on disk classifies the same everywhere.
 */
describe('inspectInstallation engine classification', () => {
  // Deliberately not reusing the outer `beforeEach`/`rootPath`: that fixture always writes
  // `q2pro.exe` at the root to keep the base-paks assertions noise-free, which would contaminate
  // the classification these tests are pinning. Each test here gets its own bare root instead.
  let classifyDir: string
  let classifyRoot: string

  beforeEach(async () => {
    classifyDir = await mkdtemp(join(tmpdir(), 'q2-launcher-inspector-classify-'))
    classifyRoot = join(classifyDir, 'game')
    await mkdir(classifyRoot, { recursive: true })
  })

  afterEach(async () => {
    await rm(classifyDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  })

  it('classifies a Linux q2pro root as q2pro', async () => {
    await writeFile(join(classifyRoot, 'q2pro'), 'stand-in linux executable')

    const result = await inspectInstallation(classifyRoot)

    expect(result.engineKind).toBe('q2pro')
  })

  it('classifies a Linux yquake2 root as yquake2', async () => {
    await writeFile(join(classifyRoot, 'ref_gl3.so'), 'stand-in renderer lib')

    const result = await inspectInstallation(classifyRoot)

    expect(result.engineKind).toBe('yquake2')
  })

  it('still classifies a Windows q2pro root as q2pro (regression)', async () => {
    await writeFile(join(classifyRoot, 'q2pro.exe'), 'stand-in windows executable')

    const result = await inspectInstallation(classifyRoot)

    expect(result.engineKind).toBe('q2pro')
  })

  it('still classifies a Windows yquake2 root as yquake2 (regression)', async () => {
    await writeFile(join(classifyRoot, 'ref_gl3.dll'), 'stand-in renderer lib')

    const result = await inspectInstallation(classifyRoot)

    expect(result.engineKind).toBe('yquake2')
  })

  it('an R1Q2 folder on disk still classifies on linux', async () => {
    // R1Q2 has no Linux binary (story 100's engine decision), but classification only cares what
    // is on disk, not what platform could have installed it - an existing R1Q2 folder must still
    // be recognised and labelled normally regardless of host platform.
    await writeFile(join(classifyRoot, 'r1q2.exe'), 'stand-in r1q2 executable')

    const result = await inspectInstallation(classifyRoot)

    expect(result.engineKind).toBe('r1q2')
  })
})

/**
 * Story 103 D2 (AC1). `rankExecutables` is kind-aware off Windows: a folder holding both a Windows
 * `quake2.exe` and a native `quake2` must offer the one the host can actually run first, where the
 * name ranking alone picks the `.exe` (it is vanilla's first preferred name). On `win32` the
 * function is byte-for-byte what it always was and no header is read at all (AC8) - which is what
 * the second test here pins, on either host.
 *
 * The Linux half needs a genuinely `+x` file, and Windows' `stat` never reports execute bits (see
 * `fs-utils.test.ts`'s `HOST_REPORTS_EXECUTE_BITS`, same reason and same skip), so it is skipped on
 * a Windows host and proven by the `ubuntu-latest` CI leg (story 100 D1).
 */
const HOST_REPORTS_EXECUTE_BITS = process.platform !== 'win32'

/** Just enough of a header for `readBinaryKind` to identify each file by its first bytes. */
const PE_HEADER = Buffer.from([0x4d, 0x5a, 0x90, 0x00])
const ELF_HEADER = Buffer.from([0x7f, 0x45, 0x4c, 0x46])

describe('inspectInstallation executable ranking', () => {
  // Own bare root, like the classification suite above: the outer fixture's `q2pro.exe` would be a
  // third candidate and change the very ordering these tests exist to pin.
  let mixedDir: string
  let mixedRoot: string
  let restorePlatform: (() => void) | undefined

  beforeEach(async () => {
    mixedDir = await mkdtemp(join(tmpdir(), 'q2-launcher-inspector-mixed-'))
    mixedRoot = join(mixedDir, 'game')
    await mkdir(join(mixedRoot, BASE_GAME_DIR), { recursive: true })
    await writeFile(join(mixedRoot, 'quake2.exe'), PE_HEADER)
    await writeFile(join(mixedRoot, 'quake2'), ELF_HEADER)
    if (HOST_REPORTS_EXECUTE_BITS) {
      await chmod(join(mixedRoot, 'quake2.exe'), 0o755)
      await chmod(join(mixedRoot, 'quake2'), 0o755)
    }
  })

  afterEach(async () => {
    restorePlatform?.()
    restorePlatform = undefined
    await rm(mixedDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  })

  it.skipIf(!HOST_REPORTS_EXECUTE_BITS)(
    'on linux a native binary outranks a windows one in the same folder',
    async () => {
      restorePlatform = stubPlatform('linux')

      const result = await inspectInstallation(mixedRoot)

      expect(result.executables).toEqual([
        join(mixedRoot, 'quake2'),
        join(mixedRoot, 'quake2.exe'),
      ])
      expect(result.executableKind).toBe('elf')
    },
  )

  it('on win32 the same folder still offers quake2.exe, and reads no header', async () => {
    restorePlatform = stubPlatform('win32')

    const result = await inspectInstallation(mixedRoot)

    expect(result.executables).toEqual([join(mixedRoot, 'quake2.exe')])
    expect(result.executableKind).toBeUndefined()
  })
})

/**
 * Story 103 D3. Off Windows, a `.exe` the machine settled on because it was the only candidate is
 * never silently "playable" - `executable-runnable` flags it, with the file name so the message can
 * name the culprit, and `fix: 'choose-runner'`. On Windows the same folder inspects clean: the PE
 * *is* the thing to run there, no runner question exists.
 *
 * The severity is `warn`, and the last test here is why: `error` would make `statusFrom` report
 * `'invalid'`, which the renderer's `isPlayable` refuses, so Play would stay disabled forever - even
 * after the user picks a working runner in the Runner section (D7). The refusal AC7 wants lives in
 * `LaunchService.plan()` (`launch.error.noRunner`), not in the status.
 */
describe('inspectInstallation executable-runnable check', () => {
  let peDir: string
  let peRoot: string
  let restorePlatform: (() => void) | undefined

  beforeEach(async () => {
    peDir = await mkdtemp(join(tmpdir(), 'q2-launcher-inspector-pe-'))
    peRoot = join(peDir, 'game')
    await mkdir(join(peRoot, BASE_GAME_DIR), { recursive: true })
    await writeFile(join(peRoot, 'quake2.exe'), PE_HEADER)
    if (HOST_REPORTS_EXECUTE_BITS) await chmod(join(peRoot, 'quake2.exe'), 0o755)
  })

  afterEach(async () => {
    restorePlatform?.()
    restorePlatform = undefined
    await rm(peDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  })

  it.skipIf(!HOST_REPORTS_EXECUTE_BITS)(
    'a windows executable raises executable-runnable with the file name',
    async () => {
      restorePlatform = stubPlatform('linux')

      const result = await inspectInstallation(peRoot)

      expect(findCheck(result.checks, 'executable-runnable')).toEqual(
        expect.objectContaining({
          severity: 'warn',
          messageKey: 'validation.executableRunnable',
          fix: 'choose-runner',
          params: { executable: 'quake2.exe' },
        }),
      )
    },
  )

  it.skipIf(!HOST_REPORTS_EXECUTE_BITS)(
    'an installation whose only fault is executable-runnable stays playable',
    async () => {
      // Retail paks so `base-paks` stays silent and this check is genuinely the only one left -
      // otherwise the status would be someone else's verdict and the assertion would prove nothing.
      const peBase = join(peRoot, BASE_GAME_DIR)
      await writePakOfSizeIn(peBase, 'pak0.pak', RETAIL_PAK_SIZES['pak0.pak'])
      await writePakOfSizeIn(peBase, 'pak1.pak', RETAIL_PAK_SIZES['pak1.pak'])
      await writePakOfSizeIn(peBase, 'pak2.pak', RETAIL_PAK_SIZES['pak2.pak'])
      restorePlatform = stubPlatform('linux')

      const result = await inspectInstallation(peRoot)

      expect(result.checks.map((c) => c.id)).toEqual(['executable-runnable'])
      // `warning`, never `invalid`: `isPlayable` (renderer `lib/status.ts`, pinned by its own test)
      // accepts `warning`, so Play stays pressable and the user can pick a runner and launch.
      expect(result.status).toBe('warning')
    },
  )

  it('on win32 the same folder raises no executable-runnable check', async () => {
    restorePlatform = stubPlatform('win32')

    const result = await inspectInstallation(peRoot)

    expect(findCheck(result.checks, 'executable-runnable')).toBeUndefined()
  })
})

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

/**
 * Story 104 D2: the inspector wires `readSteamAppId` (`./steam`, story 104 D1) into
 * `ValidationResult.steamAppId`, mirroring the D1 fixture shape from `steam.test.ts`.
 */
describe('steam appid detection', () => {
  let steamDir: string

  afterEach(async () => {
    await rm(steamDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  })

  it('a folder inside a steam library records its steam appid', async () => {
    steamDir = await mkdtemp(join(tmpdir(), 'q2-launcher-inspector-steam-'))
    const steamappsDir = join(steamDir, 'steamapps')
    const commonDir = join(steamappsDir, 'common')
    const installRoot = join(commonDir, 'Quake 2')
    await mkdir(join(installRoot, BASE_GAME_DIR), { recursive: true })
    await writeFile(join(installRoot, 'q2pro.exe'), 'stand-in executable')
    if (process.platform !== 'win32') await chmod(join(installRoot, 'q2pro.exe'), 0o755)
    await writeFile(
      join(steamappsDir, 'appmanifest_2320.acf'),
      '"AppState"\n{\n\t"appid"\t\t"2320"\n\t"installdir"\t\t"Quake 2"\n}\n',
      'utf8',
    )

    const result = await inspectInstallation(installRoot)

    expect(result.steamAppId).toBe('2320')
  })
})
