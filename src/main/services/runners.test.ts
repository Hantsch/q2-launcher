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

let dir: string
let originalPath: string | undefined
let restorePlatform: (() => void) | undefined

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'q2-launcher-runners-'))
  homeBox.current = join(dir, 'home')
  await mkdir(homeBox.current, { recursive: true })
  originalPath = process.env['PATH']
})

afterEach(async () => {
  if (originalPath === undefined) delete process.env['PATH']
  else process.env['PATH'] = originalPath
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
    expect(resolveRunner({ executableKind: 'pe', runner: 'proton-experimental' }, detected)).toEqual(
      WINE,
    )
    // ...and so does "native", which is precisely what cannot run a PE.
    expect(resolveRunner({ executableKind: 'pe', runner: 'native' }, detected)).toEqual(WINE)
    // Nothing installed that can run it: the refusal `plan()` turns into `launch.error.noRunner`.
    expect(
      resolveRunner({ executableKind: 'pe' }, [NATIVE, { ...WINE, path: '', available: false }]),
    ).toBeUndefined()
  })
})

describe('detectRunners on win32', () => {
  it('returns the native runner only, and touches neither PATH nor Steam libraries', async () => {
    restorePlatform = stubPlatform('win32')
    // Deliberately hostile values: if the win32 branch read either of these, the assertion below
    // would fail because a wine/proton entry would show up.
    process.env['PATH'] = dir
    await writeExecutable(join(dir, 'wine'))

    const result = await detectRunners()

    expect(result).toEqual([{ kind: 'native', id: 'native', path: '', available: true }])
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
          {
            kind: 'proton',
            id: 'proton-experimental',
            label: 'Proton - Experimental',
            path: join(commonDir, 'Proton - Experimental'),
            available: true,
          },
        ]),
      )
      expect(result).toHaveLength(4)
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
