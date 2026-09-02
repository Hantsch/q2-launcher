import { useEffect, useRef, useState } from 'react'
import type { ConfigProfile } from '@shared/modules/config'

/**
 * Fields this hook ever hands out through `patch()` ahead of their own
 * debounced save landing - `SettingsTab`'s cvars, `ControlsTab`'s categories
 * and actions. Every other field (assignments, layers, binds, name, ...) is
 * never locally patched by anything, so it is always safe - and, per the
 * review finding below, necessary - to take those straight from the freshest
 * known `profile`.
 */
const LOCALLY_PATCHED_FIELDS = ['cvars', 'categories', 'actions'] as const

export type LocallyPatchedField = (typeof LOCALLY_PATCHED_FIELDS)[number]

/** Deep value equality for the three locally-patched fields - plain JSON data (maps and arrays of
 * plain objects), so a stringify comparison is exact rather than approximate. Order-sensitive on
 * purpose: `setActions` round-trips the array in the order it was sent (story 019 D3), so a
 * reordering *is* a difference. */
function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

/**
 * The draft `useProfileDraft` should hold once a new `profile` reference
 * arrives, given the previous draft and which locally-patched fields still have
 * an edit in flight.
 *
 * Exported and pure so the reseed/merge decision - the exact thing a review
 * caught wrong on the first pass (a whole-profile draft that only reseeds on
 * `profile.id` change silently goes stale for every edit made outside
 * `SettingsTab`/`ControlsTab`) - is unit-testable without rendering a component.
 *
 * - No previous draft, or a different `id` (a profile switch): the fresh
 *   `profile` wins outright, same reseed timing the removed per-tab local
 *   states used.
 * - Same `id`, a new `profile` reference: every field is taken from the fresh
 *   `profile` EXCEPT the ones listed in `dirty`, which stay whatever the
 *   previous draft had - those are edits `patch()` applied ahead of a debounced
 *   save that has not landed yet, and taking them from `profile` would clobber a
 *   keystroke, the exact race the pre-story-009 per-tab local states avoided by
 *   never reseeding.
 *
 * Story 034 is what made `dirty` a parameter instead of "always these three
 * fields": `actions` is no longer written by `ControlsTab` alone. Main adopts a
 * raw catalogue bind into an action on every write (`bind-adoption.ts`), so a
 * bind saved from the Overview keyboard now legitimately *changes* `actions`
 * from outside this draft - and freezing the field unconditionally would keep
 * the Controls grid showing "empty" for a key the keyboard has just bound,
 * which is the very discrepancy that story removes.
 */
export function mergeProfileUpdate(
  prev: ConfigProfile | null,
  profile: ConfigProfile | null,
  dirty: ReadonlySet<LocallyPatchedField> = new Set(LOCALLY_PATCHED_FIELDS),
): ConfigProfile | null {
  if (!profile) return null
  if (!prev || prev.id !== profile.id) return profile

  const merged: ConfigProfile = { ...profile }
  for (const field of LOCALLY_PATCHED_FIELDS) {
    if (!dirty.has(field)) continue
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
  /**
   * Story 048 D6: a snapshot of `profile.cvars` taken the last time the profile was known to have
   * no pending cvar edits - "edited" (`isEdited` in `cvar-rows.ts`) means "differs from this",
   * never "differs from the catalogue default". Deliberately an interim, cvar-scoped baseline (a
   * later story widens it to the whole profile) - see this hook's own doc comment for the seeding
   * rules.
   */
  savedCvars: Record<string, string>
}

/**
 * Holds `profile`'s in-progress, not-yet-necessarily-saved content — story
 * 009 D6.
 *
 * Before this story, `SettingsTab` (cvars) and `ControlsTab` (categories +
 * actions) each kept their own local `useState`, entirely invisible outside
 * that one component. `ValidationPanel` needs to see the exact thing the user
 * is looking at, not whichever version last made a debounced round trip to
 * main, so the in-progress value is lifted up here, into `ConfigView`, and
 * every tab that edits the profile writes into this one shared draft instead
 * of a component-local copy.
 *
 * This hook owns none of the *saving* — every tab keeps its own save path,
 * debounce and status label exactly as before (see `SettingsTab`'s
 * `scheduleSave`, `ControlsTab`'s `scheduleActionsSave`/
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
  /**
   * The draft as the callbacks below see it, so `patch()` can read-then-write
   * synchronously (two edits in one tick both see the newer value) and the
   * reconcile effect can compare the incoming profile against it without
   * running a side effect inside a `setState` updater.
   */
  const draftRef = useRef<ConfigProfile | null>(profile)
  /**
   * Which locally-patched fields have an edit that has not come back from main
   * yet. Set by `patch()`, cleared as soon as an incoming profile carries the
   * same value (i.e. that save landed) - see `mergeProfileUpdate`'s doc comment
   * for why this is tracked at all rather than freezing the three fields
   * unconditionally.
   */
  const dirtyRef = useRef<Set<LocallyPatchedField>>(new Set())

  /**
   * Story 048 D6's "edited" baseline - see `UseProfileDraftResult.savedCvars`'s doc comment for
   * what it means. Seeded from whatever `profile` this hook is first handed, which is exactly
   * "the current cvars at this moment" for a profile that just arrived (there is no other draft
   * yet to disagree with it) - so a profile that loads already `dirty: true` still starts every row
   * unedited, per the sprint decision that a pre-existing, unsaved difference must not retroactively
   * light up as "just edited".
   */
  const [savedCvars, setSavedCvars] = useState<Record<string, string>>(profile?.cvars ?? {})

  useEffect(() => {
    const prev = draftRef.current
    const isNewProfile = !profile || !prev || prev.id !== profile.id
    if (isNewProfile) {
      dirtyRef.current = new Set()
    } else {
      for (const field of [...dirtyRef.current]) {
        if (sameValue(prev[field], profile[field])) dirtyRef.current.delete(field)
      }
    }
    const merged = mergeProfileUpdate(prev, profile, dirtyRef.current)
    draftRef.current = merged
    setDraft(merged)

    // Baseline reseed. Three cases:
    // - No profile at all (selection cleared): nothing to compare against.
    // - A fresh profile (switch, or the very first one this hook ever saw): the baseline is
    //   exactly its own `cvars` - `merged` above equals `profile` in this branch too, so there is
    //   no local edit this could be discarding.
    // - The same profile, and it now reads as not dirty (`dirty !== true`, the `false`/`undefined`
    //   convention `main/modules/config` already uses elsewhere): a save just landed, or an
    //   external reload replaced the cache outright - either way "what is saved" moved, so the
    //   baseline resets to it and every previously-edited row's marker clears.
    // Anything else (same profile, still `dirty: true`) is a same-id update to a field *other*
    // than cvars (categories/actions/name/...) - the baseline is left exactly as it was.
    if (!profile) {
      setSavedCvars({})
    } else if (isNewProfile || profile.dirty !== true) {
      setSavedCvars(profile.cvars)
    }
  }, [profile])

  const patch = (
    partial: Partial<ConfigProfile> | ((prev: ConfigProfile) => Partial<ConfigProfile>),
  ): void => {
    const prev = draftRef.current
    if (!prev) return
    const delta = typeof partial === 'function' ? partial(prev) : partial
    for (const field of LOCALLY_PATCHED_FIELDS) {
      if (field in delta) dirtyRef.current.add(field)
    }
    const next = { ...prev, ...delta }
    draftRef.current = next
    setDraft(next)
  }

  return { draft, patch, savedCvars }
}
