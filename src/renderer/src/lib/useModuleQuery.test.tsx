// @vitest-environment jsdom
import { StrictMode, type ReactNode } from 'react'
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Outcome } from '@shared/types/common'
import { useModuleMutation, useModuleQuery } from './useModuleQuery'

// React ignores a setState after unmount, so the unmount guards are only observable by counting
// the calls: every `useState` setter is wrapped (stable identity) to bump this counter.
const setterCalls = vi.hoisted(() => ({ count: 0 }))
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  return {
    ...actual,
    useState: (initial: unknown) => {
      const [value, set] = actual.useState(initial)
      const wrapped = actual.useRef<unknown>(null)
      wrapped.current ??= (next: unknown) => {
        setterCalls.count++
        ;(set as (v: unknown) => void)(next)
      }
      return [value, wrapped.current]
    },
  }
})

interface Deferred<T> {
  promise: Promise<T>
  resolve: (v: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}
const good = <T,>(value: T): Outcome<T> => ({ ok: true, value })
const strict = ({ children }: { children: ReactNode }): ReactNode => (
  <StrictMode>{children}</StrictMode>
)

describe('useModuleQuery', () => {
  it('query: unmount before resolve drops the result and unsubscribes', async () => {
    const d = deferred<Outcome<number>>()
    const unsubscribe = vi.fn()
    const { result, unmount } = renderHook(() =>
      useModuleQuery(() => d.promise, { subscribe: () => unsubscribe }),
    )
    unmount()
    setterCalls.count = 0
    await act(async () => d.resolve(good(1)))
    expect(setterCalls.count).toBe(0)
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(result.current.data).toBeUndefined()
  })

  it('query: StrictMode double mount reads, subscribes and settles once', async () => {
    const reads: Deferred<Outcome<number>>[] = []
    const read = vi.fn(() => {
      const d = deferred<Outcome<number>>()
      reads.push(d)
      return d.promise
    })
    const unsubscribe = vi.fn()
    const subscribe = vi.fn(() => unsubscribe)
    const { result } = renderHook(() => useModuleQuery(read, { subscribe }), { wrapper: strict })
    // Whether or not the runtime double-invokes effects, every cycle but the live one is torn down.
    expect(subscribe).toHaveBeenCalledTimes(read.mock.calls.length)
    expect(unsubscribe).toHaveBeenCalledTimes(subscribe.mock.calls.length - 1)
    await act(async () => {
      reads.forEach((d, i) => d.resolve(good(i + 1)))
    })
    expect(result.current.state).toBe('success')
    expect(result.current.data).toBe(reads.length)
  })

  it('query: a transport failure becomes error and keeps data', async () => {
    let next: Outcome<number> | Error = good(5)
    const { result } = renderHook(() =>
      useModuleQuery(() => (next instanceof Error ? Promise.reject(next) : Promise.resolve(next))),
    )
    await act(async () => {})
    expect(result.current.data).toBe(5)
    next = { ok: false, error: { key: 'x.fail' } }
    await act(async () => result.current.reload())
    expect(result.current.state).toBe('error')
    expect(result.current.error).toEqual({ key: 'x.fail' })
    expect(result.current.data).toBe(5)
    next = new Error('boom')
    await act(async () => result.current.reload())
    expect(result.current.error).toEqual({ key: 'ipc.error.unreachable' })
    expect(result.current.data).toBe(5)
  })

  it('query: a push beats a later-resolving read', async () => {
    const d = deferred<Outcome<number>>()
    let push!: (v: number) => void
    const { result } = renderHook(() =>
      useModuleQuery(() => d.promise, {
        subscribe: (p) => {
          push = p
          return () => {}
        },
      }),
    )
    act(() => push(7))
    expect(result.current.state).toBe('success')
    await act(async () => d.resolve(good(1)))
    expect(result.current.data).toBe(7)
  })

  it('query: setData beats a later-resolving read', async () => {
    const d = deferred<Outcome<number>>()
    const { result } = renderHook(() => useModuleQuery(() => d.promise))
    act(() => result.current.setData(9))
    expect(result.current.state).toBe('success')
    await act(async () => d.resolve(good(1)))
    expect(result.current.data).toBe(9)
    expect(result.current.state).toBe('success')
  })

  it('query: a stale reload response is dropped', async () => {
    const first = deferred<Outcome<number>>()
    const second = deferred<Outcome<number>>()
    const queue = [first, second]
    const { result } = renderHook(() => useModuleQuery(() => queue.shift()!.promise))
    act(() => result.current.reload())
    await act(async () => second.resolve(good(2)))
    await act(async () => first.resolve(good(1)))
    expect(result.current.data).toBe(2)
  })
})

type Domain =
  { ok: true; n: number } | { ok: false; reasonKey: string; params?: Record<string, string> }

describe('useModuleMutation', () => {
  it('mutation: a refused mutation sets the mapped error and resolves the refusal', async () => {
    const refusal: Domain = { ok: false, reasonKey: 'a.refused', params: { n: 'x' } }
    const plain = renderHook(() => useModuleMutation(async () => good<Domain>(refusal)))
    let value: Domain | undefined
    await act(async () => {
      value = await plain.result.current.run(undefined)
    })
    expect(value).toBe(refusal)
    expect(plain.result.current.error).toEqual({ key: 'a.refused', params: { n: 'x' } })

    const mapped = renderHook(() =>
      useModuleMutation(
        async () => good<Domain>(refusal),
        () => ({ key: 'mapped' }),
      ),
    )
    await act(async () => {
      await mapped.result.current.run(undefined)
    })
    expect(mapped.result.current.error).toEqual({ key: 'mapped' })
  })

  it('mutation: a transport failure sets the outcome error and resolves undefined', async () => {
    const { result } = renderHook(() =>
      useModuleMutation(async (): Promise<Outcome<Domain>> => ({
        ok: false,
        error: { key: 'x.t' },
      })),
    )
    let value: Domain | undefined = { ok: true, n: 1 }
    await act(async () => {
      value = await result.current.run(undefined)
    })
    expect(value).toBeUndefined()
    expect(result.current.error).toEqual({ key: 'x.t' })
  })

  it('mutation: busy is true while in flight', async () => {
    const d = deferred<Outcome<Domain>>()
    const { result } = renderHook(() => useModuleMutation(() => d.promise))
    let pending!: Promise<Domain | undefined>
    act(() => {
      pending = result.current.run(undefined)
    })
    expect(result.current.busy).toBe(true)
    await act(async () => {
      d.resolve(good<Domain>({ ok: true, n: 1 }))
      await pending
    })
    expect(result.current.busy).toBe(false)
  })

  it('mutation: unmount before resolve sets no state', async () => {
    const d = deferred<Outcome<Domain>>()
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { result, unmount } = renderHook(() => useModuleMutation(() => d.promise))
    let pending!: Promise<Domain | undefined>
    act(() => {
      pending = result.current.run(undefined)
    })
    unmount()
    setterCalls.count = 0
    d.resolve({ ok: false, error: { key: 'late' } })
    await expect(pending).resolves.toBeUndefined()
    expect(setterCalls.count).toBe(0)
    expect(errors).not.toHaveBeenCalled()
    errors.mockRestore()
  })
})
