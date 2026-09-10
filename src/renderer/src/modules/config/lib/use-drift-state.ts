import { useCallback, useEffect, useRef, useState } from 'react'
import { getProfileSyncState } from '../client'
import { toCareSyncRows } from './care-sync'
import type { CareSyncStatus } from './care-summary'

/**
 * Story 079 D6 (AC5): the profile's file-sync/drift rows, fetched on the same re-read triggers
 * `useFileSourceRefresh.ts` already re-reads the canonical file on (a profile becoming the selected
 * one - including switching to it from the profile list while `ConfigView` stays mounted - and
 * window focus regained), plus a save (`profile.updatedAt` bumping while the same profile stays
 * selected). Owned by `ConfigView.tsx`, not by `CareTab.tsx`/`use-care-sync.ts`, so a changed,
 * missing or stale installation copy is caught even while the Care tab has never been opened.
 *
 * Split out of `use-care-sync.ts`'s old `fetchSyncState` effect (story 025 D8, story 058 D3), which
 * only ever ran while `CareTab` itself was mounted - moving the fetch up here is what makes AC5 true;
 * `use-care-sync.ts` now just consumes `status`/`refetch` instead of owning either.
 *
 * `getProfileSyncState` is read-only - it never adopts a file's bytes onto the cached profile the way
 * `refreshFromFiles` (`useFileSourceRefresh.ts`'s `runRefresh`) can - so unlike that re-read, this
 * fetch is never gated on an open raw draft (`useRawDraft().active`): checking sync state cannot
 * destroy one the way adopting an external edit can.
 */
export interface UseDriftStateResult {
  /** `use-care-sync.ts`'s old `CareSyncStatus` shape, unchanged - `'loading'`/`'loaded'`/`'error'`. */
  status: CareSyncStatus
  /** Re-fetches for whichever profile is currently selected - a no-op while none is. Passed to
   * `useFileSourceRefresh` as `onAfterRefresh` (the mount/profile-open and focus triggers), and
   * called directly by `use-care-sync.ts` after an action that can change a row's state (retry,
   * reload, compare, resolving a conflict). */
  refetch: () => void
}

export function useDriftState(
  profileId: string | null,
  profileUpdatedAt: string | undefined,
): UseDriftStateResult {
  const [status, setStatus] = useState<CareSyncStatus>({ kind: 'loading' })
  /** Guards a stale response landing after a newer fetch (a profile switch, or an imperative
   * `refetch()`) has already started a fresher one - a monotonic counter rather than the old effect's
   * `{ cancelled: boolean }` closure, since fetches here are no longer only ever started from one
   * effect's own re-run. */
  const requestIdRef = useRef(0)

  const fetchFor = useCallback((id: string): void => {
    const requestId = ++requestIdRef.current
    setStatus({ kind: 'loading' })
    void getProfileSyncState({ profileId: id }).then((outcome) => {
      if (requestIdRef.current !== requestId) return
      setStatus(
        outcome.ok ? { kind: 'loaded', rows: toCareSyncRows(outcome.value) } : { kind: 'error' },
      )
    })
  }, [])

  // Fires on a profile switch/open (mirrors `useFileSourceRefresh`'s trigger 1 - both react to the
  // same `profileId` becoming selected) and on a save - the one drift-relevant change neither of that
  // hook's two triggers would ever see on their own, since neither focus nor a profile switch
  // necessarily happens at the moment a save lands.
  useEffect(() => {
    if (profileId) fetchFor(profileId)
    // profileUpdatedAt is read only to trigger this refetch; fetchFor itself already captures the id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId, profileUpdatedAt, fetchFor])

  const refetch = useCallback((): void => {
    if (profileId) fetchFor(profileId)
  }, [profileId, fetchFor])

  return { status, refetch }
}
