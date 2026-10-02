// @vitest-environment jsdom
import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import type { ModuleEvent, Outcome } from '@shared/types'

/**
 * Story 082 D7. `moduleClient.ts` reaches `window.q2` at *module* scope (through
 * `lib/bridge.ts`), so the bridge is stubbed before the module under test is imported -
 * same pattern as `modules/index.test.ts` / `modules/home/HomeView.test.tsx`.
 *
 * The stubbed `on` behaves like the real preload bridge closely enough for these tests:
 * it records the single listener passed for `module:event` and returns an unsubscribe
 * that forgets it, so `emit()` below simulates an incoming IPC push and the returned
 * unsubscribe function can be proven to actually stop delivery.
 */
type Listener = (payload: unknown) => void

let onListener: Listener | undefined

const invokeMock = vi.fn()
const onMock = vi.fn((_channel: string, listener: Listener) => {
  onListener = listener
  return () => {
    onListener = undefined
  }
})

;(globalThis as unknown as { q2: unknown }).q2 = { invoke: invokeMock, on: onMock }

const { callModule, createModuleClient, onModuleEvent } = await import('./moduleClient')

/** Simulates the preload bridge delivering an incoming `module:event` push. */
function emit(event: ModuleEvent): void {
  onListener?.(event)
}

beforeEach(() => {
  invokeMock.mockReset()
  onMock.mockClear()
  onListener = undefined
})

describe('callModule', () => {
  it('invokes module:invoke with the moduleId and type, no payload key when omitted', async () => {
    invokeMock.mockResolvedValue({ ok: true, value: 42 })

    const result = await callModule('home', 'news.get')

    expect(invokeMock).toHaveBeenCalledWith('module:invoke', { moduleId: 'home', type: 'news.get' })
    expect(result).toEqual({ ok: true, value: 42 })
  })

  it('carries a provided payload through', async () => {
    invokeMock.mockResolvedValue({ ok: true, value: null })

    await callModule('home', 'news.refresh', { force: true })

    expect(invokeMock).toHaveBeenCalledWith('module:invoke', {
      moduleId: 'home',
      type: 'news.refresh',
      payload: { force: true },
    })
  })
})

describe('onModuleEvent', () => {
  it('a module event reaches its subscriber', () => {
    const listener = vi.fn()
    onModuleEvent('home', 'news.changed', listener)

    emit({ moduleId: 'home', type: 'news.changed', payload: { slides: [] } })

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith({ slides: [] })
  })

  it('ignores an event for a different moduleId or a different type', () => {
    const listener = vi.fn()
    onModuleEvent('home', 'news.changed', listener)

    emit({ moduleId: 'library', type: 'news.changed', payload: { slides: [] } })
    emit({ moduleId: 'home', type: 'other.event', payload: {} })

    expect(listener).not.toHaveBeenCalled()
  })

  it('stops delivery once unsubscribed', () => {
    const listener = vi.fn()
    const unsubscribe = onModuleEvent('home', 'news.changed', listener)

    unsubscribe()
    emit({ moduleId: 'home', type: 'news.changed', payload: {} })

    expect(listener).not.toHaveBeenCalled()
  })
})

type TestContract = {
  handlers: {
    greet: { req: { name: string }; res: string }
    count: { req: void; res: number }
  }
  events: {
    greeted: { name: string }
  }
}

describe('createModuleClient', () => {
  it('createModuleClient infers Outcome<Res> per handler', () => {
    const { call, on } = createModuleClient<TestContract>('home')

    // Never invoked: only the compiler checks these.
    const typeChecks = (): void => {
      expectTypeOf(call('greet', { name: 'a' })).toEqualTypeOf<Promise<Outcome<string>>>()
      expectTypeOf(call('count')).toEqualTypeOf<Promise<Outcome<number>>>()
      expectTypeOf(
        on('greeted', (p) => expectTypeOf(p).toEqualTypeOf<{ name: string }>()),
      ).toEqualTypeOf<() => void>()
      // @ts-expect-error a required payload cannot be omitted
      void call('greet')
      // @ts-expect-error a void handler takes no payload
      void call('count', {})
      // @ts-expect-error unknown handler type
      void call('nope')
      // @ts-expect-error unknown event type
      on('nope', () => {})
    }
    expect(typeChecks).toBeTypeOf('function')
  })

  it('createModuleClient sends the module:invoke envelope', async () => {
    invokeMock.mockResolvedValue({ ok: true, value: 'hi' })
    const { call } = createModuleClient<TestContract>('home')

    const result = await call('greet', { name: 'a' })
    await call('count')

    expect(result).toEqual({ ok: true, value: 'hi' })
    expect(invokeMock).toHaveBeenNthCalledWith(1, 'module:invoke', {
      moduleId: 'home',
      type: 'greet',
      payload: { name: 'a' },
    })
    const second = invokeMock.mock.calls[1][1] as Record<string, unknown>
    expect(second).toEqual({ moduleId: 'home', type: 'count' })
    expect('payload' in second).toBe(false)
  })

  it('on filters by moduleId and type', () => {
    const { on } = createModuleClient<TestContract>('home')
    const listener = vi.fn()
    on('greeted', listener)

    emit({ moduleId: 'library', type: 'greeted', payload: { name: 'x' } })
    emit({ moduleId: 'home', type: 'other', payload: { name: 'x' } })
    expect(listener).not.toHaveBeenCalled()

    emit({ moduleId: 'home', type: 'greeted', payload: { name: 'y' } })
    expect(listener).toHaveBeenCalledWith({ name: 'y' })
  })
})
