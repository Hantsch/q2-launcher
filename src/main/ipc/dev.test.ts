import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JobsService } from '../services/jobs'
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
