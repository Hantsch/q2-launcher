import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LaunchState } from '@shared/types'
import { JobsService } from '../services/jobs'
import { LaunchService } from '../services/launch'
import type { InstallationsService } from '../services/installations'
import type { AppContext } from '../context'

/**
 * Story 073 D5: `dev:simulateJob` gained a `scenario` payload (`success | stall |
 * failure`). These tests prove the handler's own behaviour per scenario against a
 * real `JobsService` - `src/main/ipc/index.test.ts` separately proves the channel
 * stays dev-only and is still registered.
 *
 * `electron` is mocked the same way as `index.test.ts`: just enough for
 * `registerDevIpc` (which pulls in the whole `./index` module graph via `handle`)
 * to import and register without a real Electron runtime.
 */

const registered = vi.hoisted(
  () => new Map<string, (event: unknown, payload: unknown) => unknown>(),
)

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, fn: (event: unknown, payload: unknown) => unknown) => {
      registered.set(channel, fn)
    }),
  },
  app: { getVersion: () => '0.0.0', isPackaged: false },
  BrowserWindow: { fromWebContents: () => null },
  shell: { openExternal: vi.fn(), openPath: vi.fn(), showItemInFolder: vi.fn() },
  dialog: { showOpenDialog: vi.fn() },
}))

const fakeEvent = {} as unknown as IpcMainInvokeEvent

async function setup(): Promise<{ jobs: JobsService; fn: (event: unknown, payload: unknown) => unknown }> {
  const { registerDevIpc } = await import('./dev')
  const jobs = new JobsService(() => {})
  const app = { jobs } as unknown as AppContext
  registerDevIpc(app)
  return { jobs, fn: registered.get('dev:simulateJob')! }
}

/**
 * Story 090 D5: `dev:simulateLaunch` drives `LaunchService` the same way a real
 * launch/exit would (`LaunchService.simulate`), so these tests use a real
 * `LaunchService` - `installations` is never touched by `simulate()`, so a
 * stub stands in for it.
 */
async function setupLaunch(): Promise<{
  launch: LaunchService
  states: LaunchState[]
  fn: (event: unknown, payload: unknown) => unknown
}> {
  const { registerDevIpc } = await import('./dev')
  const states: LaunchState[] = []
  const launch = new LaunchService({
    installations: {} as InstallationsService,
    onStateChange: (state) => states.push(state),
  })
  const app = { launch } as unknown as AppContext
  registerDevIpc(app)
  return { launch, states, fn: registered.get('dev:simulateLaunch')! }
}

beforeEach(() => {
  registered.clear()
  vi.resetModules()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('dev:simulateJob', () => {
  it('rejects an unknown scenario string synchronously (schema boundary, not just TS types)', async () => {
    const { fn } = await setup()
    expect(() => fn(fakeEvent, { scenario: 'bogus' })).toThrow()
  })

  it('rejects a missing scenario', async () => {
    const { fn } = await setup()
    expect(() => fn(fakeEvent, {})).toThrow()
  })

  it('scenario "success" progresses to completion and finishes succeeded', async () => {
    vi.useFakeTimers()
    const { jobs, fn } = await setup()

    await fn(fakeEvent, { scenario: 'success' })
    // ratio advances by 0.008 every 200ms; well over 1/0.008 ticks reaches 1.
    vi.advanceTimersByTime(200 * 200)

    const job = jobs.list()[0]
    expect(job.status).toBe('succeeded')
    expect(job.progress.ratio).toBe(1)
    expect(job.error).toBeUndefined()
  })

  it('scenario "stall" holds the job running at ~0.4 with believable progress fields', async () => {
    const { jobs, fn } = await setup()

    await fn(fakeEvent, { scenario: 'stall' })

    const job = jobs.list()[0]
    expect(job.status).toBe('running')
    expect(job.progress.ratio).toBeCloseTo(0.4)
    expect(job.progress.bytesDone).toBeGreaterThan(0)
    expect(job.progress.bytesTotal).toBeGreaterThan(0)
    expect(job.progress.bytesPerSecond).toBeGreaterThan(0)
    expect(job.progress.etaSeconds).toBeGreaterThan(0)
    expect(job.finishedAt).toBeUndefined()

    // It never finishes on its own - no timer is left running to advance it.
    vi.useFakeTimers()
    vi.advanceTimersByTime(10_000)
    expect(jobs.list()[0].status).toBe('running')
    vi.useRealTimers()
  })

  it('scenario "failure" finishes the job failed with a real i18n error.key', async () => {
    const { jobs, fn } = await setup()

    await fn(fakeEvent, { scenario: 'failure' })

    const job = jobs.list()[0]
    expect(job.status).toBe('failed')
    expect(job.error?.key).toBe('downloads.error.network')
    expect(job.finishedAt).toBeDefined()
  })
})

describe('dev:simulateLaunch', () => {
  it('rejects an unknown phase string synchronously (schema boundary, not just TS types)', async () => {
    const { fn } = await setupLaunch()
    expect(() => fn(fakeEvent, { installationId: 'inst-1', phase: 'bogus' })).toThrow()
  })

  it('rejects a missing installationId', async () => {
    const { fn } = await setupLaunch()
    expect(() => fn(fakeEvent, { phase: 'running' })).toThrow()
  })

  it('phase "running" puts the given installation into running and broadcasts launch:state', async () => {
    const { launch, states, fn } = await setupLaunch()

    await fn(fakeEvent, { installationId: 'inst-1', phase: 'running' })

    expect(launch.getState()).toEqual(
      expect.objectContaining({ phase: 'running', installationId: 'inst-1' }),
    )
    expect(states).toHaveLength(1)
    expect(states[0]).toEqual(launch.getState())
  })

  it('phase "idle" clears launch state back to idle and broadcasts launch:state', async () => {
    const { launch, states, fn } = await setupLaunch()

    await fn(fakeEvent, { installationId: 'inst-1', phase: 'running' })
    await fn(fakeEvent, { installationId: 'inst-1', phase: 'idle' })

    expect(launch.getState()).toEqual({ phase: 'idle', installationId: null })
    expect(states).toHaveLength(2)
    expect(states[1]).toEqual({ phase: 'idle', installationId: null })
  })
})
