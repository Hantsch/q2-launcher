import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ConfigProfile } from '@shared/modules/config'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { useLauncher } from '../../store/useLauncher'
import { discardConfigProfile } from './client'

/**
 * Story 049 D6: confirms throwing away a profile's unsaved edits and returning it to its last
 * saved/loaded baseline. Mirrors `DeleteProfileDialog`'s shape (Modal, ghost Cancel + danger
 * confirm footer, module-local props, no shell store beyond the toast) - discard is destructive to
 * in-progress work the same way delete is destructive to the profile itself, so the same idiom
 * applies, just calling `discardConfigProfile` instead of `removeConfigProfile`.
 *
 * `onDiscarded` mirrors `DeleteProfileDialog`'s `onDeleted(profiles)` naming/shape rather than
 * `ProfileSaveBar`'s own single-profile `onSaved` - `discard` (like `remove`/`rename`) returns the
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
  const [submitting, setSubmitting] = useState(false)

  const submit = async (): Promise<void> => {
    setSubmitting(true)
    const outcome = await discardConfigProfile({ profileId: profile.id })
    setSubmitting(false)

    if (!outcome.ok) {
      pushToast({ level: 'error', messageKey: outcome.error.key, timeoutMs: 0 })
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
    <Modal
      open
      size="sm"
      title={t('config.discardDialog.title')}
      onClose={onClose}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" disabled={submitting} onClick={() => void submit()}>
            {submitting ? t('config.save.discarding') : t('config.discardDialog.confirm')}
          </Button>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-ink-dim">{t('config.discardDialog.body')}</p>
    </Modal>
  )
}
