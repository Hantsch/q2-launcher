import { useTranslation } from 'react-i18next'
import type { SidecarIssue } from '@shared/modules/replays'
import { Button } from '../../../components/ui/Button'
import { Modal } from '../../../components/ui/Modal'

/**
 * Story 155: a save found a broken notes file on disk and touched nothing (`needsConfirmation`).
 * Names the file and each of its problems (the same `replays.sidecar.issue.*` keys
 * `DemoDetailPanel.tsx` shows), and only `onConfirm` lets the retry replace it.
 */
export function ReplaceSidecarDialog({
  fileName,
  issues,
  onConfirm,
  onCancel,
}: {
  fileName: string
  issues: SidecarIssue[]
  onConfirm: () => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  return (
    <Modal
      open
      size="sm"
      title={t('replays.editor.replaceDialog.title')}
      onClose={onCancel}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} data-testid="replays-replace-cancel">
            {t('common.cancel')}
          </Button>
          <Button variant="danger" onClick={onConfirm} data-testid="replays-replace-confirm">
            {t('replays.editor.replaceDialog.confirm')}
          </Button>
        </>
      }
    >
      <div
        className="space-y-2 text-sm leading-relaxed text-ink-dim"
        data-testid="replays-replace-sidecar-dialog"
      >
        <p>{t('replays.editor.replaceDialog.body', { fileName })}</p>
        <ul className="list-disc space-y-1 pl-5 text-xs text-danger">
          {issues.map((issue, index) => (
            <li key={`${issue.kind}-${index}`}>{t(issue.key, issue.params)}</li>
          ))}
        </ul>
      </div>
    </Modal>
  )
}
