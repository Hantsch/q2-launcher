import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react'
import type { ToastLevel, ToastMessage } from '@shared/types'
import { cn } from '../../lib/cn'
import { useLauncher } from '../../store/useLauncher'
import { IconButton } from './Button'

const LEVEL_STYLES: Record<ToastLevel, { border: string; icon: typeof Info; text: string }> = {
  info: { border: 'border-info/40', icon: Info, text: 'text-info' },
  success: { border: 'border-success/40', icon: CircleCheck, text: 'text-success' },
  warning: { border: 'border-warning/40', icon: TriangleAlert, text: 'text-warning' },
  error: { border: 'border-danger/45', icon: CircleAlert, text: 'text-danger' },
}

export function Toasts() {
  const toasts = useLauncher((state) => state.toasts)

  return (
    // Stacked above the action bar, not over it: at small window sizes a
    // bottom-right toast covered the PLAY button outright.
    <div
      className="pointer-events-none fixed right-5 z-60 flex w-96 flex-col gap-2"
      style={{ bottom: 'calc(var(--actionbar-h) + 1.25rem)' }}
    >
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} />
      ))}
    </div>
  )
}

function Toast({ toast }: { toast: ToastMessage }) {
  const { t } = useTranslation()
  const dismiss = useLauncher((state) => state.dismissToast)
  const style = LEVEL_STYLES[toast.level]
  const Icon = style.icon

  useEffect(() => {
    // `timeoutMs: 0` means the message stays until the user dismisses it -
    // errors should never disappear before they have been read.
    if (toast.timeoutMs <= 0) return
    const timer = window.setTimeout(() => dismiss(toast.id), toast.timeoutMs)
    return () => window.clearTimeout(timer)
  }, [toast.id, toast.timeoutMs, dismiss])

  return (
    <div
      role="status"
      className={cn(
        'panel-raised pointer-events-auto flex items-start gap-2.5 rounded-md border-l-2 p-3',
        style.border,
      )}
    >
      <Icon className={cn('mt-0.5 size-4 shrink-0', style.text)} />
      <p className="min-w-0 flex-1 text-xs leading-relaxed text-ink" data-selectable>
        {t(toast.messageKey, toast.params ?? {})}
      </p>
      <IconButton label={t('common.close')} size="sm" onClick={() => dismiss(toast.id)}>
        <X className="size-3.5" />
      </IconButton>
    </div>
  )
}
