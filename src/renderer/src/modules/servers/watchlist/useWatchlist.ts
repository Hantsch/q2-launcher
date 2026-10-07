import { useCallback } from 'react'
import type { Outcome } from '@shared/types'
import type {
  ScanStartResult,
  WatchlistMatchMode,
  WatchlistMutationResult,
  WatchlistSnapshot,
} from '@shared/modules/servers'
import {
  addWatchlistEntry,
  onWatchlistChanged,
  readWatchlist,
  recheckWatchlistEntry,
  removeWatchlistEntry,
  updateWatchlistEntry,
} from '../client'
import { useModuleQuery } from '../../../lib/useModuleQuery'

export interface UseWatchlistResult {
  snapshot: WatchlistSnapshot | null
  add: (input: {
    name: string
    mode: WatchlistMatchMode
  }) => Promise<Outcome<WatchlistMutationResult>>
  update: (input: {
    id: string
    name: string
    mode: WatchlistMatchMode
  }) => Promise<Outcome<WatchlistMutationResult>>
  remove: (id: string) => Promise<Outcome<WatchlistMutationResult>>
  recheck: (id: string) => Promise<Outcome<ScanStartResult>>
}

/**
 * Story 132. Mirrors `ServersView.tsx`'s own `readScan`/`onScanChanged` idiom: a one-shot read
 * on mount followed by a live subscription to the pushed snapshot (`watchlist.changed`) - nothing
 * here polls. `add`/`update`/`remove` additionally apply their own successful result's snapshot
 * immediately (not waiting for the round-trip event) so the caller's UI reflects its own edit
 * without a visible delay; a refused mutation (`{ ok: false, reasonKey }`) leaves the snapshot
 * untouched. `recheck` never touches the snapshot itself - it only triggers a re-check whose
 * result (if any) arrives later via `watchlist.changed`, same split as a scan's own
 * `scanStart`/`scan.changed`.
 */
export function useWatchlist(): UseWatchlistResult {
  const { data, setData } = useModuleQuery(readWatchlist, { subscribe: onWatchlistChanged })

  const applyMutationResult = useCallback(
    (result: Outcome<WatchlistMutationResult>): void => {
      if (result.ok && result.value.ok) setData(result.value.snapshot)
    },
    [setData],
  )

  const add = useCallback(
    async (input: {
      name: string
      mode: WatchlistMatchMode
    }): Promise<Outcome<WatchlistMutationResult>> => {
      const result = await addWatchlistEntry(input)
      applyMutationResult(result)
      return result
    },
    [applyMutationResult],
  )

  const update = useCallback(
    async (input: {
      id: string
      name: string
      mode: WatchlistMatchMode
    }): Promise<Outcome<WatchlistMutationResult>> => {
      const result = await updateWatchlistEntry(input)
      applyMutationResult(result)
      return result
    },
    [applyMutationResult],
  )

  const remove = useCallback(
    async (id: string): Promise<Outcome<WatchlistMutationResult>> => {
      const result = await removeWatchlistEntry(id)
      applyMutationResult(result)
      return result
    },
    [applyMutationResult],
  )

  const recheck = useCallback(async (id: string): Promise<Outcome<ScanStartResult>> => {
    return recheckWatchlistEntry(id)
  }, [])

  return { snapshot: data ?? null, add, update, remove, recheck }
}
