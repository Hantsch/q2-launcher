import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DetectedRunner, Installation, LaunchState } from '@shared/types'
import { stubPlatform } from '../../test-support/platform'
import type { InstallationsService } from './installations'
import { LaunchService } from './launch'
import { buildLaunchArgs } from './launch-plan'
import type { WriteLockReader } from './write-guard'

/**
 * Story 091 D2, the inverse direction of the write guard (AC5): the game may not be
 * started while a job is copying into that installation's folder. `LaunchService`
 * had no test file of its own - `launch-plan.test.ts` covers the pure argument
 * building - so this suite covers only what D2 added: the refusal and the additive
 * `onStateChange` observer the guard resumes on.
 *
 * `spawn` is mocked, which is what lets "refuses *without starting the process*" be
 * an assertion rather than a hope.
 */

vi.mock('node:child_process', () => ({ spawn: vi.fn() }))
// Story 103 D5: `launch.ts` now also pulls in `runners.ts` (and, through it, the detection
// providers), which import two more helpers from this module. They are stubbed rather than left
// out because a mocked module has only the exports its factory returns - the real runner detection
// is never reached from here, since every test below hands `LaunchService` its own runner list.
vi.mock('../lib/fs-utils', () => ({
  isFile: () => Promise.resolve(true),
  isDirectory: () => Promise.resolve(false),
  listDir: () => Promise.resolve({ files: [], dirs: [] }),
  looksExecutable: () => Promise.resolve(false),
}))

const { spawn } = await import('node:child_process')
const spawnMock = vi.mocked(spawn)

const INSTALLATION = 'inst-1'

const installation = {
  id: INSTALLATION,
  name: 'Quake II',
  rootPath: 'C:\\Games\\Quake2',
  executablePath: 'C:\\Games\\Quake2\\r1q2.exe',
  activeGameDir: 'baseq2',
  engineKind: 'r1q2',
  launchArgs: [],
} as unknown as Installation

/**
 * Story 103 D5: a Windows build sitting in a Linux installation folder - the tester's case. The
 * `executableKind` is what D2's inspection recorded from the file's own `MZ` header.
 */
const peInstallation = {
  id: INSTALLATION,
  name: 'Quake 2 (vanilla)',
  rootPath: '/home/user/.local/share/Steam/steamapps/common/Quake 2',
  executablePath: '/home/user/.local/share/Steam/steamapps/common/Quake 2/quake2.exe',
  executableKind: 'pe',
  activeGameDir: 'rogue',
  engineKind: 'unknown',
  launchArgs: ['+set', 'cl_maxfps', '60'],
} as unknown as Installation

const WINE: DetectedRunner = { kind: 'wine', id: 'wine', path: '/usr/bin/wine', available: true }
const NO_WINE: DetectedRunner = { kind: 'wine', id: 'wine', path: '', available: false }
const NATIVE: DetectedRunner = { kind: 'native', id: 'native', path: '', available: true }

/** Only the two members `LaunchService` uses; the rest of the service is irrelevant here. */
function fakeInstallations(row: Installation): InstallationsService {
  return {
    find: (id: string) => (id === row.id ? row : undefined),
    recordPlaySession: vi.fn(),
  } as unknown as InstallationsService
}

/** A child that reports nothing on its own, so the test controls the lifecycle. */
function fakeChild(): { once: ReturnType<typeof vi.fn>; pid: number } {
  return { once: vi.fn(), pid: 4242 }
}

function service(
  options: { isWriting?: boolean; installation?: Installation; runners?: DetectedRunner[] } = {},
): {
  launch: LaunchService
  broadcast: ReturnType<typeof vi.fn>
  detectRunners: ReturnType<typeof vi.fn>
} {
  const broadcast = vi.fn<(state: LaunchState) => void>()
  const guard: WriteLockReader = { isWriting: () => options.isWriting === true }
  const detectRunners = vi.fn(() => Promise.resolve(options.runners ?? [NATIVE]))
  const launch = new LaunchService({
    installations: fakeInstallations(options.installation ?? installation),
    onStateChange: broadcast,
    getWriteGuard: () => guard,
    detectRunners,
  })
  return { launch, broadcast, detectRunners }
}

let restorePlatform: (() => void) | undefined

beforeEach(() => {
  spawnMock.mockReset()
})

afterEach(() => {
  restorePlatform?.()
  restorePlatform = undefined
})

describe('LaunchService.start', () => {
  it('start() refuses while a job is writing into that installation', async () => {
    const { launch, broadcast } = service({ isWriting: true })
    spawnMock.mockImplementation(() => fakeChild() as never)

    const result = await launch.start({ installationId: INSTALLATION })

    expect(result).toEqual({ ok: false, error: { key: 'launch.error.installationBusy' } })
    // The point of the refusal: no process, and no launch state was entered either,
    // so nothing has to be unwound.
    expect(spawnMock).not.toHaveBeenCalled()
    expect(broadcast).not.toHaveBeenCalled()
    expect(launch.getState()).toEqual({ phase: 'idle', installationId: null })
  })

  it('starts normally when no job holds the write lock', async () => {
    const { launch } = service({ isWriting: false })
    spawnMock.mockImplementation(() => fakeChild() as never)

    const result = await launch.start({ installationId: INSTALLATION })

    expect(result.ok).toBe(true)
    expect(spawnMock).toHaveBeenCalledTimes(1)
    expect(launch.getState().phase).toBe('starting')
  })

  it('still refuses a second launch while one is already running', async () => {
    const { launch } = service()
    launch.simulate('running', INSTALLATION)

    const result = await launch.start({ installationId: INSTALLATION })

    // The pre-existing refusal is unchanged by the new one in front of it.
    expect(result).toEqual({ ok: false, error: { key: 'launch.error.alreadyRunning' } })
    expect(spawnMock).not.toHaveBeenCalled()
  })
})

/**
 * Story 103 D5. `plan()` is the one place a compatibility runner is applied, so these three cover
 * the three answers it can give for a Windows executable: wrapped (AC5), refused (AC7), and - the
 * one that must not have changed at all - untouched on Windows (AC8).
 */
describe('LaunchService.plan with a runner', () => {
  it('a wine plan keeps the generated args, the working directory and the array spawn form', async () => {
    restorePlatform = stubPlatform('linux')
    const { launch } = service({ installation: peInstallation, runners: [NATIVE, WINE] })

    const planned = await launch.plan({ installationId: INSTALLATION })
    if (!planned.ok) throw new Error(`expected a plan, got ${planned.error.key}`)

    // The generated command line is the one `buildLaunchArgs` produces for this installation,
    // untouched - the runner only gets prepended in front of the executable.
    const generated = buildLaunchArgs(peInstallation).args
    expect(generated).toContain('rogue')
    expect(planned.value.executablePath).toBe(WINE.path)
    expect(planned.value.args).toEqual([peInstallation.executablePath, ...generated])
    expect(planned.value.workingDirectory).toBe(peInstallation.rootPath)
    expect(planned.value.preview).toContain(WINE.path)

    spawnMock.mockImplementation(() => fakeChild() as never)
    const started = await launch.start({ installationId: INSTALLATION })

    expect(started.ok).toBe(true)
    // Array form, never a shell string, and the game's own folder as cwd.
    expect(spawnMock).toHaveBeenCalledWith(
      WINE.path,
      [peInstallation.executablePath, ...generated],
      expect.objectContaining({ cwd: peInstallation.rootPath }),
    )
    // Q2: no launcher-owned wine prefix - nothing sets `env` for the child at all.
    expect(spawnMock.mock.calls[0]?.[2]).not.toHaveProperty('env')
  })

  it('start refuses with noRunner and never spawns', async () => {
    restorePlatform = stubPlatform('linux')
    const { launch, broadcast } = service({
      installation: peInstallation,
      runners: [NATIVE, NO_WINE],
    })

    const result = await launch.start({ installationId: INSTALLATION })

    expect(result).toEqual({
      ok: false,
      error: { key: 'launch.error.noRunner', params: { executable: 'quake2.exe' } },
    })
    // The whole point of AC7: the refusal happens inside `plan()`, before `start()` enters a
    // launch state at all - so no process, and no `launch:state` traffic to unwind either.
    expect(spawnMock).not.toHaveBeenCalled()
    expect(broadcast).not.toHaveBeenCalled()
    expect(launch.getState()).toEqual({ phase: 'idle', installationId: null })
  })

  it('win32 plan is unwrapped', async () => {
    restorePlatform = stubPlatform('win32')
    // Deliberately hostile: a PE executable *and* an available wine. Windows must ignore both.
    const { launch, detectRunners } = service({
      installation: peInstallation,
      runners: [NATIVE, WINE],
    })

    const planned = await launch.plan({ installationId: INSTALLATION })
    if (!planned.ok) throw new Error(`expected a plan, got ${planned.error.key}`)

    const generated = buildLaunchArgs(peInstallation).args
    expect(planned.value).toEqual({
      executablePath: peInstallation.executablePath,
      args: generated,
      workingDirectory: peInstallation.rootPath,
      preview: expect.stringContaining(peInstallation.executablePath as string),
    })
    // No runner detection happens on Windows at all - not even the cheap, injected one.
    expect(detectRunners).not.toHaveBeenCalled()
  })
})

describe('LaunchService.onStateChange', () => {
  it('notifies observers after the broadcast, with the same state', () => {
    const { launch, broadcast } = service()
    const order: string[] = []
    broadcast.mockImplementation(() => {
      order.push('broadcast')
    })
    const observer = vi.fn<(state: LaunchState) => void>(() => {
      order.push('observer')
    })
    launch.onStateChange(observer)

    launch.simulate('running', INSTALLATION)

    expect(observer).toHaveBeenCalledTimes(1)
    expect(observer.mock.calls[0]?.[0]).toEqual(broadcast.mock.calls[0]?.[0])
    expect(observer.mock.calls[0]?.[0]?.phase).toBe('running')
    // `launch:state` stays first and unhindered - the whole point of the observer
    // list being additive rather than a replacement of the constructor callback.
    expect(order).toEqual(['broadcast', 'observer'])
  })

  it('keeps broadcasting when an observer throws, and unsubscribes only that one', () => {
    const { launch, broadcast } = service()
    launch.onStateChange(() => {
      throw new Error('observer is broken')
    })
    const healthy = vi.fn<(state: LaunchState) => void>()
    const unsubscribe = launch.onStateChange(healthy)

    expect(() => launch.simulate('running', INSTALLATION)).not.toThrow()
    unsubscribe()
    launch.simulate('idle', INSTALLATION)

    expect(broadcast).toHaveBeenCalledTimes(2)
    expect(healthy).toHaveBeenCalledTimes(1)
  })
})
