import { useRef, useState } from 'react'
import type { ConfigProfile, RefreshedProfileResult } from '@shared/modules/config'
import { toastOutcomeError } from '../../../lib/toast'
import { useLauncher } from '../../../store/useLauncher'
import { saveConfigProfile } from '../client'
import { useConfigProfiles } from '../config-profiles-store'
import type { FileDiagnostic } from '../components/ProfileFileBanners'
import {
  applyRefreshedProfile,
  droppedAliasWarning,
  noticeForRefreshedProfile,
} from './file-source-refresh'
import { resolveSaveOutcome } from './save-bar'
import { useFileSourceRefresh } from './useFileSourceRefresh'

/**
 * Keeps the selected profile in step with its canonical files (re-read triggers, the diagnostic
 * banner, "Rewrite from cache") and mirrors the Raw tab's draft state out of `RawDraftProvider`,
 * which the view mounts and therefore cannot read. (story 218)
 */
export function useProfileFileSync({
  selectedId,
  selected,
  onUpdated,
  onAfterRefresh,
}: {
  selectedId: string | null
  selected: ConfigProfile | null
  onUpdated: (profile: ConfigProfile) => void
  onAfterRefresh: () => void
}) {
  const replaceAll = useConfigProfiles((s) => s.replaceAll)
  const pushToast = useLauncher((state) => state.pushToast)
  const [fileDiagnostic, setFileDiagnostic] = useState<FileDiagnostic | null>(null)
  const [rewriting, setRewriting] = useState(false)

  /**
   * Story 043 D7: the outcome of one `useFileSourceRefresh` re-read for the selected profile.
   * `applyRefreshedProfile` folds the outcome into `profiles` (a no-op for `unchanged`/`conflict`,
   * a full replace for `adopted`, a `fileState`-only patch for `missing`/`unparseable`/`readError` -
   * see its own doc comment); `noticeForRefreshedProfile` says what, if anything, needs surfacing
   * on top of that.
   *
   * `adopted` is reported as a toast (AC3: "never a silent swap") - this module's existing one-shot
   * transient-notice idiom, per `ProfileSaveActions`'s own `pushToast` usage. `conflict` is reported the
   * same way `ProfileSaveActions`/`resolveSaveOutcome` (D6) stub it: a plain toast, no dialog - D5's own
   * doc comment already says this pair of triggers should not realistically produce a conflict
   * (that needs a dirty profile plus an external edit in the same instant), and the real two-pane
   * resolution is D8's job.
   */
  const handleFileSourceResult = (result: RefreshedProfileResult): void => {
    replaceAll(applyRefreshedProfile(useConfigProfiles.getState().profiles, result))

    const notice = noticeForRefreshedProfile(result)
    if (notice?.kind === 'reloaded') {
      pushToast({ level: 'info', messageKey: 'config.fileSource.reloaded', timeoutMs: 6000 })
      // Story-050 review (finding 4, second round): the reload kept only the last definition of an
      // alias name the file spelled twice, so an entry's commands are gone from the profile that
      // just replaced the cached one. Its own toast next to the `info` one above, built by
      // `droppedAliasWarning` - the same single definition Care's Reload and the conflict dialog's
      // "Take the file" push through `adoptProfileFromFile` (finding 1, third round), so the three
      // adopt paths can never word this differently or forget it.
      const warning = droppedAliasWarning(notice.droppedAliases)
      if (warning) pushToast(warning)
    } else if (notice?.kind === 'conflict') {
      pushToast({ level: 'error', messageKey: 'config.fileSource.conflict', timeoutMs: 0 })
    }

    setFileDiagnostic((prev) => {
      if (notice?.kind === 'diagnostic') {
        return {
          profileId: result.profileId,
          file: notice.file,
          line: notice.line,
          message: notice.message,
        }
      }
      // Any other outcome for the same profile means the diagnostic no longer applies (the file
      // came back readable, was adopted, or went missing instead) - a diagnostic for a different
      // profile is left alone.
      return prev?.profileId === result.profileId ? null : prev
    })
  }

  /**
   * Review fix (story 057): whether the Raw file tab currently holds a typed-but-unsaved draft.
   *
   * A ref, written by `RawDraftProvider`'s `onActiveChange` below and never read during render, for
   * two reasons: this view must not re-render on every keystroke that starts or ends a draft, and
   * `useFileSourceRefresh` asks the question at trigger time anyway. It cannot come from
   * `useRawDraft()` here - that provider is mounted *inside* this component's own tree (which is why
   * `StructuredTabsGuard`/`RenameHeaderButton` exist as separate components), while the re-read hook
   * has to keep running for the whole view. See the prop's own doc comment for why re-reading under
   * an open draft silently destroyed external edits.
   */
  const rawDraftActiveRef = useRef(false)
  /**
   * The same `active` signal as the ref above, as state - the ref exists because
   * `useFileSourceRefresh` must not re-render on it, but the Unsaved tab's own visibility must
   * (it is a tab that appears and disappears). Both are set from the one `onActiveChange` call
   * below, so they cannot drift.
   */
  const [rawDraftActive, setRawDraftActive] = useState(false)

  useFileSourceRefresh({
    profileId: selectedId,
    isSuspended: () => rawDraftActiveRef.current,
    onResult: handleFileSourceResult,
    onAfterRefresh: onAfterRefresh,
  })

  /**
   * The "Rewrite from cache" action on the `fileState: 'missing'` banner (story 043 D7) - reuses
   * D4's existing `save` handler exactly as-is: `save` writes from cache whenever the file is
   * missing or unchanged, so there is nothing new to build on the main side. `resolveSaveOutcome`
   * (D6, `lib/save-bar.ts`) is reused rather than re-implemented for the failure branches, so an
   * unreadable-file surprise here reports through the identical toast `ProfileSaveActions` would.
   *
   * A `'conflict'` outcome (story 043 D8's new action type) is not expected on this path - the
   * file was reported `missing` a moment ago, so a save reaching `changedOnDisk` here means it
   * reappeared between the banner rendering and this click. This deliberately does not open
   * `ConfigConflictDialog` for that vanishingly rare race (this button's whole point is a MISSING
   * file, not a changed one) - it falls back to the same plain toast `useFileSourceRefresh`'s own
   * conflict surfacing already uses (`handleFileSourceResult` above).
   */
  const handleRewriteFromCache = async (): Promise<void> => {
    if (!selected) return
    setRewriting(true)
    const outcome = await saveConfigProfile({ profileId: selected.id })
    setRewriting(false)

    const action = resolveSaveOutcome(outcome)
    if (action.type === 'saved') {
      onUpdated(action.profile)
      return
    }
    if (action.type === 'conflict') {
      pushToast({ level: 'error', messageKey: 'config.fileSource.conflict', timeoutMs: 0 })
      return
    }
    toastOutcomeError(pushToast, { ok: false, error: action.error })
  }

  const onRawDraftActiveChange = (active: boolean): void => {
    rawDraftActiveRef.current = active
    setRawDraftActive(active)
  }

  return {
    fileDiagnostic,
    rewriting,
    rewriteFromCache: handleRewriteFromCache,
    rawDraftActive,
    onRawDraftActiveChange,
  }
}
