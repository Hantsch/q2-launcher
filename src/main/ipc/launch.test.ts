import type { IpcMainInvokeEvent } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppContext } from '../context'

/**
 * Story 163 AC2: `launch:start` can never open a playback pipe. Only the main-side demo-play path
 * passes the playback option to `LaunchService.start`; the IPC handler must call it with ONE argument.
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
  BrowserWindow: { fromWebContents: () => null },
  app: { quit: vi.fn() },
}))

const fakeEvent = { sender: {} } as unknown as IpcMainInvokeEvent

async function setup() {
  const start = vi.fn(async (..._args: unknown[]) => ({
    ok: false as const,
    error: { key: 'launch.failed' },
  }))
  const { registerLaunchIpc } = await import('./launch')
  registerLaunchIpc({ launch: { start } } as unknown as AppContext)
  return { start, handler: registered.get('launch:start')! }
}

beforeEach(() => {
  registered.clear()
  vi.resetModules()
})

describe('launch:start', () => {
  it('launch:start never passes a playback option to the launch service', async () => {
    const { start, handler } = await setup()
    const input = { installationId: 'inst-1' }

    await handler(fakeEvent, input)
    await handler(fakeEvent, { ...input, playback: true })

    expect(start).toHaveBeenCalledTimes(2)
    expect(start).toHaveBeenCalledWith(input)
    for (const call of start.mock.calls) {
      expect(call.length).toBe(1)
      expect(JSON.stringify(call)).not.toContain('"playback":true')
    }
  })
})
