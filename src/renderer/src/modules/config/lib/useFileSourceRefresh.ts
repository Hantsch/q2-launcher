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
 * - **Config tab open**: `ConfigView`'s own mount - a plain `useEffect(fn, [])`. Deliberately not
 *   tied to `activeTab`/`screen` state, so switching between Settings/Controls/Raw File inside one
 *   profile's detail never re-triggers this (the story is explicit that it must not).
 * - **Window focus**: `chrome.focused` (`useWindowFocused`, already pushed by main through the
 *   existing `window:state` event) transitioning false -> true, per `didFocusResume`
 *   (`file-source-refresh.ts`) - never a DOM `focus` listener, which the story explicitly rules out.
 *
 * `profileId`/`onResult`/`isSuspended` are read through refs kept current every render, so the
 * focus-triggered effect always acts on whichever profile is selected *at the moment focus resumes*,
 * not whatever was selected when this hook first mounted.
 *
 * The pure decision logic behind it lives in `file-source-refresh.ts`, which IS tested on its own;
 * same split as `ProfileSaveBar.tsx` (untested, calls `client.ts`) and `lib/save-bar.ts` (tested,
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
}): void {
  const profileIdRef = useRef(params.profileId)
  const onResultRef = useRef(params.onResult)
  const isSuspendedRef = useRef(params.isSuspended)
  useEffect(() => {
    profileIdRef.current = params.profileId
    onResultRef.current = params.onResult
    isSuspendedRef.current = params.isSuspended
  }, [params.profileId, params.onResult, params.isSuspended])

  const runRefresh = (profileId: string): void => {
    if (isSuspendedRef.current()) return
    void refreshProfilesFromFiles({ profileId }).then((outcome) => {
      if (!outcome.ok) return
      for (const result of outcome.value) onResultRef.current(result)
    })
  }

  // Trigger 1: this view's own mount ("config tab open"). Empty deps on purpose - see doc comment.
  useEffect(() => {
    const profileId = profileIdRef.current
    if (profileId) runRefresh(profileId)
  }, [])

  // Trigger 2: window focus regained.
  const focused = useWindowFocused()
  const prevFocusedRef = useRef(focused)
  useEffect(() => {
    const prev = prevFocusedRef.current
    prevFocusedRef.current = focused
    if (!didFocusResume(prev, focused)) return
    const profileId = profileIdRef.current
    if (profileId) runRefresh(profileId)
  }, [focused])
}
