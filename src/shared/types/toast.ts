export type ToastLevel = 'info' | 'success' | 'warning' | 'error'

/** A transient notification pushed from main to the UI. Text is an i18n key. */
export interface ToastMessage {
  id: string
  level: ToastLevel
  messageKey: string
  params?: Record<string, string | number>
  /** Milliseconds before auto-dismiss; 0 means the user must dismiss it. */
  timeoutMs: number
}
