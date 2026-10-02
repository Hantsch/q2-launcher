import type { IpcMainInvokeEvent } from 'electron'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { DEV_ONLY_CHANNELS, INVOKE_CHANNELS } from '@shared/ipc'
import type { AppContext } from '../context'
import { resolveUiHarness } from '../lib/ui-harness'
import en from '../../renderer/src/i18n/locales/en.json'

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
  clipboard: { writeText: vi.fn() },
}))

const logSpy = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}))

vi.mock('../lib/logger', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/logger')>()),
  scopedLogger: () => logSpy,
}))

const fakeEvent = {} as unknown as IpcMainInvokeEvent

/**
 * Story 067 D4: the icon channels now delegate to `app.icons`, so the context handed to
 * `registerAllIpc` carries a stub for it - these tests still assert only the wrapper's job
 * (validation, delegation, pass-through), never the icon store's, which has its own suite in
 * `src/main/services/installation-icons.test.ts`.
 */
const iconsMock = {
  clear: vi.fn(async () => ({ ok: true as const, value: 'cleared' })),
  setShipped: vi.fn(async () => ({ ok: true as const, value: 'shipped' })),
  dataUrl: vi.fn(async () => 'data:image/png;base64,AAAA'),
}

function fakeApp(isDev: boolean): AppContext {
  return { isDev, harness: resolveUiHarness(process.env), icons: iconsMock } as unknown as AppContext
}

beforeEach(() => {
  registered.clear()
  vi.resetModules()
  logSpy.error.mockClear()
  iconsMock.clear.mockClear()
  iconsMock.setShipped.mockClear()
  iconsMock.dataUrl.mockClear()
})

describe('registerAllIpc', () => {
  it('lists dev:simulateLaunch (story 090 D5) as dev-only', () => {
    expect(DEV_ONLY_CHANNELS).toContain('dev:simulateLaunch')
  })

  it('lists dev:simulateAppUpdate (story 098 D4) as dev-only', () => {
    expect(DEV_ONLY_CHANNELS).toContain('dev:simulateAppUpdate')
  })

  it('registers every non-dev-only channel and does not throw when isDev is false', async () => {
    delete process.env['Q2L_UI_HARNESS']
    const { registerAllIpc } = await import('./index')
    expect(() => registerAllIpc(fakeApp(false))).not.toThrow()

    for (const channel of INVOKE_CHANNELS) {
      if (DEV_ONLY_CHANNELS.includes(channel)) continue
      expect(registered.has(channel)).toBe(true)
    }
    expect(registered.has('dev:simulateJob')).toBe(false)
    expect(registered.has('dev:simulateLaunch')).toBe(false)
    expect(registered.has('dev:simulateAppUpdate')).toBe(false)
  })

  it('registers every channel, including dev-only ones, when isDev is true, with no throw', async () => {
    delete process.env['Q2L_UI_HARNESS']
    const { registerAllIpc } = await import('./index')
    expect(() => registerAllIpc(fakeApp(true))).not.toThrow()

    for (const channel of INVOKE_CHANNELS) {
      expect(registered.has(channel)).toBe(true)
    }
    // 39 + story 098's four staged update actions + D4's dev:simulateAppUpdate
    // + story 099's app:getReleaseNotes + story 103 D6's installations:listRunners
    // + story 130 D2's features:getUnlocked + story 129 D1's unlock:getState and unlock:redeem.
    expect(registered.size).toBe(49)
  })

  // Story 101 F3: the UI-verification harness's CI job drives a real packaged AppImage, where
  // `isDev` is always `false` - so dev-only channels must also register there when the harness
  // explicitly opts in via `Q2L_UI_HARNESS === '1'`, and must NOT register merely because a
  // packaged build happens to run without that variable set (a real user's install never sets it).
  it('registers dev-only channels when isDev is false but Q2L_UI_HARNESS=1, with no throw', async () => {
    process.env['Q2L_UI_HARNESS'] = '1'
    try {
      const { registerAllIpc } = await import('./index')
      expect(() => registerAllIpc(fakeApp(false))).not.toThrow()

      expect(registered.has('dev:simulateJob')).toBe(true)
      expect(registered.has('dev:simulateLaunch')).toBe(true)
      expect(registered.has('dev:simulateAppUpdate')).toBe(true)
    } finally {
      delete process.env['Q2L_UI_HARNESS']
    }
  })

  it('does not register dev-only channels when isDev is false and Q2L_UI_HARNESS is unset', async () => {
    delete process.env['Q2L_UI_HARNESS']
    const { registerAllIpc } = await import('./index')
    registerAllIpc(fakeApp(false))

    expect(registered.has('dev:simulateJob')).toBe(false)
    expect(registered.has('dev:simulateLaunch')).toBe(false)
    expect(registered.has('dev:simulateAppUpdate')).toBe(false)
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

  // ---- story 067: the icon channels (D3's contract, D4's handlers) --------------------------

  it('resolves an invalid payload on installations:setIcon to a failed Outcome without running the handler', async () => {
    const { registerAllIpc } = await import('./index')
    registerAllIpc(fakeApp(false))

    const fn = registered.get('installations:setIcon')!
    const result = await fn(fakeEvent, {
      installationId: 'id',
      icon: { kind: 'shipped', id: '../etc' },
    })
    expect(result).toEqual({ ok: false, error: { key: 'ipc.error.invalidPayload' } })
  })

  it('routes a null icon on installations:setIcon to the icon store and passes its outcome through', async () => {
    const { registerAllIpc } = await import('./index')
    registerAllIpc(fakeApp(false))

    const fn = registered.get('installations:setIcon')!
    const result = await fn(fakeEvent, { installationId: 'id', icon: null })

    expect(iconsMock.clear).toHaveBeenCalledWith('id')
    expect(result).toEqual({ ok: true, value: 'cleared' })
  })

  it('routes a shipped icon on installations:setIcon to the icon store', async () => {
    const { registerAllIpc } = await import('./index')
    registerAllIpc(fakeApp(false))

    const fn = registered.get('installations:setIcon')!
    const result = await fn(fakeEvent, {
      installationId: 'id',
      icon: { kind: 'shipped', id: 'ring' },
    })

    expect(iconsMock.setShipped).toHaveBeenCalledWith('id', 'ring')
    expect(result).toEqual({ ok: true, value: 'shipped' })
  })

  it('refuses a bare custom icon on installations:setIcon - only a stored pick may set that', async () => {
    const { registerAllIpc } = await import('./index')
    registerAllIpc(fakeApp(false))

    const fn = registered.get('installations:setIcon')!
    // Schema-valid, but `{ kind: 'custom' }` without stored bytes is not a state the renderer may
    // ask for - `installations:pickIconFile` is the only way a custom icon comes into being.
    const result = await fn(fakeEvent, { installationId: 'id', icon: { kind: 'custom' } })

    expect(result).toEqual({ ok: false, error: { key: 'ipc.error.invalidPayload' } })
    expect(iconsMock.clear).not.toHaveBeenCalled()
    expect(iconsMock.setShipped).not.toHaveBeenCalled()
  })

  it('resolves an invalid payload on installations:pickIconFile to a failed Outcome without running the handler', async () => {
    const { registerAllIpc } = await import('./index')
    registerAllIpc(fakeApp(false))

    const fn = registered.get('installations:pickIconFile')!
    const result = await fn(fakeEvent, { garbage: true })
    expect(result).toEqual({ ok: false, error: { key: 'ipc.error.invalidPayload' } })
  })

  it('rejects an invalid payload on installations:iconDataUrl synchronously', async () => {
    const { registerAllIpc } = await import('./index')
    registerAllIpc(fakeApp(true))

    const fn = registered.get('installations:iconDataUrl')!
    expect(() => fn(fakeEvent, 42)).toThrow()
  })

  it('answers a valid installations:iconDataUrl payload from the icon store', async () => {
    const { registerAllIpc } = await import('./index')
    registerAllIpc(fakeApp(true))

    const fn = registered.get('installations:iconDataUrl')!
    await expect(fn(fakeEvent, 'some-id')).resolves.toBe('data:image/png;base64,AAAA')
    expect(iconsMock.dataUrl).toHaveBeenCalledWith('some-id')
  })
})

describe('a throwing handler', () => {
  const secretError = () =>
    new Error("EPERM: operation not permitted, open 'C:\\secret\\q2\\baseq2'")
  const anySchema = z.any() as never

  it('handleOutcome resolves a thrown handler to ipc.error.handlerFailed with the channel and logs it', async () => {
    const { handleOutcome } = await import('./index')
    handleOutcome('installations:inspectPath', anySchema, () => {
      throw secretError()
    })

    const result = await registered.get('installations:inspectPath')!(fakeEvent, 'x')

    expect(result).toEqual({
      ok: false,
      error: { key: 'ipc.error.handlerFailed', params: { channel: 'installations:inspectPath' } },
    })
    expect(JSON.stringify(result)).not.toContain('EPERM')
    expect(JSON.stringify(result)).not.toContain('secret')
    expect(logSpy.error).toHaveBeenCalledWith(
      expect.stringContaining('installations:inspectPath'),
      expect.anything(),
    )
  })

  it('handleOutcome resolves a rejected async handler to ipc.error.handlerFailed', async () => {
    const { handleOutcome } = await import('./index')
    handleOutcome('installations:inspectPath', anySchema, () => Promise.reject(secretError()))

    const result = await registered.get('installations:inspectPath')!(fakeEvent, 'x')

    expect(result).toEqual({
      ok: false,
      error: { key: 'ipc.error.handlerFailed', params: { channel: 'installations:inspectPath' } },
    })
    expect(JSON.stringify(result)).not.toContain('EPERM')
    expect(JSON.stringify(result)).not.toContain('secret')
    expect(logSpy.error).toHaveBeenCalledWith(
      expect.stringContaining('installations:inspectPath'),
      expect.anything(),
    )
  })

  it('handle rejects a thrown handler with a sanitised ipc.error.handlerFailed error', async () => {
    const { handle } = await import('./index')
    handle('window:getState', anySchema, () => {
      throw secretError()
    })

    const rejection = await Promise.resolve(
      registered.get('window:getState')!(fakeEvent, undefined),
    ).then(
        () => null,
        (error: unknown) => error,
      )

    expect(rejection).toBeInstanceOf(Error)
    const message = (rejection as Error).message
    expect(message).toBe('ipc.error.handlerFailed')
    expect(message).not.toContain('EPERM')
    expect(message).not.toContain('C:\\')
    expect(logSpy.error).toHaveBeenCalledWith(
      expect.stringContaining('window:getState'),
      expect.anything(),
    )
  })
})

describe('handlerFailed documentation and copy', () => {
  it('ipc.error.handlerFailed resolves to a string in en.json', () => {
    expect(typeof en.ipc.error.handlerFailed).toBe('string')
  })

  it('ARCHITECTURE.md states that both surfaces turn a throw into handlerFailed', () => {
    const doc = readFileSync(resolve(__dirname, '../../../docs/ARCHITECTURE.md'), 'utf8')
    expect(doc).toContain('ipc.error.handlerFailed')
    expect(doc).toContain('modules.error.handlerFailed')
  })
})
