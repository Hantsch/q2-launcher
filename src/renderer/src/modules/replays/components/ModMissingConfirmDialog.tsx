import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../../components/ui/Button'
import { Checkbox } from '../../../components/ui/controls'
import { Modal } from '../../../components/ui/Modal'

/**
 * Story 180 D3 / 182 D2: asks before playing a demo whose mod the installation does not fully have -
 * the only place that warning lives. "Don't ask again" is reported with the confirmation only;
 * Cancel reports nothing whatever the box says. Purely local, no IPC.
 */
export function ModMissingConfirmDialog({
  gameDir,
  onCancel,
  onConfirm,
}: {
  gameDir: string
  onCancel: () => void
  onConfirm: (dontAskAgain: boolean) => void
}) {
  const { t } = useTranslation()
  const [dontAsk, setDontAsk] = useState(false)
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
          <Button variant="primary" onClick={() => onConfirm(dontAsk)} data-testid="replays-mod-missing-confirm">
            {t('replays.play.modMissingConfirm.confirm')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm leading-relaxed text-ink-dim" data-testid="replays-mod-missing-dialog">
          {t('replays.play.modWarning.body', { gameDir })}
        </p>
        <Checkbox
          checked={dontAsk}
          onChange={setDontAsk}
          label={t('replays.play.modWarning.dontAsk')}
          data-testid="replays-mod-warning-dont-ask"
        />
      </div>
    </Modal>
  )
}
