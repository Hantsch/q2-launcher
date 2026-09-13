import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Story 087 D2. The one hook every dashboard tile body (Playtime, Config profiles, ...) uses to
 * fetch its own data, independently of every other tile - `DashboardTileFrame.tsx` (same directory)
 * is the frame those tiles render through once they have this.
 *
 * Deliberately only three states: `loading` / `error` / `success`. Whether a `success` result counts
 * as "empty" (zero installations, no config profiles) is specific to each tile's data shape, so this
 * hook cannot decide it - a caller composes its own `isEmpty(data)` check on top of `data` before
 * handing a four-way state to `DashboardTileFrame`. See that file's doc comment for the composition.
 */
export type TileDataState = 'loading' | 'error' | 'success'

export interface UseTileDataResult<T> {
  state: TileDataState
  /** The last successfully fetched value. Kept across a subsequent `retry()`'s `loading`/`error`
   * states (not reset to `undefined`) so a refetch does not flash a filled tile back to empty. */
  data: T | undefined
  /** Set only while `state === 'error'`; `undefined` otherwise. */
  error: unknown
  /** Re-invokes `fetcher` and moves `state` back to `loading`. */
  retry: () => void
}

/**
 * `fetcher`'s identity is not assumed stable across renders: it is read from a ref and called only
 * on mount and again on an explicit `retry()`, never because the calling component re-rendered with
 * a new closure (e.g. an inline arrow function passed as `fetcher`).
 */
export function useTileData<T>(fetcher: () => Promise<T>): UseTileDataResult<T> {
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  const [state, setState] = useState<TileDataState>('loading')
  const [data, setData] = useState<T | undefined>(undefined)
  const [error, setError] = useState<unknown>(undefined)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    setState('loading')
    setError(undefined)

    fetcherRef
      .current()
      .then((result) => {
        if (cancelled) return
        setData(result)
        setState('success')
      })
      .catch((caught: unknown) => {
        if (cancelled) return
        setError(caught)
        setState('error')
      })

    return () => {
      cancelled = true
    }
    // `attempt` is the only intentional trigger - see the doc comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])

  return { state, data, error, retry }
}
