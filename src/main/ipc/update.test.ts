import type { IpcMainInvokeEvent } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UpdateState } from '@shared/types'
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
  update: null,
  error: null,
  lastCheckedAt: '2026-01-01T00:00:00.000Z',
  lastSuccessAt: '2026-01-01T00:00:00.000Z',
  supported: true,
}

async function setup(update: AppContext['update']): Promise<{
  getState: (event: unknown, payload: unknown) => unknown
  check: (event: unknown, payload: unknown) => unknown
}> {
  const { registerUpdateIpc } = await import('./update')
  const app = { update } as unknown as AppContext
  registerUpdateIpc(app)
  return {
    getState: registered.get('update:getState')!,
    check: registered.get('update:check')!,
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
    const update = { getState, checkNow, scheduleStartupCheck: vi.fn() }
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
