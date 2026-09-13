import type { IpcMainInvokeEvent } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fail, ok, type UpdateState } from '@shared/types'
import type { AppContext } from '../context'

/**
 * Story 097 D5: `update:getState`/`update:check`, registered against a faked
 * `UpdateService` - only the wrapper's job (delegate, pass the result through
 * unchanged) is under test here; the service's own behaviour has its suite in
 * `src/main/services/update/service.test.ts`. `electron` is mocked the same
 * minimal way as `app.test.ts`/`index.test.ts`, just enough for
 * `registerUpdateIpc` to import and run without a real Electron runtime.
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
}))

const fakeEvent = {} as unknown as IpcMainInvokeEvent

const someState: UpdateState = {
  status: 'upToDate',
  phase: 'idle',
  update: null,
  error: null,
  progress: null,
  dismissed: false,
  lastCheckedAt: '2026-01-01T00:00:00.000Z',
  lastSuccessAt: '2026-01-01T00:00:00.000Z',
  supported: true,
}

/** Story 098's four actions, faked. Each test overrides the one it cares about. */
function fakeActions() {
  return {
    startDownload: vi.fn(async () => ok(someState)),
    cancelDownload: vi.fn(() => ok(someState)),
    installAndRestart: vi.fn(async () => ok(null)),
    dismiss: vi.fn(() => ok(someState)),
    simulate: vi.fn(),
  }
}

type Registered = (event: unknown, payload: unknown) => unknown

async function setup(update: AppContext['update']): Promise<{
  getState: Registered
  check: Registered
  download: Registered
  cancelDownload: Registered
  installAndRestart: Registered
  dismiss: Registered
}> {
  const { registerUpdateIpc } = await import('./update')
  const app = { update } as unknown as AppContext
  registerUpdateIpc(app)
  return {
    getState: registered.get('update:getState')!,
    check: registered.get('update:check')!,
    download: registered.get('update:download')!,
    cancelDownload: registered.get('update:cancelDownload')!,
    installAndRestart: registered.get('update:installAndRestart')!,
    dismiss: registered.get('update:dismiss')!,
  }
}

beforeEach(() => {
  registered.clear()
  vi.resetModules()
})

describe('update:getState', () => {
  it('answers with exactly what the service produces', async () => {
    const getState = vi.fn(async () => someState)
    const update = {
      ...fakeActions(),
      getState,
      checkNow: vi.fn(async () => someState),
      scheduleStartupCheck: vi.fn(),
    }
    const { getState: handler } = await setup(update)

    await expect(handler(fakeEvent, undefined)).resolves.toEqual(someState)
    expect(getState).toHaveBeenCalledTimes(1)
  })
})

describe('update:check', () => {
  it('calls the service checkNow() (not just getState()) and resolves with its result', async () => {
    const availableState: UpdateState = { ...someState, status: 'available' }
    const checkNow = vi.fn(async () => availableState)
    const getState = vi.fn(async () => someState)
    const update = { ...fakeActions(), getState, checkNow, scheduleStartupCheck: vi.fn() }
    const { check } = await setup(update)

    const result = await check(fakeEvent, undefined)

    expect(checkNow).toHaveBeenCalledTimes(1)
    expect(getState).not.toHaveBeenCalled()
    expect(result).toEqual(availableState)
  })

  it('resolves rather than rejecting when the underlying check throws - the real service, wired in, never lets a broken checker reject the IPC promise', async () => {
    // Deliberately not a hand-rolled fake here: `createUpdateService` (D3) is documented to never
    // reject `checkNow()` even if the injected `check` throws - it catches that internally and
    // resolves with an `'error'` state instead. Wiring the *real* service in (with a broken `check`
    // and an in-memory store, so nothing touches Electron/disk) proves that guarantee survives the
    // trip through `registerUpdateIpc` unchanged, without the registrar needing its own try/catch.
    const { createUpdateService } = await import('../services/update/service')
    const fakeStore = {
      load: vi.fn(async () => ({ update: null, lastCheckedAt: null, lastSuccessAt: null })),
      save: vi.fn(async () => undefined),
    }
    const update = createUpdateService({
      isPackaged: true,
      backend: {
        autoInstallOnAppQuit: false,
        download: vi.fn(async () => ({ ok: true as const })),
        cancelDownload: vi.fn(),
        quitAndInstall: vi.fn(),
      },
      isGameRunning: () => false,
      listJobs: () => [],
      check: vi.fn(async () => {
        throw new Error('checker exploded')
      }),
      onStateChange: () => undefined,
      store: fakeStore,
      log: { warn: () => undefined },
    })
    const { check } = await setup(update)

    const result = (await check(fakeEvent, undefined)) as UpdateState

    expect(result.status).toBe('error')
    expect(result.supported).toBe(true)
  })
})

/**
 * Story 098 D1: the four staged actions. The registrar's whole job is to route and to pass the
 * service's `Outcome` through untouched - a refusal decided in main must reach the renderer with
 * its key intact, since that key *is* the reason the user gets to read (AC6/AC7).
 */
describe('the staged update actions (story 098)', () => {
  it('routes each channel to its own service method and passes the outcome through', async () => {
    const actions = fakeActions()
    const update = {
      ...actions,
      getState: vi.fn(async () => someState),
      checkNow: vi.fn(async () => someState),
      scheduleStartupCheck: vi.fn(),
    }
    const handlers = await setup(update)

    // `cancelDownload`/`dismiss` answer synchronously and the others don't, which `ipcMain.handle`
    // does not care about either way - so does this assertion.
    expect(await handlers.download(fakeEvent, undefined)).toEqual(ok(someState))
    expect(await handlers.cancelDownload(fakeEvent, undefined)).toEqual(ok(someState))
    expect(await handlers.installAndRestart(fakeEvent, undefined)).toEqual(ok(null))
    expect(await handlers.dismiss(fakeEvent, undefined)).toEqual(ok(someState))

    expect(actions.startDownload).toHaveBeenCalledTimes(1)
    expect(actions.cancelDownload).toHaveBeenCalledTimes(1)
    expect(actions.installAndRestart).toHaveBeenCalledTimes(1)
    expect(actions.dismiss).toHaveBeenCalledTimes(1)
  })

  it('hands a refusal to the renderer with its key unchanged', async () => {
    const actions = fakeActions()
    actions.installAndRestart.mockResolvedValue(
      fail('appUpdate.error.gameRunning') as ReturnType<typeof ok<null>>,
    )
    const update = {
      ...actions,
      getState: vi.fn(async () => someState),
      checkNow: vi.fn(async () => someState),
      scheduleStartupCheck: vi.fn(),
    }
    const { installAndRestart } = await setup(update)

    expect(await installAndRestart(fakeEvent, undefined)).toEqual({
      ok: false,
      error: { key: 'appUpdate.error.gameRunning' },
    })
  })

  it('refuses a non-void payload as an invalid payload without reaching the service', async () => {
    const actions = fakeActions()
    const update = {
      ...actions,
      getState: vi.fn(async () => someState),
      checkNow: vi.fn(async () => someState),
      scheduleStartupCheck: vi.fn(),
    }
    const { installAndRestart } = await setup(update)

    expect(await installAndRestart(fakeEvent, { force: true })).toEqual({
      ok: false,
      error: { key: 'ipc.error.invalidPayload' },
    })
    expect(actions.installAndRestart).not.toHaveBeenCalled()
  })
})
