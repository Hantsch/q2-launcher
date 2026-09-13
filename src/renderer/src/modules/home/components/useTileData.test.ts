// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useTileData } from './useTileData'

/**
 * Story 087 D2. `useTileData` is the fetch/retry state machine every dashboard tile body uses -
 * `DashboardTileFrame.test.tsx` covers the frame these results are rendered through; this file
 * covers only the state machine itself.
 */

afterEach(() => {
  cleanup()
})

describe('useTileData', () => {
  it('calls the fetcher once on mount and lands on success with its data', async () => {
    const fetcher = vi.fn(async () => 'first-value')
    const { result } = renderHook(() => useTileData(fetcher))

    expect(result.current.state).toBe('loading')
    expect(result.current.data).toBeUndefined()

    await waitFor(() => expect(result.current.state).toBe('success'))
    expect(result.current.data).toBe('first-value')
    expect(result.current.error).toBeUndefined()
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('a rejected fetch lands on error with the rejection available', async () => {
    const failure = new Error('network down')
    const fetcher = vi.fn(async () => {
      throw failure
    })
    const { result } = renderHook(() => useTileData(fetcher))

    await waitFor(() => expect(result.current.state).toBe('error'))
    expect(result.current.error).toBe(failure)
  })

  it('retry re-runs the source after a failure: error -> loading -> success with the new data', async () => {
    const fetcher = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('first attempt failed'))
      .mockResolvedValueOnce('recovered-value')

    const { result } = renderHook(() => useTileData(fetcher))

    await waitFor(() => expect(result.current.state).toBe('error'))
    expect(fetcher).toHaveBeenCalledTimes(1)

    act(() => {
      result.current.retry()
    })

    // The retry moves the state machine back to loading synchronously - before the second fetch
    // has had a chance to resolve.
    expect(result.current.state).toBe('loading')
    expect(result.current.error).toBeUndefined()

    await waitFor(() => expect(result.current.state).toBe('success'))
    expect(result.current.data).toBe('recovered-value')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('does not restart the fetch just because the caller re-renders with a new fetcher closure', async () => {
    const first = vi.fn(async () => 'a')
    const { result, rerender } = renderHook(({ fetcher }) => useTileData(fetcher), {
      initialProps: { fetcher: first },
    })

    await waitFor(() => expect(result.current.state).toBe('success'))
    expect(first).toHaveBeenCalledTimes(1)

    const second = vi.fn(async () => 'b')
    rerender({ fetcher: second })

    expect(second).not.toHaveBeenCalled()
    expect(result.current.data).toBe('a')
  })
})
