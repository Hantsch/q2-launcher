import type { ConfigProfile } from '@shared/modules/config'
import type { ProfileChangeSet } from '@shared/config/profile-diff'
import { useProfileChanges } from './profile-changes'
import { useRawDraft } from './raw-draft'
import { isProfileDirty } from './save-bar'

/**
 * The one "is there anything unsaved, and how much" read the detail screen's three unsaved
 * surfaces share: the indicator next to the profile name, the Save/Discard pair in the header row
 * and the Unsaved tab (with its own count badge). Previously all three were one component
 * (`ProfileSaveBar`, stories 043/049/057) sitting in its own row above the tabs; splitting that row
 * up meant the parts had to agree without being siblings, so the derivation lives here rather than
 * being repeated three times.
 *
 * Both sources of truth are the existing ones, unchanged: `profile.dirty` from the server profile
 * (`isProfileDirty`) and the renderer-local raw-text draft (`useRawDraft`). A raw draft still takes
 * precedence wherever the two could both read true (`lib/raw-draft.tsx` explains why): the typed
 * text is the only thing here that exists nowhere else, so it is what Save and Discard must act on.
 */
export interface UnsavedState {
  /** Structured unsaved changes are pending (and no raw draft is shadowing them). */
  dirty: boolean
  /** A typed-but-unsaved raw file text draft is pending. */
  rawEdited: boolean
  /** Either of the two - what the indicator, the header actions and the tab all gate on. */
  unsaved: boolean
  /**
   * What the tab badge shows: the structured change count, or `1` for a raw draft - that draft is
   * exactly one change (a whole file's text), which is why the tab names it instead of listing it.
   */
  badgeCount: number
  changeSet: ProfileChangeSet
}

export function useUnsavedState(profile: Pick<ConfigProfile, 'dirty'>): UnsavedState {
  const changeSet = useProfileChanges()
  const rawDraft = useRawDraft()

  const rawEdited = rawDraft.active
  const dirty = isProfileDirty(profile) && !rawEdited

  return {
    dirty,
    rawEdited,
    unsaved: dirty || rawEdited,
    badgeCount: rawEdited ? 1 : changeSet.count,
    changeSet,
  }
}
