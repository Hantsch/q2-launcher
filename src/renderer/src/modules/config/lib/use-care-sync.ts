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
 *
 * Story 079 D6: this hook no longer owns the sync-state fetch itself. Its own fetch effect (keyed on
 * `profile.id`/`profile.updatedAt`) only ever ran while `CareTab` was mounted, which is exactly what
 * made AC5 ("drift is checked without the Care tab being open") false - a changed/missing/stale
 * installation copy went undetected until a user happened to open Care. The fetch moved up to
 * `ConfigView`'s `useDriftState` (`lib/use-drift-state.ts`), which runs for the whole detail view on
 * the canonical re-read triggers plus a save; `status`/`refetchSyncState` are now passed in from
 * there instead. `runAction`, conflict handling and the re-fetch-after-an-action idiom are unchanged
 * - only "fetch the rows" moved, not "what to do when a row's action is clicked".
 */

import { useState } from 'react'
import type { ConfigProfile, SaveProfileConflict } from '@shared/modules/config'
import { useLauncher } from '../../../store/useLauncher'
import { openProfileFile, refreshProfilesFromFiles, saveConfigProfile, writeConfigProfile } from '../client'
import type { CareItemAction } from './care-items'
import type { CareSyncStatus } from './care-summary'
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
  status,
  refetchSyncState,
}: {
  profile: ConfigProfile
  /** Story 043 D9's single-profile merge-by-id callback - Reload and Compare's resolutions both
   * need it to propagate an adopted/overwritten profile to the rest of the UI. */
  onProfileUpdated: (profile: ConfigProfile) => void
  /** Story 079 D6: the drift rows, fetched by `ConfigView`'s `useDriftState`, not by this hook - see
   * the file doc comment. */
  status: CareSyncStatus
  /** `useDriftState`'s `refetch`, called after an action that can change a row's state (retry,
   * reload, compare, resolving a conflict) - same call sites `fetchSyncState` used to be awaited
   * from, just no longer owned here. */
  refetchSyncState: () => void
}): UseCareSyncResult {
  const pushToast = useLauncher((state) => state.pushToast)

  const [conflict, setConflict] = useState<SaveProfileConflict | null>(null)
  const [pendingKeys, setPendingKeys] = useState<ReadonlySet<string>>(new Set())

  const withPending = async (key: string, run: () => Promise<void>): Promise<void> => {
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
  }

  /** `CareSyncSection`'s `retry`: re-runs the write pipeline for the whole profile (there is no
   * per-installation retry endpoint), then re-fetches so a success clears the row immediately. */
  const retry = async (): Promise<void> => {
    const outcome = await writeConfigProfile({ profileId: profile.id })
    if (outcome.ok) {
      refetchSyncState()
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
    refetchSyncState()
  }

  /** `CareSyncSection`'s `handleCompare`: an unforced save, purely to obtain the same
   * `SaveProfileConflict` payload `ConfigConflictDialog` already knows how to render. */
  const compare = async (): Promise<void> => {
    const outcome = await saveConfigProfile({ profileId: profile.id })
    const action = resolveSaveOutcome(outcome)
    if (action.type === 'saved') {
      onProfileUpdated(action.profile)
      refetchSyncState()
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

  /** Story 079 D9's "Sync now" (AC7): rewrites one installation's copy from the profile's canonical
   * file, restricted to `installationId` via `WriteProfileInput.installationId` (D8) - every other
   * installation this profile is assigned to is left untouched, and the write always comes from the
   * canonical file on disk, never from `profile`'s own possibly-dirty in-memory state (AC9,
   * unchanged from `retry` above, which already writes the whole profile the same way). Re-fetches
   * on success so the row clears immediately, same idiom as `retry`. */
  const syncNow = async (installationId: string): Promise<void> => {
    const outcome = await writeConfigProfile({ profileId: profile.id, installationId })
    if (outcome.ok) {
      refetchSyncState()
    } else {
      pushToast({
        level: 'error',
        messageKey: outcome.error.key,
        timeoutMs: 0,
        ...(outcome.error.params ? { params: outcome.error.params } : {}),
      })
    }
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
        case 'syncNow':
          await syncNow(target)
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
    refetchSyncState()
  }

  return { status, conflict, pendingKeys, runAction, closeConflict, resolveConflict }
}
