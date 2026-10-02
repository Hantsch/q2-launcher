import type { LocalizedMessage, Refusal } from '@shared/types'
import type { ToastMessage } from '@shared/types/toast'

/** The store's `pushToast`; injected so this module stays free of any store import. */
export type PushToast = (toast: Omit<ToastMessage, 'id'>) => void

function pushSticky(
  push: PushToast,
  messageKey: string,
  params: Record<string, string | number> | undefined,
): void {
  push({ level: 'error', messageKey, timeoutMs: 0, ...(params ? { params } : {}) })
}

/** Sticky error toast for a failed `Outcome`; the message params are always forwarded. */
export function toastOutcomeError(
  push: PushToast,
  failure: { ok: false; error: LocalizedMessage },
): void {
  pushSticky(push, failure.error.key, failure.error.params)
}

/** Sticky error toast for a domain `Refusal`; `reasonKey` is already a full i18n key. */
export function toastRefusal(push: PushToast, refusal: Refusal): void {
  pushSticky(push, refusal.reasonKey, refusal.params)
}
