import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ConfigProfile, SaveProfileConflict } from '@shared/modules/config'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { SectionLabel } from '../../components/ui/primitives'
import { useLauncher } from '../../store/useLauncher'
import { refreshProfilesFromFiles, saveConfigProfile } from './client'
import { ConfigCodeView } from './components/ConfigCodeView'
import { adoptProfileFromFile } from './lib/file-source-refresh'

/**
 * Story 043 D8: the whole-file conflict dialog - `save`'s `SaveProfileConflict` shown as two
 * side-by-side panes, both built from 024's `ConfigCodeView` (single-pane by design, composed
 * twice here rather than rewritten into a diff component). Replaces the plain toast stub D6 left
 * in `ProfileSaveBar`/`lib/save-bar.ts` for the `'conflict'` outcome.
 *
 * Mirrors `ImportProfileDialog` for the dialog shell: a `Modal` with a footer of real buttons, no
 * home-grown focus trap - `Modal` already owns focus-on-open/Tab-confinement/Escape-to-close, and
 * closing this dialog (Escape, the scrim, or Cancel) resolves nothing, same as that dialog's own
 * `onClose`.
 *
 * The two resolutions are real IPC round-trips, not local state mutations:
 * - **Take the file** discards the unsaved edits and adopts whatever is on disk right now, through
 *   `refreshFromFiles`'s existing `adopted` branch (D5) with its new `discardLocalEdits` flag (D8) -
 *   a fresh read, not a replay of the `diskContent` this dialog was opened with, since "take the
 *   file" means "whatever the file says", which could in principle have moved again since the
 *   conflict was first shown.
 * - **Overwrite with my version** writes `ourContent` (the cached profile's own render) through
 *   `save`'s new `force` flag (D8), which skips the re-read/conflict check entirely - the user has
 *   just been shown the disk content and explicitly chosen to replace it regardless.
 *
 * Either resolution lands through `onResolved`, the same single-profile update path `ProfileSaveBar`
 * already gets from `ConfigView` (`handleProfileUpdated`) - there is no separate result shape for a
 * dialog-resolved save than for an ordinary one.
 *
 * Story 057 D5: the raw-text editor hits the same conflict guard, and shows *this* dialog for it
 * rather than a second one - the two panes mean exactly the same thing there (`ourContent` is then
 * the typed text, per `SaveRawTextResult`'s own doc comment). Only what "Overwrite with my version"
 * *writes* differs, so that one action is parameterized through `onOverwrite` instead of the
 * component being forked.
 */
export function ConfigConflictDialog({
  profileId,
  conflict,
  onClose,
  onResolved,
  onOverwrite,
}: {
  profileId: string
  conflict: SaveProfileConflict
  onClose: () => void
  onResolved: (profile: ConfigProfile) => void
  /**
   * Story 057 D5: replaces the default "re-save the cached profile with `force`" body of the
   * Overwrite button - the raw editor force-saves the text the user typed instead. The callback owns
   * its own result handling (including reporting its own failures and handing the updated profile on,
   * which is why `onResolved` is not called for it) and answers whether the conflict is resolved:
   * `true` closes this dialog, `false` leaves it open so the user can still take the file instead.
   */
  onOverwrite?: () => Promise<boolean>
}) {
  const { t } = useTranslation()
  const pushToast = useLauncher((state) => state.pushToast)
  const [busy, setBusy] = useState<'take' | 'overwrite' | null>(null)

  const reportUnexpected = (messageKey: string, params?: Record<string, string | number>): void => {
    pushToast({ level: 'error', messageKey, timeoutMs: 0, ...(params ? { params } : {}) })
  }

  /**
   * Shares its body with Care -> Sync -> Reload through `adoptProfileFromFile`
   * (`lib/file-source-refresh.ts`) - story-050 review, finding 1: taking the file can *lose* an
   * entry when the file defines one alias name twice, and that warning has to come from the adopt
   * itself rather than from whichever button happened to trigger it. `failed` means the call's own
   * error toast has already been pushed, so this must not add a second one.
   */
  const takeFile = async (): Promise<void> => {
    setBusy('take')
    const result = await adoptProfileFromFile({
      profileId,
      discardLocalEdits: true,
      refresh: refreshProfilesFromFiles,
      pushToast,
    })
    setBusy(null)

    if (result.kind === 'failed') return
    if (result.kind === 'adopted') {
      onResolved(result.profile)
      onClose()
      return
    }
    // The file moved again (missing/unparseable/readError) in the moment between the conflict
    // being shown and this click - rare, but real disk state, not a bug in this dialog. Nothing
    // was adopted; report it and let the ordinary save/refresh flow pick it up from here.
    reportUnexpected('config.conflictDialog.takeFileFailed')
  }

  const overwrite = async (): Promise<void> => {
    setBusy('overwrite')

    if (onOverwrite) {
      const resolved = await onOverwrite()
      setBusy(null)
      // A `false` answer means the caller already reported whatever went wrong; the dialog stays
      // open so "Take the file" is still reachable.
      if (resolved) onClose()
      return
    }

    const outcome = await saveConfigProfile({ profileId, force: true })
    setBusy(null)

    if (!outcome.ok) {
      reportUnexpected(outcome.error.key, outcome.error.params)
      return
    }
    if (outcome.value.status === 'saved') {
      onResolved(outcome.value.profile)
      onClose()
      return
    }
    // `force` skips the classification that could produce `conflict`/`unreadable` - reaching one of
    // them here would mean the canonical directory itself became unreadable in that instant.
    reportUnexpected('config.conflictDialog.overwriteFailed')
  }

  return (
    <Modal
      open
      size="lg"
      title={t('config.conflictDialog.title')}
      description={t('config.conflictDialog.description')}
      onClose={onClose}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="ghost" disabled={busy !== null} onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            data-testid="config-conflict-take-file"
            variant="neutral"
            disabled={busy !== null}
            onClick={() => void takeFile()}
          >
            {busy === 'take'
              ? t('config.conflictDialog.takingFile')
              : t('config.conflictDialog.takeFile')}
          </Button>
          <Button
            data-testid="config-conflict-overwrite"
            variant="primary"
            disabled={busy !== null}
            onClick={() => void overwrite()}
          >
            {busy === 'overwrite'
              ? t('config.conflictDialog.overwriting')
              : t('config.conflictDialog.overwrite')}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3" data-testid="config-conflict-dialog">
        <div className="min-w-0 space-y-1.5">
          <SectionLabel>{t('config.conflictDialog.onDisk')}</SectionLabel>
          <ConfigCodeView text={conflict.diskContent} searchable />
        </div>
        <div className="min-w-0 space-y-1.5">
          <SectionLabel>{t('config.conflictDialog.yourEdits')}</SectionLabel>
          <ConfigCodeView text={conflict.ourContent} searchable />
        </div>
      </div>
    </Modal>
  )
}
