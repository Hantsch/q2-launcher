/**
 * Client-side ids for things the renderer owns (toasts, scan handles).
 *
 * `crypto.randomUUID` needs a secure context; the fallback keeps this working if
 * the renderer is ever loaded from an origin Chromium does not trust.
 */
export function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
