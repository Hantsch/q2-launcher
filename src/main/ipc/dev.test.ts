import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEV_ONLY_CHANNELS } from '@shared/ipc'
import type { LaunchState, UpdateState } from '@shared/types'
import { JobsService } from '../services/jobs'
import { LaunchService } from '../services/launch'
import { InstallationWriteGuard } from '../services/write-guard'
import type { InstallationsService } from '../services/installations'
import { createUpdateService, type UpdateService } from '../services/update/service'
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

/**
 * Story 091 D7: `dev:simulateJob`'s `'writing'` scenario has to go through the
 * *real* `InstallationWriteGuard`, so this setup wires a real `JobsService`, a
 * real `LaunchService` (a fake install stub, same as `setupLaunch` above - the
 * guard never touches `installations`) and a real guard, rather than a fake.
 */
async function setupWriting(): Promise<{
  jobs: JobsService
  launch: LaunchService
  guard: InstallationWriteGuard
  fn: (event: unknown, payload: unknown) => unknown
}> {
  const { registerDevIpc } = await import('./dev')
  const jobs = new JobsService(() => {})
  const launch = new LaunchService({
    installations: {} as InstallationsService,
    onStateChange: () => {},
  })
  const guard = new InstallationWriteGuard({ launch, jobs })
  const app = { jobs, writeGuard: guard } as unknown as AppContext
  registerDevIpc(app)
  return { jobs, launch, guard, fn: registered.get('dev:simulateJob')! }
}

/**
 * Story 098 D4: `dev:simulateAppUpdate` drives `UpdateService.simulate()` on a real service - a
 * stub backend/checker stand in only because the constructor requires them; `simulate()` never
 * calls either, which is the whole point of it (see that method's doc comment in `service.ts`).
 */
async function setupUpdate(): Promise<{
  update: UpdateService
  states: UpdateState[]
  fn: (event: unknown, payload: unknown) => unknown
}> {
  const { registerDevIpc } = await import('./dev')
  const states: UpdateState[] = []
  const update = createUpdateService({
    isPackaged: true,
    check: vi.fn(async () => ({ ok: true as const, available: false as const })),
    backend: {
      autoInstallOnAppQuit: false,
      download: vi.fn(async () => ({ ok: true as const })),
      cancelDownload: vi.fn(),
      quitAndInstall: vi.fn(),
    },
    isGameRunning: () => false,
    listJobs: () => [],
    store: {
      load: vi.fn(async () => ({ update: null, lastCheckedAt: null, lastSuccessAt: null })),
      save: vi.fn(async () => undefined),
    },
    onStateChange: (state) => states.push(state),
    log: { warn: () => undefined },
  })
  const app = { update } as unknown as AppContext
  registerDevIpc(app)
  return { update, states, fn: registered.get('dev:simulateAppUpdate')! }
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

/**
 * Story 091 D7: `dev:simulateJob` gained a `'writing'` scenario + `installationId`.
 * Unlike `success`/`stall`/`failure`, this scenario must go through the *real*
 * `InstallationWriteGuard` - a fixture copy finishes too fast to click against, so
 * AC5's Play-button refusal needs a deterministic, real write phase to hold open.
 */
describe('dev:simulateJob "writing" scenario', () => {
  it('stays behind the dev-only allowlist, same as every other dev channel', () => {
    expect(DEV_ONLY_CHANNELS).toContain('dev:simulateJob')
  })

  it('rejects a "writing" scenario with no installationId (schema boundary)', async () => {
    const { fn } = await setupWriting()
    expect(() => fn(fakeEvent, { scenario: 'writing' })).toThrow()
  })

  it('acquires the real write lock immediately when nothing is running, and reports writeLock', async () => {
    const { jobs, guard, fn } = await setupWriting()

    await fn(fakeEvent, { scenario: 'writing', installationId: 'inst-1' })

    expect(guard.isWriting('inst-1')).toBe(true)
    const job = jobs.list()[0]
    expect(job.installationId).toBe('inst-1')
    expect(job.writeLock).toBe(true)
    expect(job.status).toBe('running')
  })

  it('defers the write and marks the job waiting while that installation is running', async () => {
    const { jobs, launch, guard, fn } = await setupWriting()
    launch.simulate('running', 'inst-1')

    await fn(fakeEvent, { scenario: 'writing', installationId: 'inst-1' })

    const job = jobs.list()[0]
    expect(job.status).toBe('waiting')
    expect(job.waitingReason?.key).toBe('jobs.waiting.gameRunning')
    expect(guard.isWriting('inst-1')).toBe(false)

    // The process exits - the deferred write resumes on its own, no user action.
    launch.simulate('idle', 'inst-1')
    await Promise.resolve()
    await Promise.resolve()

    expect(guard.isWriting('inst-1')).toBe(true)
    expect(jobs.list()[0]).toMatchObject({ status: 'running', writeLock: true })
  })

  it('holds the lock until cancelled, then releases it - cancel reaches the normal terminal state', async () => {
    const { jobs, guard, fn } = await setupWriting()

    await fn(fakeEvent, { scenario: 'writing', installationId: 'inst-1' })
    const job = jobs.list()[0]
    expect(guard.isWriting('inst-1')).toBe(true)

    const cancelled = jobs.cancel(job.id)

    expect(cancelled.ok).toBe(true)
    expect(jobs.list()[0].status).toBe('cancelled')

    // The lock release happens in `runWrite`'s `finally`, one microtask after the
    // job's `onCancel` resolves the never-resolving hold - flush the microtask
    // queue before asserting the guard let go of it.
    await Promise.resolve()
    await Promise.resolve()

    expect(guard.isWriting('inst-1')).toBe(false)
  })
})

/**
 * Story 098 D4: each scenario reaches the real `UpdateService` - not just that the handler ran,
 * but that `getState()` (and the `update:state` broadcast) reflects the scenario, the same
 * "actually happened, not just called" bar `dev:simulateJob`/`dev:simulateLaunch` above meet.
 */
describe('dev:simulateAppUpdate', () => {
  it('stays behind the dev-only allowlist, same as every other dev channel', () => {
    expect(DEV_ONLY_CHANNELS).toContain('dev:simulateAppUpdate')
  })

  it('rejects an unknown scenario string synchronously (schema boundary, not just TS types)', async () => {
    const { fn } = await setupUpdate()
    expect(() => fn(fakeEvent, { scenario: 'bogus' })).toThrow()
  })

  it('rejects "available" with no version', async () => {
    const { fn } = await setupUpdate()
    expect(() => fn(fakeEvent, { scenario: 'available' })).toThrow()
  })

  it('scenario "available" stages a known release at phase "available"', async () => {
    const { update, states, fn } = await setupUpdate()

    await fn(fakeEvent, { scenario: 'available', version: '9.9.9-dev', notes: 'Fixed things.' })

    const state = await update.getState()
    expect(state.phase).toBe('available')
    expect(state.update).toEqual({
      version: '9.9.9-dev',
      notes: 'Fixed things.',
      releasedAt: null,
    })
    expect(states.at(-1)).toEqual(state)
  })

  it('scenario "progress" moves the phase to "downloading" and carries the given ratio', async () => {
    const { update, fn } = await setupUpdate()

    await fn(fakeEvent, { scenario: 'progress', ratio: 0.42 })

    const state = await update.getState()
    expect(state.phase).toBe('downloading')
    expect(state.progress?.ratio).toBe(0.42)
    expect(state.progress?.bytesDone).toBeGreaterThan(0)
  })

  it('scenario "downloaded" stages the release and clears progress', async () => {
    const { update, fn } = await setupUpdate()

    await fn(fakeEvent, { scenario: 'available', version: '9.9.9-dev' })
    await fn(fakeEvent, { scenario: 'progress', ratio: 0.9 })
    await fn(fakeEvent, { scenario: 'downloaded' })

    const state = await update.getState()
    expect(state.phase).toBe('downloaded')
    expect(state.progress).toBeNull()
  })

  it.each([
    ['offline', 'appUpdate.error.offline'],
    ['checksum', 'appUpdate.error.checksum'],
    ['cancelled', 'appUpdate.error.cancelled'],
  ] as const)('scenario "error" with reason %s falls back to "available" with its key', async (reason, key) => {
    const { update, fn } = await setupUpdate()

    await fn(fakeEvent, { scenario: 'available', version: '9.9.9-dev' })
    await fn(fakeEvent, { scenario: 'progress', ratio: 0.5 })
    await fn(fakeEvent, { scenario: 'error', reason })

    const state = await update.getState()
    expect(state.phase).toBe('available')
    expect(state.error).toEqual({ key })
    expect(state.progress).toBeNull()
    // AC7: the release itself is still known and offerable.
    expect(state.update?.version).toBe('9.9.9-dev')
  })

  it('scenario "upToDate" clears the known release, so the control has nothing to show', async () => {
    const { update, fn } = await setupUpdate()

    await fn(fakeEvent, { scenario: 'available', version: '9.9.9-dev' })
    await fn(fakeEvent, { scenario: 'upToDate' })

    const state = await update.getState()
    expect(state.phase).toBe('idle')
    expect(state.status).toBe('upToDate')
    expect(state.update).toBeNull()
  })

  it('does not touch the real restart guard - installAndRestart still runs for real once "downloaded"', async () => {
    const { update, fn } = await setupUpdate()

    await fn(fakeEvent, { scenario: 'available', version: '9.9.9-dev' })
    await fn(fakeEvent, { scenario: 'downloaded' })

    // `isGameRunning`/`listJobs` are the stubbed "nothing running" answers from `setupUpdate()` -
    // the real, unfaked `installAndRestart()` should therefore proceed rather than refuse.
    expect((await update.installAndRestart()).ok).toBe(true)
  })
})
