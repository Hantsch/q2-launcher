import { useEffect, useRef } from 'react'
import type { RefreshedProfileResult } from '@shared/modules/config'
import { useWindowFocused } from '../../../store/useLauncher'
import { refreshProfilesFromFiles } from '../client'
import { didFocusResume } from './file-source-refresh'

/**
 * The two triggers story 043 decided on (window focus regained, config tab open) for re-reading the
 * SELECTED profile's canonical file - never the whole list ("Decided during refine": reading every
 * profile's file on every focus event would make focus latency scale with the profile count). Both
 * are no-ops while `profileId` is null (the list screen, nothing selected).
 *
 * - **Config tab open**: a profile becoming the selected one - depends on `params.profileId` itself
 *   (story 079 D6 review fix: this used to be a plain `useEffect(fn, [])`, which only ever fired once
 *   for whatever profile happened to be selected at that exact instant - always `null`, since the
 *   view always lands on the profile list first. That meant "leave to Library and re-enter Config"
 *   re-read nothing at all; depending on `profileId` is what makes opening/switching to a profile
 *   re-fire it, while switching `activeTab`/`screen` - neither of which this dependency array knows
 *   anything about - still never does, exactly as the story requires).
 * - **Window focus**: `chrome.focused` (`useWindowFocused`, already pushed by main through the
 *   existing `window:state` event) transitioning false -> true, per `didFocusResume`
 *   (`file-source-refresh.ts`) - never a DOM `focus` listener, which the story explicitly rules out.
 *
 * `onResult`/`isSuspended`/`onAfterRefresh` are read through refs kept current every render, so the
 * focus-triggered effect always acts on whichever profile is selected *at the moment focus resumes*,
 * not whatever was selected when this hook last rendered.
 *
 * The pure decision logic behind it lives in `file-source-refresh.ts`, which IS tested on its own;
 * same split as `ProfileSaveActions.tsx` (untested, calls `client.ts`) and `lib/save-bar.ts` (tested,
 * pure). Its own wiring - which of the two triggers actually reaches `refreshProfilesFromFiles`, and
 * when `isSuspended` stops one - is covered by `useFileSourceRefresh.test.ts` under jsdom, because
 * that wiring is exactly where a silent-edit-loss bug hid once (see `isSuspended` below).
 */
export function useFileSourceRefresh(params: {
  profileId: string | null
  /**
   * Review fix (story 057): "would re-reading the file right now destroy something the user cannot
   * get back?", asked at the moment a trigger fires rather than passed as a value, so a draft
   * started *after* this hook last rendered still counts.
   *
   * Today there is exactly one such thing: an open raw draft (`lib/raw-draft.tsx`). Adopting the disk
   * version rebases the profile's `fileHash` (main's `refreshFromFiles`), which then makes the next
   * raw save's conflict guard read an external edit as "unchanged" and overwrite it without ever
   * showing the conflict dialog. A profile with structured unsaved changes is already protected by
   * main's own `dirty` branch; a draft deliberately never sets `dirty`, so it is protected here.
   *
   * Required, not optional: a call site that forgets this loses a user's file edit silently, which is
   * not a failure worth making easy to opt into.
   */
  isSuspended: () => boolean
  onResult: (result: RefreshedProfileResult) => void
  /**
   * Story 079 D6 (AC5): called once per trigger firing, right after `runRefresh` - regardless of
   * whether the refresh itself actually ran (`isSuspended` still suppresses `runRefresh`, never
   * this). `ConfigView` wires its `useDriftState` hook's `refetch` here so a changed, missing or
   * stale installation copy is checked on the exact same two triggers this hook already re-reads the
   * canonical file on, not only while the Care tab happens to be open. Unlike `runRefresh`, never
   * suppressed by `isSuspended`: `getProfileSyncState` is read-only, so checking sync state cannot
   * destroy an open raw draft the way adopting a file's bytes can.
   */
  onAfterRefresh?: (profileId: string) => void
}): void {
  const onResultRef = useRef(params.onResult)
  const isSuspendedRef = useRef(params.isSuspended)
  const onAfterRefreshRef = useRef(params.onAfterRefresh)
  const profileIdRef = useRef(params.profileId)
  useEffect(() => {
    onResultRef.current = params.onResult
    isSuspendedRef.current = params.isSuspended
    onAfterRefreshRef.current = params.onAfterRefresh
    profileIdRef.current = params.profileId
  }, [params.profileId, params.onResult, params.isSuspended, params.onAfterRefresh])

  const runRefresh = (profileId: string): void => {
    if (isSuspendedRef.current()) return
    void refreshProfilesFromFiles({ profileId }).then((outcome) => {
      if (!outcome.ok) return
      for (const result of outcome.value) onResultRef.current(result)
    })
  }

  // Trigger 1: the selected profile changing - see the doc comment above for why this depends on
  // `params.profileId` directly rather than mounting once.
  useEffect(() => {
    if (params.profileId) {
      runRefresh(params.profileId)
      onAfterRefreshRef.current?.(params.profileId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.profileId])

  // Trigger 2: window focus regained.
  const focused = useWindowFocused()
  const prevFocusedRef = useRef(focused)
  useEffect(() => {
    const prev = prevFocusedRef.current
    prevFocusedRef.current = focused
    if (!didFocusResume(prev, focused)) return
    const profileId = profileIdRef.current
    if (profileId) {
      runRefresh(profileId)
      onAfterRefreshRef.current?.(profileId)
    }
  }, [focused])
}
