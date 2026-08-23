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
 * `profileId`/`onResult` are read through refs kept current every render, so the focus-triggered
 * effect always acts on whichever profile is selected *at the moment focus resumes*, not whatever
 * was selected when this hook first mounted.
 *
 * Deliberately not unit-tested itself - it is a thin IO wrapper (calls `refreshProfilesFromFiles`,
 * subscribes to the store) around the pure decision logic in `file-source-refresh.ts`, which IS
 * tested; same split as `ProfileSaveBar.tsx` (untested, calls `client.ts`) and `lib/save-bar.ts`
 * (tested, pure).
 */
export function useFileSourceRefresh(params: {
  profileId: string | null
  onResult: (result: RefreshedProfileResult) => void
}): void {
  const profileIdRef = useRef(params.profileId)
  const onResultRef = useRef(params.onResult)
  useEffect(() => {
    profileIdRef.current = params.profileId
    onResultRef.current = params.onResult
  }, [params.profileId, params.onResult])

  const runRefresh = (profileId: string): void => {
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
