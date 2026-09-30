import { useTranslation } from 'react-i18next'
import { Button } from '../../../components/ui/Button'
import { Modal } from '../../../components/ui/Modal'

/**
 * Story 155: asks before leaving a demo whose notes draft has unsaved edits. Mirrors
 * `config/DiscardChangesDialog.tsx`'s shape (Modal size sm, ghost + danger footer) - but purely
 * local: the draft lives in `demo-editor-store.ts`, so there is no IPC to await here.
 */
export function DiscardDemoNotesDialog({
  onKeepEditing,
  onDiscard,
}: {
  onKeepEditing: () => void
  onDiscard: () => void
}) {
  const { t } = useTranslation()
  return (
    <Modal
      open
      size="sm"
      title={t('replays.editor.discardDialog.title')}
      onClose={onKeepEditing}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="ghost" onClick={onKeepEditing} data-testid="replays-discard-keep">
            {t('replays.editor.discardDialog.keep')}
          </Button>
          <Button variant="danger" onClick={onDiscard} data-testid="replays-discard-confirm">
            {t('replays.editor.discardDialog.confirm')}
          </Button>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-ink-dim" data-testid="replays-discard-dialog">
        {t('replays.editor.discardDialog.body')}
      </p>
    </Modal>
  )
}
