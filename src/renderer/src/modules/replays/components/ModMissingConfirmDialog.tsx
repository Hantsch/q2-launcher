import { useTranslation } from 'react-i18next'
import { Button } from '../../../components/ui/Button'
import { Modal } from '../../../components/ui/Modal'

/**
 * Story 180 D3: asks before playing a demo whose mod the installation does not fully have. Mirrors
 * `DiscardDemoNotesDialog.tsx` (Modal size sm, ghost + primary footer); purely local, no IPC.
 */
export function ModMissingConfirmDialog({
  gameDir,
  onCancel,
  onConfirm,
}: {
  gameDir: string
  onCancel: () => void
  onConfirm: () => void
}) {
  const { t } = useTranslation()
  return (
    <Modal
      open
      size="sm"
      title={t('replays.play.modMissingConfirm.title')}
      onClose={onCancel}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} data-testid="replays-mod-missing-cancel">
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={onConfirm} data-testid="replays-mod-missing-confirm">
            {t('replays.play.modMissingConfirm.confirm')}
          </Button>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-ink-dim" data-testid="replays-mod-missing-dialog">
        {t('replays.play.modMissingConfirm.body', { gameDir })}
      </p>
    </Modal>
  )
}
