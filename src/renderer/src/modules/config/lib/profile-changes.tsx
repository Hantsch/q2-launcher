/**
 * The renderer-side handle onto story 049's change set (D4): a `ProfileChangeSet`
 * (`@shared/config/profile-diff`) computed once per selected profile and shared, through React
 * context, with every tab and the save bar - so the bar's badge, the before/after list (D5) and
 * every row's "unsaved" indicator (D7/D8) can never disagree about what is pending.
 *
 * Computed from the **server** profile (`ConfigView`'s `selected`, the same object
 * `isProfileDirty`/`ProfileSaveBar` already read), never from `useProfileDraft`'s locally patched
 * copy (story 049, Decisions) - the change set lags a save/discard round-trip exactly as much as the
 * existing dirty badge already does, which is the accepted cost of the three surfaces never
 * disagreeing.
 *
 * A `ProfileChangesContext` rather than prop-drilling through `ControlsTab` -> `ControlsRow` (story
 * 049, Decisions): the change set is cross-cutting row state that every leaf row needs, and drilling
 * it would touch every row component's signature for a concern none of the intermediate components
 * otherwise care about.
 */

import { createContext, useContext, useMemo, type ReactNode } from 'react'
import type { ConfigProfile } from '@shared/modules/config'
import { diffProfileAgainstBaseline, type ProfileChangeSet } from '@shared/config/profile-diff'

const ProfileChangesContext = createContext<ProfileChangeSet | null>(null)

/**
 * Provides the memoised change set for `profile` to every descendant. Recomputed only when the
 * `profile` object *reference* changes (`useMemo`'s dependency array), not on every render of the
 * surrounding view and never on deep equality - a new `profiles` array replacing the same logical
 * profile with an equal-but-different object is exactly the case that must recompute, since it is
 * how every mutation (save, discard, an adopted external edit) reaches the renderer.
 *
 * Mount this only where a selected profile exists (`ConfigView`'s `selected && (...)` block) - there
 * is no "no profile" case to support here, matching how `ProfileSaveBar` is already scoped in that
 * file.
 */
export function ProfileChangesProvider(props: { profile: ConfigProfile; children: ReactNode }) {
  const changes = useMemo(() => diffProfileAgainstBaseline(props.profile), [props.profile])

  return (
    <ProfileChangesContext.Provider value={changes}>
      {props.children}
    </ProfileChangesContext.Provider>
  )
}

/**
 * The current profile's pending change set. Every consumer (save bar, cvar rows, controls rows,
 * layers, Raw File notice) reads through this hook rather than importing `diffProfileAgainstBaseline`
 * itself, so there is exactly one computation per profile, not one per row.
 *
 * Throws outside a `ProfileChangesProvider` rather than returning a silent empty set - there is no
 * legitimate reason for a consumer of this hook to render outside the provider (it is mounted
 * everywhere a change set is meaningful), so a missing provider is a wiring bug that should fail
 * loudly in development rather than quietly show "nothing pending".
 */
export function useProfileChanges(): ProfileChangeSet {
  const changes = useContext(ProfileChangesContext)
  if (!changes) {
    throw new Error('useProfileChanges must be used within a ProfileChangesProvider')
  }
  return changes
}
