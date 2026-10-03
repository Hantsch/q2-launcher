import { useTranslation } from 'react-i18next'
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog'

/**
 * "Reset to default" confirmation. Locally owned: `ArrangeBar.tsx` mounts it from a `useState`
 * rather than the shell's dialog registry, because it has no installation-scoped identity.
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
    <ConfirmDialog
      title={t('dialog.resetLayout.title')}
      body={t('dialog.resetLayout.body')}
      confirmLabel={t('dialog.resetLayout.confirm')}
      tone="danger"
      onConfirm={onConfirm}
      onClose={onClose}
    />
  )
}
