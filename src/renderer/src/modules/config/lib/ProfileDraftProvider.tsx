import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react'
import type { ConfigProfile } from '@shared/modules/config'
import type { Installation } from '@shared/types'
import { useLauncher } from '../../../store/useLauncher'
import { useConfigProfiles } from '../config-profiles-store'
import { useProfileDraft, type UseProfileDraftResult } from './useProfileDraft'

export interface ProfileDraftContextValue {
  /** The selected profile as main last returned it. */
  profile: ConfigProfile
  /** The in-progress copy edits write into; never null, it falls back to `profile`. */
  draft: ConfigProfile
  patch: UseProfileDraftResult['patch']
  resetDraft: UseProfileDraftResult['resetDraft']
  installations: Installation[]
  /**
   * Where a confirmed save lands: a full list replaces the store, one profile is folded in by id.
   * Debouncing and status stay with each surface's own `useProfileSave`.
   */
  save: (updated: ConfigProfile[] | ConfigProfile) => void
}

const ProfileDraftContext = createContext<ProfileDraftContextValue | null>(null)

/**
 * Owns the one `useProfileDraft` for the open profile so every tab edits and reads the same draft.
 * `draft` lags `profile` by one render after a profile switch (the hook reseeds in an effect), which
 * `draft ?? profile` hides from consumers (story 218).
 */
export function ProfileDraftProvider(props: { profile: ConfigProfile; children: ReactNode }) {
  const { profile } = props
  const { draft, patch, resetDraft } = useProfileDraft(profile)
  const installations = useLauncher((state) => state.installations)
  const replaceAll = useConfigProfiles((s) => s.replaceAll)
  const upsert = useConfigProfiles((s) => s.upsert)

  const save = useCallback(
    (updated: ConfigProfile[] | ConfigProfile): void => {
      if (Array.isArray(updated)) replaceAll(updated)
      else upsert(updated)
    },
    [replaceAll, upsert],
  )

  const value = useMemo<ProfileDraftContextValue>(
    () => ({ profile, draft: draft ?? profile, patch, resetDraft, installations, save }),
    [profile, draft, patch, resetDraft, installations, save],
  )

  return <ProfileDraftContext.Provider value={value}>{props.children}</ProfileDraftContext.Provider>
}

/** Throws outside the provider: a missing one is a wiring bug, not an empty draft. */
export function useProfileDraftContext(): ProfileDraftContextValue {
  const value = useContext(ProfileDraftContext)
  if (!value) throw new Error('useProfileDraftContext must be used within a ProfileDraftProvider')
  return value
}
