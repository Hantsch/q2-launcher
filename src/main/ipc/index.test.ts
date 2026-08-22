import type { IpcMainInvokeEvent } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEV_ONLY_CHANNELS, INVOKE_CHANNELS } from '@shared/ipc'
import type { AppContext } from '../context'

/**
 * Story 036 D8: covers `registerAllIpc()`'s two public wrappers (`handle`,
 * `handleOutcome`) end to end - every declared channel really gets bound to
 * `ipcMain.handle`, a bad payload behaves per the wrapper that owns the
 * channel (throw vs. failed `Outcome`), and a channel-specific `invalidKey`
 * survives the trip. `electron` is mocked just enough for registration to run
 * and for the mocked `ipcMain.handle` calls to be captured and re-invoked -
 * none of the assertions below reach into a handler body that would need a
 * working service, per the story's own guidance.
 */

const registered = vi.hoisted(() => new Map<string, (event: unknown, payload: unknown) => unknown>())

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

function fakeApp(isDev: boolean): AppContext {
  return { isDev } as unknown as AppContext
}

beforeEach(() => {
  registered.clear()
  vi.resetModules()
})

describe('registerAllIpc', () => {
  it('registers every non-dev-only channel and does not throw when isDev is false', async () => {
    const { registerAllIpc } = await import('./index')
    expect(() => registerAllIpc(fakeApp(false))).not.toThrow()

    for (const channel of INVOKE_CHANNELS) {
      if (DEV_ONLY_CHANNELS.includes(channel)) continue
      expect(registered.has(channel)).toBe(true)
    }
    expect(registered.has('dev:simulateJob')).toBe(false)
  })

  it('registers every channel, including dev-only ones, when isDev is true, with no throw', async () => {
    const { registerAllIpc } = await import('./index')
    expect(() => registerAllIpc(fakeApp(true))).not.toThrow()

    for (const channel of INVOKE_CHANNELS) {
      expect(registered.has(channel)).toBe(true)
    }
    expect(registered.size).toBe(32)
  })

  it('rejects an invalid payload on a plain (throwing) handle() channel synchronously', async () => {
    const { registerAllIpc } = await import('./index')
    registerAllIpc(fakeApp(true))

    const fn = registered.get('window:getState')!
    expect(() => fn(fakeEvent, 'not void')).toThrow()
  })

  it('resolves an invalid payload on a handleOutcome() channel to a failed Outcome without running the handler', async () => {
    const { registerAllIpc } = await import('./index')
    registerAllIpc(fakeApp(false))

    const fn = registered.get('installations:addExisting')!
    // `fakeApp(false)` has no `installations` service - if the handler body ran,
    // reading `app.installations.addExisting` would throw and this promise
    // would reject instead of resolving cleanly, which is the proof the
    // handler was never entered.
    const result = await fn(fakeEvent, { garbage: true })
    expect(result).toEqual({ ok: false, error: { key: 'ipc.error.invalidPayload' } })
  })

  it('preserves a channel-specific invalidKey for app:openExternal', async () => {
    const { registerAllIpc } = await import('./index')
    registerAllIpc(fakeApp(false))

    const fn = registered.get('app:openExternal')!
    const result = (await fn(fakeEvent, 'ftp://not-http')) as {
      ok: false
      error: { key: string }
    }
    expect(result.ok).toBe(false)
    expect(result.error.key).toBe('app.error.invalidUrl')
  })

  it('preserves a channel-specific invalidKey for app:revealPath', async () => {
    const { registerAllIpc } = await import('./index')
    registerAllIpc(fakeApp(false))

    const fn = registered.get('app:revealPath')!
    const result = (await fn(fakeEvent, '')) as { ok: false; error: { key: string } }
    expect(result.ok).toBe(false)
    expect(result.error.key).toBe('app.error.invalidPath')
  })
})
