import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from './Button'
import { Modal } from './Modal'

export interface ConfirmDialogProps {
  title: string
  body: ReactNode
  confirmLabel: string
  tone: 'danger' | 'primary'
  /** While true confirm and cancel are disabled and the dialog cannot be dismissed. */
  busy?: boolean
  /** Disables confirm only; the dialog stays dismissable. */
  confirmDisabled?: boolean
  onConfirm: () => void
  onClose: () => void
  size?: 'sm' | 'md' | 'lg'
  testIds?: { confirm?: string; cancel?: string }
}

/** Asks the user to confirm one action. The caller closes the dialog. */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  tone,
  busy = false,
  confirmDisabled = false,
  onConfirm,
  onClose,
  size = 'sm',
  testIds,
}: ConfirmDialogProps) {
  const { t } = useTranslation()

  return (
    <Modal
      open
      size={size}
      title={title}
      onClose={onClose}
      closeLabel={t('common.action.close')}
      preventClose={busy}
      footer={
        <>
          <Button variant="ghost" disabled={busy} onClick={onClose} data-testid={testIds?.cancel}>
            {t('common.action.cancel')}
          </Button>
          <Button
            variant={tone}
            disabled={busy || confirmDisabled}
            onClick={onConfirm}
            data-testid={testIds?.confirm}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {typeof body === 'string' ? (
        <p className="text-sm leading-relaxed text-ink-dim">{body}</p>
      ) : (
        body
      )}
    </Modal>
  )
}
