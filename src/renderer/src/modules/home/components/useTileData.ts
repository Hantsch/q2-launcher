import { useRef } from 'react'
import { ok } from '@shared/types'
import { useModuleQuery } from '../../../lib/useModuleQuery'

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
 * `fetcher`'s identity is not assumed stable across renders: it is called only on mount and again
 * on an explicit `retry()`. A thin alias of `useModuleQuery`; a rejection is kept as-is for `error`.
 */
export function useTileData<T>(fetcher: () => Promise<T>): UseTileDataResult<T> {
  const rejection = useRef<unknown>(undefined)
  const query = useModuleQuery<T>(async () => {
    try {
      const value = await fetcher()
      rejection.current = undefined
      return ok(value)
    } catch (caught) {
      rejection.current = caught
      return { ok: false, error: { key: 'ipc.error.unreachable' } }
    }
  })

  return {
    state: query.state,
    data: query.data,
    error: query.state === 'error' ? rejection.current : undefined,
    retry: query.reload,
  }
}
