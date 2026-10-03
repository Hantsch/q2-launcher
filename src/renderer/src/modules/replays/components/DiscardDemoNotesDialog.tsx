import { useTranslation } from 'react-i18next'
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog'

/**
 * Asks before leaving a demo whose notes draft has unsaved edits. Purely local: the draft lives
 * in `demo-editor-store.ts`, so there is no IPC to await here.
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
    <ConfirmDialog
      title={t('replays.editor.discardDialog.title')}
      body={
        <p className="text-sm leading-relaxed text-ink-dim" data-testid="replays-discard-dialog">
          {t('replays.editor.discardDialog.body')}
        </p>
      }
      confirmLabel={t('replays.editor.discardDialog.confirm')}
      tone="danger"
      onConfirm={onDiscard}
      onClose={onKeepEditing}
      testIds={{ confirm: 'replays-discard-confirm', cancel: 'replays-discard-keep' }}
    />
  )
}
