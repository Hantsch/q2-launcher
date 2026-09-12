import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Installation, LaunchState } from '@shared/types'
import type { InstallationsService } from './installations'
import { LaunchService } from './launch'
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
vi.mock('../lib/fs-utils', () => ({ isFile: () => Promise.resolve(true) }))

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

/** Only the two members `LaunchService` uses; the rest of the service is irrelevant here. */
function fakeInstallations(): InstallationsService {
  return {
    find: (id: string) => (id === INSTALLATION ? installation : undefined),
    recordPlaySession: vi.fn(),
  } as unknown as InstallationsService
}

/** A child that reports nothing on its own, so the test controls the lifecycle. */
function fakeChild(): { once: ReturnType<typeof vi.fn>; pid: number } {
  return { once: vi.fn(), pid: 4242 }
}

function service(options: { isWriting?: boolean } = {}): {
  launch: LaunchService
  broadcast: ReturnType<typeof vi.fn>
} {
  const broadcast = vi.fn<(state: LaunchState) => void>()
  const guard: WriteLockReader = { isWriting: () => options.isWriting === true }
  const launch = new LaunchService({
    installations: fakeInstallations(),
    onStateChange: broadcast,
    getWriteGuard: () => guard,
  })
  return { launch, broadcast }
}

beforeEach(() => {
  spawnMock.mockReset()
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
