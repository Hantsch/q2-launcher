import { describe, expect, it, vi } from 'vitest'
import { boot, type BootSteps } from './boot'

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** Lets every already-queued continuation run, without touching any clock. */
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve()
}

const SHELL = { name: 'shell' }
const WINDOW = { name: 'window' }
const CONTEXT = { name: 'context' }

type Shell = typeof SHELL
type Window = typeof WINDOW
type Context = typeof CONTEXT

/** Fake steps whose context waits on `stateRead`, recording the order things happen in. */
function fakeSteps(stateRead: Promise<void>) {
  const events: string[] = []
  const steps: BootSteps<Shell, Window, Context> = {
    bindIpc: vi.fn(() => events.push('bind')),
    createShell: vi.fn(() => SHELL),
    createWindow: vi.fn(async () => {
      events.push('window')
      return WINDOW
    }),
    createContext: vi.fn(async () => {
      await stateRead
      events.push('context')
      return CONTEXT
    }),
    registerIpc: vi.fn(() => events.push('register')),
    markReady: vi.fn(() => events.push('ready')),
    markFailed: vi.fn(() => events.push('failed')),
  }
  return { steps, events }
}

describe('boot', () => {
  it('the window is created before a slow state read finishes', async () => {
    const stateRead = deferred<void>()
    const { steps, events } = fakeSteps(stateRead.promise)

    const booted = boot(steps)
    await flush()

    expect(events).toEqual(['bind', 'window'])
    expect(steps.createWindow).toHaveBeenCalledWith(SHELL)
    expect(steps.createContext).toHaveBeenCalledWith(SHELL)
    expect(steps.markReady).not.toHaveBeenCalled()

    stateRead.resolve()
    await expect(booted).resolves.toEqual({ shell: SHELL, window: WINDOW, context: CONTEXT })
    expect(events).toEqual(['bind', 'window', 'context', 'register', 'ready'])
    expect(steps.registerIpc).toHaveBeenCalledWith(CONTEXT)
  })

  it('a failed context marks IPC failed and still leaves the window', async () => {
    const stateRead = deferred<void>()
    const { steps, events } = fakeSteps(stateRead.promise)
    const failure = new Error('state unreadable')

    const booted = boot(steps)
    stateRead.reject(failure)

    await expect(booted).resolves.toEqual({ shell: SHELL, window: WINDOW, context: null })
    expect(steps.markFailed).toHaveBeenCalledWith(failure)
    expect(steps.registerIpc).not.toHaveBeenCalled()
    expect(steps.markReady).not.toHaveBeenCalled()
    expect(events).toEqual(['bind', 'window', 'failed'])
  })

  it('an IPC registration that throws marks IPC failed instead of holding invokes', async () => {
    const { steps } = fakeSteps(Promise.resolve())
    const incomplete = new Error('channels declared but not handled')
    steps.registerIpc = vi.fn(() => {
      throw incomplete
    })

    await expect(boot(steps)).resolves.toMatchObject({ window: WINDOW, context: null })
    expect(steps.markFailed).toHaveBeenCalledWith(incomplete)
    expect(steps.markReady).not.toHaveBeenCalled()
  })

  it('a window that fails rejects the boot while the context still finishes', async () => {
    const { steps } = fakeSteps(Promise.resolve())
    const broken = new Error('renderer did not load')
    steps.createWindow = vi.fn(async () => {
      throw broken
    })

    await expect(boot(steps)).rejects.toBe(broken)
    await flush()
    expect(steps.markReady).toHaveBeenCalledOnce()
  })
})
