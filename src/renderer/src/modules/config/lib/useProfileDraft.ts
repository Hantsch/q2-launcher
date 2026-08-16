import { useEffect, useState } from 'react'
import type { ConfigProfile } from '@shared/modules/config'

/**
 * Fields this hook ever hands out through `patch()` ahead of their own
 * debounced save landing - `SettingsTab`'s cvars, `AdvancedTab`'s categories
 * and actions. Every other field (assignments, layers, binds, name, ...) is
 * never locally patched by anything, so it is always safe - and, per the
 * review finding below, necessary - to take those straight from the freshest
 * known `profile`.
 */
const LOCALLY_PATCHED_FIELDS = ['cvars', 'categories', 'actions'] as const

/**
 * The draft `useProfileDraft` should hold once a new `profile` reference
 * arrives, given the previous draft. Exported and pure so the reseed/merge
 * decision - the exact thing a review caught wrong on the first pass (a
 * whole-profile draft that only reseeds on `profile.id` change silently goes
 * stale for every edit made outside `SettingsTab`/`AdvancedTab`) - is
 * unit-testable without rendering a component.
 *
 * - No previous draft, or a different `id` (a profile switch): the fresh
 *   `profile` wins outright, same reseed timing the removed per-tab local
 *   states used.
 * - Same `id`, a new `profile` reference (an external save landing -
 *   `ProfileAssignmentsPanel`, `LayersPanel`, `OverviewKeyboardPanel`'s
 *   `KeyBindDialog`, `RenameProfileDialog`, ... none of which ever call
 *   `patch()`): every field is taken from the fresh `profile` EXCEPT
 *   `LOCALLY_PATCHED_FIELDS`, which stay whatever the previous draft had.
 *   Those three fields are only ever written by `patch()` ahead of a
 *   debounced save that will itself land here as the same values once it
 *   resolves - taking them from `profile` too would risk clobbering a
 *   keystroke that arrived while that save was still in flight, the exact
 *   race the pre-story-009 `SettingsTab`/`AdvancedTab` code avoided by never
 *   reseeding except on remount.
 */
export function mergeProfileUpdate(
  prev: ConfigProfile | null,
  profile: ConfigProfile | null,
): ConfigProfile | null {
  if (!profile) return null
  if (!prev || prev.id !== profile.id) return profile

  const merged: ConfigProfile = { ...profile }
  for (const field of LOCALLY_PATCHED_FIELDS) {
    ;(merged as unknown as Record<string, unknown>)[field] = prev[field]
  }
  return merged
}

export interface UseProfileDraftResult {
  /** `profile`'s in-progress content - what every tab reads from and writes into. */
  draft: ConfigProfile | null
  /**
   * Merges into the draft immediately - either a partial object, or a
   * function of the current draft for a caller that has to read-then-write
   * atomically (mirrors `useState`'s own functional-updater form, which is
   * what the removed per-tab `useState`s relied on to stay correct against
   * two edits landing in one tick).
   */
  patch: (partial: Partial<ConfigProfile> | ((prev: ConfigProfile) => Partial<ConfigProfile>)) => void
}

/**
 * Holds `profile`'s in-progress, not-yet-necessarily-saved content — story
 * 009 D6.
 *
 * Before this story, `SettingsTab` (cvars) and `AdvancedTab` (categories +
 * actions) each kept their own local `useState`, entirely invisible outside
 * that one component. `ValidationPanel` needs to see the exact thing the user
 * is looking at, not whichever version last made a debounced round trip to
 * main, so the in-progress value is lifted up here, into `ConfigView`, and
 * every tab that edits the profile writes into this one shared draft instead
 * of a component-local copy.
 *
 * This hook owns none of the *saving* — every tab keeps its own save path,
 * debounce and status label exactly as before (see `SettingsTab`'s
 * `scheduleSave`, `AdvancedTab`'s `scheduleActionsSave`/
 * `persistCategoriesAndActions`). It only owns the shared "what does the
 * profile look like right now" value they all read and write.
 *
 * Reconciled against `profile` on every reference change via
 * `mergeProfileUpdate` (see its own doc comment for the full reasoning) -
 * NOT gated on `profile.id` alone. An earlier version of this hook only
 * reseeded on `id` change, which silently went stale for every edit made by
 * a sibling component that saves immediately and never calls `patch()`
 * (layers, binds, assignments, rename) - exactly the bug a review caught.
 */
export function useProfileDraft(profile: ConfigProfile | null): UseProfileDraftResult {
  const [draft, setDraft] = useState<ConfigProfile | null>(profile)

  useEffect(() => {
    setDraft((prev) => mergeProfileUpdate(prev, profile))
  }, [profile])

  const patch = (
    partial: Partial<ConfigProfile> | ((prev: ConfigProfile) => Partial<ConfigProfile>),
  ): void => {
    setDraft((prev) => (prev ? { ...prev, ...(typeof partial === 'function' ? partial(prev) : partial) } : prev))
  }

  return { draft, patch }
}
