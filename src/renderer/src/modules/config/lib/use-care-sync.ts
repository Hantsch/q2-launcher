/**
 * Care tab, Files group data - story 058 D3.
 *
 * Pulled out of `CareSyncSection.tsx` (now deleted): owns the profile's sync-state fetch and the
 * four actions a Files row can offer (Retry / Reload / Compare / Open / Reveal), so `CareTab.tsx`
 * can render the group through the shared `CareItemRow` instead of a bespoke section component.
 *
 * Mirrors `CareSyncSection.tsx`'s (pre-058) `fetchSyncState`/`retry`/`handleReload`/`handleCompare`
 * almost verbatim - only the surface changed, from a section that renders every row itself to a
 * hook that exposes state plus one dispatcher (`runAction`) keyed off `CareItemAction.kind`, since
 * `CareItemRow` calls back with the action it was given rather than a named handler per kind.
 *
 * `pendingKeys` replaces the old `retrying`/`canonicalBusy` pair with one set keyed by
 * `CareItemAction.key` (`lib/care-items.ts`), because `CareItemRow` (shared with the Config health
 * and Tidy-up groups) only knows how to disable a button by that key - there is no longer a
 * dedicated "the canonical row is busy" flag to thread through a bespoke prop.
 */

import { useCallback, useEffect, useState } from 'react'
import type { ConfigProfile, SaveProfileConflict } from '@shared/modules/config'
import { useLauncher } from '../../../store/useLauncher'
import {
  getProfileSyncState,
  openProfileFile,
  refreshProfilesFromFiles,
  saveConfigProfile,
  writeConfigProfile,
} from '../client'
import type { CareItemAction } from './care-items'
import type { CareSyncStatus } from './care-summary'
import { toCareSyncRows } from './care-sync'
import { adoptProfileFromFile } from './file-source-refresh'
import { resolveSaveOutcome } from './save-bar'

export interface UseCareSyncResult {
  /** Story 025 D8's `CareSyncStatus` - `'loading'`/`'loaded'`/`'error'`, fed straight into
   * `buildCareItems`/`careSummary` by `CareTab.tsx`, same contract `CareSyncSection` used to hand
   * up through its `onStatusChange` prop. */
  status: CareSyncStatus
  /** Set when Compare hits a whole-file conflict - `CareTab.tsx` renders `ConfigConflictDialog`
   * from this, same as `CareSyncSection` did. */
  conflict: SaveProfileConflict | null
  /** Action keys currently in flight - `CareItemRow`'s own `pendingKeys` prop, unchanged shape. */
  pendingKeys: ReadonlySet<string>
  /** Dispatches one row's clicked action. `target` is that row's `CareItem.params['target']`
   * (`'canonical'` or an installation id) - needed for Open/Reveal, which the action alone does not
   * carry. */
  runAction: (action: CareItemAction, target: string) => void
  closeConflict: () => void
  /** `ConfigConflictDialog`'s `onResolved` - adopts the resolved profile and re-fetches so the row
   * reflects the file's real state rather than the stale one the dialog was opened from. */
  resolveConflict: (resolved: ConfigProfile) => void
}

export function useCareSync({
  profile,
  onProfileUpdated,
}: {
  profile: ConfigProfile
  /** Story 043 D9's single-profile merge-by-id callback - Reload and Compare's resolutions both
   * need it to propagate an adopted/overwritten profile to the rest of the UI. */
  onProfileUpdated: (profile: ConfigProfile) => void
}): UseCareSyncResult {
  const pushToast = useLauncher((state) => state.pushToast)

  const [status, setStatus] = useState<CareSyncStatus>({ kind: 'loading' })
  const [conflict, setConflict] = useState<SaveProfileConflict | null>(null)
  const [pendingKeys, setPendingKeys] = useState<ReadonlySet<string>>(new Set())

  const fetchSyncState = useCallback(
    async (guard?: { cancelled: boolean }): Promise<void> => {
      const outcome = await getProfileSyncState({ profileId: profile.id })
      if (guard?.cancelled) return
      setStatus(
        outcome.ok ? { kind: 'loaded', rows: toCareSyncRows(outcome.value) } : { kind: 'error' },
      )
    },
    [profile.id],
  )

  // Re-reads on a profile switch AND on a save (`updatedAt` bump), same idiom `CareSyncSection`
  // used (itself mirroring `RawFileTab`).
  useEffect(() => {
    const guard = { cancelled: false }
    setStatus({ kind: 'loading' })
    void fetchSyncState(guard)
    return () => {
      guard.cancelled = true
    }
    // profile.updatedAt is read only to trigger a re-fetch on save; fetchSyncState itself already
    // captures profile.id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchSyncState, profile.updatedAt])

  const withPending = useCallback(async (key: string, run: () => Promise<void>): Promise<void> => {
    setPendingKeys((prev) => new Set(prev).add(key))
    try {
      await run()
    } finally {
      setPendingKeys((prev) => {
        const next = new Set(prev)
        next.delete(key)
        return next
      })
    }
  }, [])

  /** `CareSyncSection`'s `retry`: re-runs the write pipeline for the whole profile (there is no
   * per-installation retry endpoint), then re-fetches so a success clears the row immediately. */
  const retry = async (): Promise<void> => {
    const outcome = await writeConfigProfile({ profileId: profile.id })
    if (outcome.ok) {
      await fetchSyncState()
    } else {
      pushToast({
        level: 'error',
        messageKey: outcome.error.key,
        timeoutMs: 0,
        ...(outcome.error.params ? { params: outcome.error.params } : {}),
      })
    }
  }

  /** `CareSyncSection`'s `handleReload`: adopts whatever is on disk right now through the shared
   * `adoptProfileFromFile` path, then re-fetches regardless of outcome so the row reflects the
   * file's real current state. */
  const reload = async (): Promise<void> => {
    const result = await adoptProfileFromFile({
      profileId: profile.id,
      refresh: refreshProfilesFromFiles,
      pushToast,
    })
    if (result.kind === 'failed') return
    if (result.kind === 'adopted') onProfileUpdated(result.profile)
    await fetchSyncState()
  }

  /** `CareSyncSection`'s `handleCompare`: an unforced save, purely to obtain the same
   * `SaveProfileConflict` payload `ConfigConflictDialog` already knows how to render. */
  const compare = async (): Promise<void> => {
    const outcome = await saveConfigProfile({ profileId: profile.id })
    const action = resolveSaveOutcome(outcome)
    if (action.type === 'saved') {
      onProfileUpdated(action.profile)
      await fetchSyncState()
      return
    }
    if (action.type === 'conflict') {
      setConflict(action.conflict)
      return
    }
    pushToast({
      level: 'error',
      messageKey: action.messageKey,
      timeoutMs: 0,
      ...(action.params ? { params: action.params } : {}),
    })
  }

  /** Story 057 D3's Open/Reveal, consolidated here per story 058 decision 6 - the exact
   * `openProfileFile` call `RawFileTab` already makes, addressed by id, never by a path. */
  const openOrReveal = async (target: string, mode: 'open' | 'reveal'): Promise<void> => {
    const outcome = await openProfileFile({
      profileId: profile.id,
      installationId: target === 'canonical' ? null : target,
      mode,
    })
    if (!outcome.ok) {
      pushToast({
        level: 'error',
        messageKey: outcome.error.key,
        timeoutMs: 0,
        ...(outcome.error.params ? { params: outcome.error.params } : {}),
      })
    }
  }

  const runAction = (action: CareItemAction, target: string): void => {
    void withPending(action.key, async () => {
      switch (action.kind) {
        case 'retry':
          await retry()
          return
        case 'reload':
          await reload()
          return
        case 'compare':
          await compare()
          return
        case 'open':
          await openOrReveal(target, 'open')
          return
        case 'reveal':
          await openOrReveal(target, 'reveal')
          return
        default:
          // No other action kind ever reaches a Files row (`lib/care-items.ts`'s `fileItems`).
          return
      }
    })
  }

  const closeConflict = (): void => setConflict(null)

  const resolveConflict = (resolved: ConfigProfile): void => {
    setConflict(null)
    onProfileUpdated(resolved)
    void fetchSyncState()
  }

  return { status, conflict, pendingKeys, runAction, closeConflict, resolveConflict }
}
