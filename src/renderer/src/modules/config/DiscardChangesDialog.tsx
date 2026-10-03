import { useTranslation } from 'react-i18next'
import type { ConfigProfile } from '@shared/modules/config'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { useSubmitting } from '../../components/ui/useSubmitting'
import { useLauncher } from '../../store/useLauncher'
import { toastOutcomeError } from '../../lib/toast'
import { discardConfigProfile } from './client'

/**
 * Story 049 D6: confirms throwing away a profile's unsaved edits and returning it to its last
 * saved/loaded baseline. Mirrors `DeleteProfileDialog`'s shape (ConfirmDialog, danger
 * confirm, module-local props, no shell store beyond the toast) - discard is destructive to
 * in-progress work the same way delete is destructive to the profile itself, so the same idiom
 * applies, just calling `discardConfigProfile` instead of `removeConfigProfile`.
 *
 * `onDiscarded` mirrors `DeleteProfileDialog`'s `onDeleted(profiles)` naming/shape rather than
 * `ProfileSaveActions`'s own single-profile `onSaved` - `discard` (like `remove`/`rename`) returns the
 * full, updated profile list, not one profile.
 *
 * The button that opens this dialog is only enabled when `profile.baseline` is set, so the
 * `'noBaseline'` result here is a defensive race (the baseline vanishing between render and click
 * is not expected in normal use) rather than the everyday path - handled with a toast and a plain
 * close, never a silent success.
 */
export function DiscardChangesDialog({
  profile,
  onClose,
  onDiscarded,
}: {
  profile: ConfigProfile
  onClose: () => void
  /** The full, updated profile list, per the config module's discard contract. */
  onDiscarded: (profiles: ConfigProfile[]) => void
}) {
  const { t } = useTranslation()
  const pushToast = useLauncher((state) => state.pushToast)
  const { submitting, run } = useSubmitting()

  const submit = async (): Promise<void> => {
    const outcome = await discardConfigProfile({ profileId: profile.id })

    if (!outcome.ok) {
      toastOutcomeError(pushToast, outcome)
      onClose()
      return
    }

    if (outcome.value.status === 'noBaseline') {
      pushToast({ level: 'error', messageKey: 'config.save.discardNoBaseline', timeoutMs: 0 })
      onClose()
      return
    }

    onDiscarded(outcome.value.profiles)
  }

  return (
    <ConfirmDialog
      title={t('config.discardDialog.title')}
      body={t('config.discardDialog.body')}
      confirmLabel={submitting ? t('config.save.discarding') : t('config.discardDialog.confirm')}
      tone="danger"
      busy={submitting}
      onClose={onClose}
      onConfirm={() => void run(submit)}
    />
  )
}
