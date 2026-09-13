import { useTranslation } from 'react-i18next'
import { Button } from '../../../components/ui/Button'
import { Modal } from '../../../components/ui/Modal'

/**
 * Story 086 D4: "Reset to default" confirmation, mirroring
 * `src/renderer/src/components/installations/RemoveInstallationDialog.tsx`'s use of the shared
 * `Modal` primitive (title/body/footer with Cancel + a `danger` confirm) - but NOT its global
 * dialog-store wiring (`useLauncher`'s `openDialog`/`closeDialog`/`Dialogs.tsx`). This dialog has
 * no installation-scoped identity to look up and no reason to widen the shell's dialog registry,
 * so `ArrangeBar.tsx` mounts it straight from a local `useState`, like any other locally-owned
 * confirm dialog.
 */
export function ResetLayoutDialog({
  onClose,
  onConfirm,
}: {
  onClose: () => void
  onConfirm: () => void
}) {
  const { t } = useTranslation()

  return (
    <Modal
      open
      size="sm"
      title={t('dialog.resetLayout.title')}
      onClose={onClose}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" onClick={onConfirm}>
            {t('dialog.resetLayout.confirm')}
          </Button>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-ink-dim">{t('dialog.resetLayout.body')}</p>
    </Modal>
  )
}
