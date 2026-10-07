import { afterEach, describe, expect, it, vi } from 'vitest'
import { installShutdown, type ShutdownApp } from './shutdown'

function fakeApp() {
  let listener: ((event: { preventDefault(): void }) => void) | undefined
  const app: ShutdownApp = {
    on: (_event, l) => {
      listener = l
    },
    quit: vi.fn(),
  }
  const fire = () => {
    const event = { preventDefault: vi.fn() }
    listener?.(event)
    return event
  }
  return { app, fire }
}

afterEach(() => vi.useRealTimers())

describe('installShutdown', () => {
  it('releases playback first, then disposes, then settles, then quits', async () => {
    const { app, fire } = fakeApp()
    const order: string[] = []
    installShutdown({
      app,
      log: { error: vi.fn() },
      releasePlayback: () => order.push('release'),
      disposeModules: async () => {
        order.push('dispose')
      },
      settles: [
        {
          label: 'state',
          run: async () => {
            order.push('settle')
            return { ok: true }
          },
        },
      ],
    })
    vi.mocked(app.quit).mockImplementation(() => order.push('quit'))

    const event = fire()
    expect(event.preventDefault).toHaveBeenCalled()
    await vi.waitFor(() => expect(app.quit).toHaveBeenCalled())
    expect(order).toEqual(['release', 'dispose', 'settle', 'quit'])
  })

  it('releases playback synchronously inside the event, and a throwing release does not hold quit', async () => {
    const { app, fire } = fakeApp()
    const error = vi.fn()
    const release = vi.fn(() => {
      throw new Error('boom')
    })
    installShutdown({
      app,
      log: { error },
      releasePlayback: release,
      disposeModules: async () => {},
      settles: [],
    })

    fire()
    expect(release).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(app.quit).toHaveBeenCalled())
    expect(error).toHaveBeenCalledWith('shutdown: releasing playback failed', expect.any(Error))
  })

  it('a second before-quit during shutdown starts nothing', async () => {
    const { app, fire } = fakeApp()
    const releasePlayback = vi.fn()
    installShutdown({
      app,
      log: { error: vi.fn() },
      releasePlayback,
      disposeModules: async () => {},
      settles: [],
    })

    fire()
    const second = fire()
    await vi.waitFor(() => expect(app.quit).toHaveBeenCalled())
    const third = fire()

    expect(second.preventDefault).not.toHaveBeenCalled()
    expect(third.preventDefault).not.toHaveBeenCalled()
    expect(releasePlayback).toHaveBeenCalledTimes(1)
    expect(app.quit).toHaveBeenCalledTimes(1)
  })

  it('a hanging settle is cut off at the timeout, logged, and the app still quits', async () => {
    vi.useFakeTimers()
    const { app, fire } = fakeApp()
    const error = vi.fn()
    installShutdown({
      app,
      timeoutMs: 3000,
      log: { error },
      releasePlayback: () => {},
      disposeModules: async () => {},
      settles: [{ label: 'state', run: () => new Promise(() => {}) }],
    })

    fire()
    await vi.advanceTimersByTimeAsync(2999)
    expect(app.quit).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)

    expect(app.quit).toHaveBeenCalledTimes(1)
    expect(error).toHaveBeenCalledWith(expect.stringContaining('timed out'))
  })

  it('an unsuccessful settle is logged', async () => {
    const { app, fire } = fakeApp()
    const error = vi.fn()
    installShutdown({
      app,
      log: { error },
      releasePlayback: () => {},
      disposeModules: async () => {},
      settles: [
        { label: 'state', run: async () => ({ ok: true }) },
        {
          label: 'persistence',
          run: async () => [
            { label: 'news-cache', ok: false },
            { label: 'mods', ok: true },
          ],
        },
        { label: 'window', run: () => Promise.reject(new Error('boom')) },
      ],
    })

    fire()
    await vi.waitFor(() => expect(app.quit).toHaveBeenCalled())

    expect(error).toHaveBeenCalledWith(expect.stringContaining('news-cache'))
    expect(error).toHaveBeenCalledWith(expect.stringContaining('window'), expect.any(Error))
    expect(error).toHaveBeenCalledTimes(2)
  })
})
