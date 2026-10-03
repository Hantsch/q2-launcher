// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Outcome } from '@shared/types/common'
import { useListSort } from './useListSort'

type Sort = { column: string }
const fail: Outcome<Sort | null> = { ok: false, error: { key: 'ipc.error.unreachable' } }

describe('useListSort', () => {
  it('a failed read yields null', async () => {
    const { result } = renderHook(() =>
      useListSort<Sort>(
        () => Promise.resolve(fail),
        () => Promise.resolve(fail),
      ),
    )
    await act(async () => {})
    expect(result.current.sort).toBeNull()
  })

  it("setSort applies at once then adopts main's echo", async () => {
    let release: (o: Outcome<Sort | null>) => void = () => {}
    const { result } = renderHook(() =>
      useListSort<Sort>(
        () => Promise.resolve({ ok: true, value: null }),
        () => new Promise((resolve) => (release = resolve)),
      ),
    )
    await act(async () => {})
    act(() => result.current.setSort({ column: 'ping' }))
    expect(result.current.sort).toEqual({ column: 'ping' })
    await act(async () => release({ ok: true, value: { column: 'name' } }))
    await waitFor(() => expect(result.current.sort).toEqual({ column: 'name' }))
  })

  it('a failed set falls back to null', async () => {
    const { result } = renderHook(() =>
      useListSort<Sort>(
        () => Promise.resolve({ ok: true, value: { column: 'ping' } }),
        () => Promise.resolve(fail),
      ),
    )
    await waitFor(() => expect(result.current.sort).toEqual({ column: 'ping' }))
    await act(async () => result.current.setSort({ column: 'name' }))
    expect(result.current.sort).toBeNull()
  })
})
