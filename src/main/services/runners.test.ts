import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DetectedRunner } from '@shared/types'
import { stubPlatform } from '../../test-support/platform'
import { detectRunners, resolveRunner } from './runners'

/**
 * Story 103 D4. `findProtonBuilds` (via `findSteamRoot`) reads `os.homedir()` on non-Windows, so
 * `homedir` is mocked to point at a per-test temp directory - `tmpdir` (used for the fixture roots
 * themselves) is left untouched via `importOriginal`, mirroring `installation-icons.test.ts`'s
 * hoisted-box pattern for mocks that need per-test values.
 */
const homeBox = vi.hoisted(() => ({ current: '' }))
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  return { ...actual, homedir: () => homeBox.current }
})

/**
 * Story 104 D3. On (stubbed) win32 `findSteamRoot` reads the registry through `reg.exe` - the real
 * machine's, on a Windows host - so the win32 cases pin its answer here. `undefined` (the default)
 * keeps the real implementation, which the off-Windows Proton case relies on.
 */
const steamRootBox = vi.hoisted(() => ({ current: undefined as string | null | undefined }))
vi.mock('./detection/providers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./detection/providers')>()
  return {
    ...actual,
    findSteamRoot: (home?: string) =>
      steamRootBox.current !== undefined
        ? Promise.resolve(steamRootBox.current)
        : actual.findSteamRoot(home),
  }
})

const HARNESS_ENV_VARS = [
  'Q2L_UI_HARNESS',
  'Q2L_UI_STEAM_EXECUTABLE',
  'Q2L_UI_DETECTED_RUNNERS',
] as const

let dir: string
let originalPath: string | undefined
let originalHarnessEnv: Record<string, string | undefined>
let restorePlatform: (() => void) | undefined

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'q2-launcher-runners-'))
  homeBox.current = join(dir, 'home')
  await mkdir(homeBox.current, { recursive: true })
  steamRootBox.current = undefined
  originalPath = process.env['PATH']
  originalHarnessEnv = Object.fromEntries(HARNESS_ENV_VARS.map((name) => [name, process.env[name]]))
  for (const name of HARNESS_ENV_VARS) delete process.env[name]
})

afterEach(async () => {
  if (originalPath === undefined) delete process.env['PATH']
  else process.env['PATH'] = originalPath
  for (const name of HARNESS_ENV_VARS) {
    const value = originalHarnessEnv[name]
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  restorePlatform?.()
  restorePlatform = undefined
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

/** Writes an executable stand-in file - a real exec bit is required off Windows, see inspector.test.ts. */
async function writeExecutable(path: string): Promise<void> {
  await writeFile(path, '#!/bin/sh\n')
  if (process.platform !== 'win32') await chmod(path, 0o755)
}

/**
 * Story 103 D5, AC4's default cascade. Pure - `resolveRunner` decides from the list it is handed -
 * so these run on any host, with only the platform stubbed.
 */
describe('resolveRunner', () => {
  const NATIVE: DetectedRunner = { kind: 'native', id: 'native', path: '', available: true }
  const WINE: DetectedRunner = { kind: 'wine', id: 'wine', path: '/usr/bin/wine', available: true }
  const UMU: DetectedRunner = { kind: 'umu', id: 'umu', path: '/usr/bin/umu-run', available: true }
  const detected = [NATIVE, WINE, UMU]

  it('the default runner is native when a native executable exists', () => {
    restorePlatform = stubPlatform('linux')

    // An ELF executable needs no wrapper, so wine being installed changes nothing...
    expect(resolveRunner({ executableKind: 'elf' }, detected)).toEqual(NATIVE)
    // ...and neither does an executable whose kind was never recorded (a pre-103 installation):
    // "not known" is never read as "foreign".
    expect(resolveRunner({}, detected)).toEqual(NATIVE)
    // On Windows the question does not arise at all, even for a `.exe` (AC8).
    restorePlatform()
    restorePlatform = stubPlatform('win32')
    expect(resolveRunner({ executableKind: 'pe' }, detected)).toEqual(NATIVE)
  })

  it('falls back to the best available runner for a windows executable, and honours a usable choice', () => {
    restorePlatform = stubPlatform('linux')

    expect(resolveRunner({ executableKind: 'pe' }, detected)).toEqual(WINE)
    expect(resolveRunner({ executableKind: 'pe', runner: 'umu' }, detected)).toEqual(UMU)
    // A choice that is not installed right now falls back to the cascade rather than refusing...
    expect(
      resolveRunner({ executableKind: 'pe', runner: 'proton-experimental' }, detected),
    ).toEqual(WINE)
    // ...and so does "native", which is precisely what cannot run a PE.
    expect(resolveRunner({ executableKind: 'pe', runner: 'native' }, detected)).toEqual(WINE)
    // Nothing installed that can run it: the refusal `plan()` turns into `launch.error.noRunner`.
    expect(
      resolveRunner({ executableKind: 'pe' }, [NATIVE, { ...WINE, path: '', available: false }]),
    ).toBeUndefined()
  })
})

describe('detectRunners on win32', () => {
  it('returns native and steam only, and touches neither PATH nor Steam libraries', async () => {
    restorePlatform = stubPlatform('win32')
    steamRootBox.current = null
    // Deliberately hostile values: if the win32 branch read either of these, the assertion below
    // would fail because a wine/proton entry - or a PATH-resolved steam - would show up.
    process.env['PATH'] = dir
    await writeExecutable(join(dir, 'wine'))
    await writeExecutable(join(dir, 'steam'))

    const result = await detectRunners()

    // Story 104 D3: native stays first and unchanged; Steam is listed (here: not found).
    expect(result).toEqual([
      { kind: 'native', id: 'native', path: '', available: true },
      { kind: 'steam', id: 'steam', path: '', available: false },
    ])
  })
})

describe('steam is detected on PATH off windows and under the steam root on win32', () => {
  it('under the steam root on win32', async () => {
    restorePlatform = stubPlatform('win32')
    const steamRoot = join(dir, 'Steam')
    await mkdir(steamRoot, { recursive: true })
    await writeFile(join(steamRoot, 'steam.exe'), '')
    steamRootBox.current = steamRoot

    const result = await detectRunners()

    expect(result).toEqual([
      { kind: 'native', id: 'native', path: '', available: true },
      { kind: 'steam', id: 'steam', path: join(steamRoot, 'steam.exe'), available: true },
    ])

    // A Steam root the registry names but with no steam.exe in it is "not found", not a guess.
    await rm(join(steamRoot, 'steam.exe'))
    expect(await detectRunners()).toContainEqual({
      kind: 'steam',
      id: 'steam',
      path: '',
      available: false,
    })
  })

  it.skipIf(process.platform === 'win32')('on PATH off windows', async () => {
    restorePlatform = stubPlatform('linux')
    const binDir = join(dir, 'bin')
    await mkdir(binDir, { recursive: true })
    await writeExecutable(join(binDir, 'steam'))
    process.env['PATH'] = binDir

    expect(await detectRunners()).toContainEqual({
      kind: 'steam',
      id: 'steam',
      path: join(binDir, 'steam'),
      available: true,
    })

    process.env['PATH'] = join(dir, 'nowhere')
    expect(await detectRunners()).toContainEqual({
      kind: 'steam',
      id: 'steam',
      path: '',
      available: false,
    })
  })

  it('the harness seam overrides the steam executable only behind the gate', async () => {
    restorePlatform = stubPlatform('win32')
    steamRootBox.current = null
    const stub = join(dir, 'steam-stub.exe')
    await writeFile(stub, '')
    process.env['Q2L_UI_STEAM_EXECUTABLE'] = stub

    // Gate closed: the variable is ignored and nothing is found.
    expect(await detectRunners()).toContainEqual({
      kind: 'steam',
      id: 'steam',
      path: '',
      available: false,
    })

    process.env['Q2L_UI_HARNESS'] = '1'
    expect(await detectRunners()).toContainEqual({
      kind: 'steam',
      id: 'steam',
      path: stub,
      available: true,
    })
  })
})

describe('detectRunners() early-return on override', () => {
  it('Q2L_UI_DETECTED_RUNNERS returns the fixture list verbatim, without running real detection', async () => {
    restorePlatform = stubPlatform('win32')
    // Deliberately hostile: if real detection still ran, this would produce a real "steam not
    // found" entry instead of the fixture list below.
    steamRootBox.current = null

    const fixture: DetectedRunner[] = [
      { kind: 'native', id: 'native', path: '', available: true },
      { kind: 'wine', id: 'wine', path: '/fixture/wine', available: true },
    ]
    process.env['Q2L_UI_HARNESS'] = '1'
    process.env['Q2L_UI_DETECTED_RUNNERS'] = JSON.stringify(fixture)

    expect(await detectRunners()).toEqual(fixture)
  })

  it('gate closed: real detection runs, unaffected by the variable being set', async () => {
    restorePlatform = stubPlatform('win32')
    steamRootBox.current = null
    process.env['Q2L_UI_DETECTED_RUNNERS'] = JSON.stringify([
      { kind: 'native', id: 'native', path: '', available: true },
    ])

    expect(await detectRunners()).toEqual([
      { kind: 'native', id: 'native', path: '', available: true },
      { kind: 'steam', id: 'steam', path: '', available: false },
    ])
  })
})

describe('a stored steam choice wins only when available; win32 still defaults to native', () => {
  const NATIVE: DetectedRunner = { kind: 'native', id: 'native', path: '', available: true }
  const WINE: DetectedRunner = { kind: 'wine', id: 'wine', path: '/usr/bin/wine', available: true }
  const UMU: DetectedRunner = { kind: 'umu', id: 'umu', path: '/usr/bin/umu-run', available: true }
  const STEAM: DetectedRunner = {
    kind: 'steam',
    id: 'steam',
    path: '/usr/bin/steam',
    available: true,
  }
  const STEAM_MISSING: DetectedRunner = { kind: 'steam', id: 'steam', path: '', available: false }

  it('on win32', async () => {
    restorePlatform = stubPlatform('win32')
    const steamRoot = join(dir, 'Steam')
    await mkdir(steamRoot, { recursive: true })
    await writeFile(join(steamRoot, 'steam.exe'), '')
    steamRootBox.current = steamRoot

    const detected = await detectRunners()
    expect(detected.map((runner) => runner.kind)).toEqual(['native', 'steam'])
    const steam = detected[1]

    // No stored choice: native, even for a Steam-owned Windows build with Steam installed.
    expect(resolveRunner({ executableKind: 'pe', steamAppId: '2320' }, detected)).toEqual(NATIVE)
    expect(resolveRunner({ runner: 'native', steamAppId: '2320' }, detected)).toEqual(NATIVE)
    // A stored 'steam' choice Steam can serve wins.
    expect(
      resolveRunner({ runner: 'steam', executableKind: 'pe', steamAppId: '2320' }, detected),
    ).toEqual(steam)
    // A stored 'steam' choice Steam cannot serve falls through to native - for each reason.
    expect(resolveRunner({ runner: 'steam', executableKind: 'pe' }, detected)).toEqual(NATIVE)
    expect(resolveRunner({ runner: 'steam', steamAppId: '9999' }, detected)).toEqual(NATIVE)
    expect(resolveRunner({ runner: 'steam', steamAppId: '2320' }, [NATIVE, STEAM_MISSING])).toEqual(
      NATIVE,
    )
  })

  it('off windows', () => {
    restorePlatform = stubPlatform('linux')
    const detected = [NATIVE, WINE, UMU, STEAM]

    // Never a default: no choice keeps 103's cascade, Steam-owned or not.
    expect(resolveRunner({ executableKind: 'pe', steamAppId: '2320' }, detected)).toEqual(WINE)
    expect(resolveRunner({ executableKind: 'elf', steamAppId: '2320' }, detected)).toEqual(NATIVE)
    // A usable stored 'steam' choice wins, whatever the executable's kind.
    expect(
      resolveRunner({ runner: 'steam', executableKind: 'pe', steamAppId: '2320' }, detected),
    ).toEqual(STEAM)
    expect(
      resolveRunner({ runner: 'steam', executableKind: 'elf', steamAppId: '2320' }, detected),
    ).toEqual(STEAM)
    // An unusable one falls through to the cascade exactly as an uninstalled wrapper would.
    expect(resolveRunner({ runner: 'steam', executableKind: 'pe' }, detected)).toEqual(WINE)
    expect(resolveRunner({ runner: 'steam', executableKind: 'elf' }, detected)).toEqual(NATIVE)
    expect(
      resolveRunner({ runner: 'steam', executableKind: 'pe', steamAppId: '2320' }, [
        NATIVE,
        WINE,
        STEAM_MISSING,
      ]),
    ).toEqual(WINE)
  })
})

describe('detectRunners off Windows', () => {
  it.skipIf(process.platform === 'win32')(
    'finds wine and umu-run on PATH and proton under the steam libraries',
    async () => {
      restorePlatform = stubPlatform('linux')

      const binDir = join(dir, 'bin')
      await mkdir(binDir, { recursive: true })
      await writeExecutable(join(binDir, 'wine'))
      await writeExecutable(join(binDir, 'umu-run'))
      process.env['PATH'] = binDir

      const steamRoot = join(homeBox.current, '.steam', 'steam')
      const commonDir = join(steamRoot, 'steamapps', 'common')
      await mkdir(join(commonDir, 'Proton - Experimental'), { recursive: true })

      const result = await detectRunners()

      expect(result).toEqual(
        expect.arrayContaining([
          { kind: 'native', id: 'native', path: '', available: true },
          { kind: 'wine', id: 'wine', path: join(binDir, 'wine'), available: true },
          { kind: 'umu', id: 'umu', path: join(binDir, 'umu-run'), available: true },
          // Story 104 D3: steam is looked for too; there is none on this PATH.
          { kind: 'steam', id: 'steam', path: '', available: false },
          {
            kind: 'proton',
            id: 'proton-experimental',
            label: 'Proton - Experimental',
            path: join(commonDir, 'Proton - Experimental'),
            available: true,
          },
        ]),
      )
      expect(result).toHaveLength(5)
    },
  )

  it.skipIf(process.platform === 'win32')(
    'reports wine as not available when PATH holds no wine',
    async () => {
      restorePlatform = stubPlatform('linux')

      const emptyBinDir = join(dir, 'empty-bin')
      await mkdir(emptyBinDir, { recursive: true })
      process.env['PATH'] = emptyBinDir

      const result = await detectRunners()

      expect(result).toEqual(
        expect.arrayContaining([{ kind: 'wine', id: 'wine', path: '', available: false }]),
      )
    },
  )
})
