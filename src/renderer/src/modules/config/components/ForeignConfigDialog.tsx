import { useTranslation } from 'react-i18next'
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog'

/** Asks before an assignment replaces a config file the launcher did not write. */
export function ForeignConfigDialog({
  fileName,
  installationName,
  onWrite,
  onClose,
}: {
  fileName: string
  installationName: string
  onWrite: () => void
  onClose: () => void
}) {
  const { t } = useTranslation()

  return (
    <ConfirmDialog
      title={t('config.assignment.foreignFile.title', { fileName })}
      body={t('config.assignment.foreignFile.body', { fileName, name: installationName })}
      confirmLabel={t('config.assignment.foreignFile.confirm')}
      tone="danger"
      onConfirm={onWrite}
      onClose={onClose}
      testIds={{ confirm: 'foreign-config-write', cancel: 'foreign-config-cancel' }}
    />
  )
}
