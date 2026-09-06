/**
 * Story 057 D5: the renderer-local raw-text draft - what the Raw file tab's editor currently holds
 * that is not on disk yet - shared through React context the same way `ProfileChangesProvider`
 * (`lib/profile-changes.tsx`) shares the structured `ProfileChangeSet`, and mounted right next to it
 * in `ConfigView`.
 *
 * Deliberately NOT part of `ProfileChangeSet` (story Decisions): that set is a diff of *server
 * truth* (`profile` vs `profile.baseline`), computed in `@shared`, and a string a user is halfway
 * through typing has no place in it. So the detail screen has exactly two possible sources of
 * "unsaved", and this file is the second one.
 *
 * The two are mutually exclusive by construction, not by convention (AC7 - "the two never
 * coexist"):
 *
 *  - `rawEditingMode` refuses `'editable'` while the profile carries structured unsaved changes, so
 *    no draft can be started on top of a `dirty` profile. `setText` applies the same rule itself, so
 *    the guarantee does not depend on the one call site in `RawFileTab` remembering to.
 *  - While a draft *is* active, `ConfigView` marks the other tabs' content `inert`, so no structured
 *    change can be started on top of a draft either.
 *  - Should the two ever meet anyway (main adopting an external edit under an open draft, say), the
 *    draft wins: it is text a human typed and nothing else in the app can reproduce it, whereas the
 *    structured edits are still safely in the profile record.
 *
 * The draft is a single slot scoped by profile id, not a map: only one profile's detail screen is on
 * screen at a time, and a draft belonging to a different profile reads as absent (`active` below)
 * rather than leaking one profile's text into another's save bar.
 */

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type {
  ConfigProfile,
  SaveProfileConflict,
  SaveRawTextResult,
  SaveRawTextSaved,
  UnrecognizedConfigLine,
} from '@shared/modules/config'
import type { Outcome } from '@shared/types'
import { useLauncher } from '../../../store/useLauncher'
import { ConfigConflictDialog } from '../ConfigConflictDialog'
import { saveConfigProfileRawText } from '../client'
import { isProfileDirty } from './save-bar'

/**
 * Why the raw editor is or is not typable right now - derived in one pure function so the tab's
 * rendering, its hint line and this context's own `setText` guard can never disagree about it.
 *
 * - `'noFile'`: the canonical file has never been written, so there is no text to edit and no
 *   baseline for the conflict guard to compare against (story Decisions).
 * - `'lockedByChanges'`: the profile has structured unsaved changes; those have to be saved or
 *   discarded first (the user-facing half of AC7).
 * - `'editable'`: typing is allowed. Note the deliberate asymmetry: a profile that went `dirty`
 *   *while* a draft was already open stays editable, because dropping the typed text would be the
 *   silent edit loss this whole context exists to prevent.
 */
export type RawEditingMode = 'editable' | 'lockedByChanges' | 'noFile'

export function rawEditingMode(input: {
  onDisk: boolean
  profileDirty: boolean
  draftActive: boolean
}): RawEditingMode {
  if (!input.onDisk) return 'noFile'
  if (input.draftActive) return 'editable'
  return input.profileDirty ? 'lockedByChanges' : 'editable'
}

/**
 * Line endings, normalized to `\n`, for the "is this still the file's own text?" comparison only -
 * never for what gets written. A `<textarea>`'s API value always reports `\n` (the HTML spec
 * normalizes it), so a file that happens to sit on disk with CRLF would otherwise read as edited
 * the instant the user typed one character anywhere and then undid it.
 */
export function normalizeRawText(text: string): string {
  return text.replace(/\r\n?/g, '\n')
}

/** True when `text` differs from the file text it was seeded from - the one definition of "there is
 * a raw draft", used by `setText` and unit-tested on its own. */
export function isRawDraftDirty(text: string, baseline: string): boolean {
  return normalizeRawText(text) !== normalizeRawText(baseline)
}

/** What `RawDraftProvider` should do once a `saveConfigProfileRawText` call settles - the raw twin
 * of `resolveSaveOutcome` (`lib/save-bar.ts`), and pure for the same reason. */
export type RawSaveAction =
  | { type: 'saved'; result: SaveRawTextSaved }
  | { type: 'conflict'; conflict: SaveProfileConflict }
  | { type: 'toast'; messageKey: string; params?: Record<string, string | number> }

/**
 * Turns a `saveConfigProfileRawText` outcome into exactly one action.
 *
 * The transport-level `Outcome` failing covers both "profile not found" and D4's two *content*
 * rejections (`config.error.rawTextNotOwned`, `config.error.rawTextNotLatin1`) - all of them keep
 * the draft exactly as it was, since nothing on this branch clears it. `'unreadable'` reuses the
 * structured save bar's own two message keys rather than declaring look-alikes: the situation on
 * disk is identical, only the caller differs.
 */
export function resolveRawSaveOutcome(outcome: Outcome<SaveRawTextResult>): RawSaveAction {
  if (!outcome.ok) {
    return {
      type: 'toast',
      messageKey: outcome.error.key,
      ...(outcome.error.params ? { params: outcome.error.params } : {}),
    }
  }

  const result = outcome.value
  if (result.status === 'saved') return { type: 'saved', result }
  if (result.status === 'conflict') return { type: 'conflict', conflict: result }

  return {
    type: 'toast',
    messageKey:
      result.reason === 'unparseable'
        ? 'config.save.unreadableUnparseable'
        : 'config.save.unreadableReadError',
    params: { message: result.message },
  }
}

/**
 * What the last raw save's read-back reported. Kept here (rather than in `RawFileTab`'s local state)
 * so it survives the tab's own re-fetch of the freshly written file, and so story 057 D6's inline
 * result panel has one place to read it from - this context is that panel's only data source; D5
 * itself renders nothing from it.
 */
export interface RawSaveReadBack {
  fileName: string
  path: string
  droppedAliases: string[]
  preservedLines: UnrecognizedConfigLine[]
}

export interface RawDraftHandle {
  /** A draft for *this* profile exists and is what a Save would write. */
  active: boolean
  /** The typed text, or `null` when there is no draft. */
  text: string | null
  saving: boolean
  /** The last raw save's read-back result, cleared as soon as a new draft is started (D6). */
  lastResult: RawSaveReadBack | null
  /**
   * Bumped whenever the draft is dropped or adopted. `RawFileTab` folds it into the editor's React
   * `key`: `ConfigCodeView`'s editable mode seeds its `<textarea>` from `text` exactly once (story
   * 057 D1's own doc comment says a caller that needs a reset should remount), so this is what makes
   * Discard actually clear the visible text rather than only the context's copy of it.
   */
  resetToken: number
  /**
   * Records the editor's current text against the file text it was seeded from. Typing back to the
   * original text ends the draft rather than leaving a no-op "unsaved change" on the save bar.
   * Ignored entirely while the profile has structured unsaved changes (see `rawEditingMode`).
   */
  setText: (text: string, baseline: string) => void
  /** Throws the typed text away. Writes nothing, touches no file. */
  discard: () => void
  /** Writes the typed text through `config:saveRawText` (D4). Shared verbatim by the save bar's
   * Save button and the editor's Ctrl+S - there is exactly one save path for a raw draft. */
  save: () => void
}

const RawDraftContext = createContext<RawDraftHandle | null>(null)

interface DraftState {
  profileId: string
  text: string
}

/**
 * Owns the draft for `profile` and the conflict dialog a raw save can open.
 *
 * The dialog is mounted *here*, not in `ProfileSaveBar`, precisely because a raw save has two
 * triggers (the bar's Save button and Ctrl+S in the editor) - mounting it at the one place that
 * performs the save keeps a conflict from depending on which of the two the user reached for.
 * `ConfigConflictDialog`'s "Overwrite with my version" is redirected through `onOverwrite` so it
 * force-saves *the typed text* (D4's `force`) instead of the cached profile's render; its "Take the
 * file" keeps its own meaning and, since it adopts whatever is on disk, drops the draft with it.
 *
 * `onSaved` is `ConfigView`'s existing single-profile merge (`handleProfileUpdated`), the same one
 * `ProfileSaveBar` already gets - a raw save produces an ordinary updated profile, not a new shape.
 */
export function RawDraftProvider({
  profile,
  onSaved,
  onActiveChange,
  children,
}: {
  profile: ConfigProfile
  onSaved: (profile: ConfigProfile) => void
  /**
   * Review fix (story 057): the one way `active` reaches a consumer that cannot read the context
   * because it sits *above* this provider - `ConfigView`'s `useFileSourceRefresh` (story 043 D7),
   * which must not re-read the file from disk while a draft is open. Every other consumer
   * (`ProfileSaveBar`, `RawFileTab`, `StructuredTabsGuard`, `RenameHeaderButton`) renders below and
   * reads `useRawDraft()` instead; nothing else should reach for this.
   *
   * Why that matters, and why it is `active` rather than a new flag: a raw draft deliberately never
   * sets `profile.dirty` (see this file's header), so the focus-resume re-read - which adopts the
   * on-disk version and rebases `fileHash`/`updatedAt` for any profile that is not `dirty`
   * (`main/modules/config/index.ts`, `refreshFromFiles`) - happily rebased the hash out from under an
   * open draft. The next raw save's conflict guard then compared the typed text against a hash that
   * already matched the *externally edited* file, reported "unchanged" and overwrote the edit the
   * user never saw. A profile with structured unsaved changes was always protected by the `dirty`
   * branch there; this is how a draft gets the same protection.
   *
   * Called on every change of `active`, and with `false` on unmount - going back to the profile list
   * destroys the draft with this provider, and a consumer left holding a stale `true` would suppress
   * its re-reads for the rest of the session.
   */
  onActiveChange?: (active: boolean) => void
  children: ReactNode
}) {
  const pushToast = useLauncher((state) => state.pushToast)
  const [draft, setDraft] = useState<DraftState | null>(null)
  const [saving, setSaving] = useState(false)
  const [conflict, setConflict] = useState<SaveProfileConflict | null>(null)
  const [lastResult, setLastResult] = useState<RawSaveReadBack | null>(null)
  const [resetToken, setResetToken] = useState(0)
  // A ref, not the `saving` state, guards re-entry: two Ctrl+S presses in the same tick would both
  // read the pre-update `saving === false` and fire two writes of the same text.
  const savingRef = useRef(false)
  // Mirrors `draft` synchronously (state is only visible on the next render), so a save that is
  // in flight can tell afterwards whether the user kept typing while it ran - see `runSave`.
  const draftRef = useRef<DraftState | null>(null)

  const activeDraft = draft && draft.profileId === profile.id ? draft : null
  const profileDirty = isProfileDirty(profile)
  const active = activeDraft !== null

  // Read through a ref, kept current every render, for the same reason `useFileSourceRefresh` does
  // it: the report effect below must fire on a change of `active` only, never again just because a
  // caller passed a fresh arrow function this render.
  const onActiveChangeRef = useRef(onActiveChange)
  useEffect(() => {
    onActiveChangeRef.current = onActiveChange
  })
  useEffect(() => {
    onActiveChangeRef.current?.(active)
    return () => {
      onActiveChangeRef.current?.(false)
    }
  }, [active])

  const setDraftState = (next: DraftState | null): void => {
    draftRef.current = next
    setDraft(next)
  }

  const clear = (): void => {
    setDraftState(null)
    setResetToken((token) => token + 1)
  }

  /**
   * The one save path for a raw draft, shared by the bar's Save button, the editor's Ctrl+S and the
   * conflict dialog's "Overwrite". Returns whether the pending state was resolved - which is exactly
   * the dialog's own "may I close now?" question.
   *
   * Deliberately rebuilt on every render (no `useCallback`/`useMemo` around this provider's value):
   * it must always see the draft of the render that triggered it, and every consumer below re-renders
   * with this provider anyway.
   */
  const runSave = async (force: boolean): Promise<boolean> => {
    if (!activeDraft || savingRef.current) return false

    const sent = activeDraft.text
    savingRef.current = true
    setSaving(true)
    const outcome = await saveConfigProfileRawText({
      profileId: profile.id,
      text: sent,
      ...(force ? { force: true } : {}),
    })
    savingRef.current = false
    setSaving(false)

    const action = resolveRawSaveOutcome(outcome)
    if (action.type === 'saved') {
      // Only drop the draft if it is still the text that was just written. Typing during the
      // round-trip (Ctrl+S and carry on is a habit, and the file write plus read-back is not
      // instant) leaves a NEWER draft behind, and clearing it here would throw those keystrokes
      // away without a trace - the one failure this whole context exists to prevent.
      const unchanged = draftRef.current?.profileId === profile.id && draftRef.current.text === sent
      if (unchanged) clear()
      setLastResult({
        fileName: action.result.fileName,
        path: action.result.path,
        droppedAliases: action.result.droppedAliases,
        preservedLines: action.result.preservedLines,
      })
      onSaved(action.result.profile)
      return true
    }

    if (action.type === 'conflict') {
      // The draft is left exactly as it was, so "Overwrite" still has the user's own text to write.
      setConflict(action.conflict)
      return false
    }

    pushToast({
      level: 'error',
      messageKey: action.messageKey,
      timeoutMs: 0,
      ...(action.params ? { params: action.params } : {}),
    })
    return false
  }

  const handle: RawDraftHandle = {
    active,
    text: activeDraft?.text ?? null,
    saving,
    lastResult,
    resetToken,
    setText: (text, baseline) => {
      const draftActive = activeDraft !== null
      if (rawEditingMode({ onDisk: true, profileDirty, draftActive }) !== 'editable') return
      if (!isRawDraftDirty(text, baseline)) {
        // Typed back to what the file says: no draft, and therefore nothing for the save bar to
        // report and nothing keeping the other tabs `inert`. No `resetToken` bump - the editor is
        // already showing exactly this text and must not be remounted from under the caret.
        if (draftActive) setDraftState(null)
        return
      }
      setLastResult(null)
      setDraftState({ profileId: profile.id, text })
    },
    discard: () => {
      if (activeDraft === null) return
      clear()
    },
    save: () => {
      void runSave(false)
    },
  }

  return (
    <RawDraftContext.Provider value={handle}>
      {children}
      {conflict && (
        <ConfigConflictDialog
          profileId={profile.id}
          conflict={conflict}
          onClose={() => setConflict(null)}
          onOverwrite={() => runSave(true)}
          onResolved={(resolved) => {
            // Only "Take the file" reaches this: the file on disk replaces both the profile and the
            // typed text the user chose against.
            setConflict(null)
            clear()
            onSaved(resolved)
          }}
        />
      )}
    </RawDraftContext.Provider>
  )
}

/**
 * The current profile's raw draft. Throws outside a `RawDraftProvider` for the same reason
 * `useProfileChanges` does: every consumer (the save bar, the Raw file tab, `ConfigView`'s
 * `inert` guard) renders inside the provider, so a missing one is a wiring bug that should fail
 * loudly rather than quietly report "nothing typed".
 */
export function useRawDraft(): RawDraftHandle {
  const handle = useContext(RawDraftContext)
  if (!handle) {
    throw new Error('useRawDraft must be used within a RawDraftProvider')
  }
  return handle
}
