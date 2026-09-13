import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '../../lib/cn'
import { IconButton } from './Button'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Every currently-open `Modal`'s own id, in mount order - lets a nested Modal's Escape handler
 * tell whether it is the topmost one before it reacts. All open Modals attach their own
 * `keydown` listener straight to `document` (there is no shared portal root to scope it to), so
 * `stopPropagation` on the event cannot stop a sibling listener on the very same target - only this
 * ordered check can single out "the one the user actually meant to close" (review finding: nested
 * Modal Escape used to close both the confirm dialog and the dialog underneath it in one keypress).
 */
const openModalStack: string[] = []

export interface ModalProps {
  open: boolean
  title: string
  description?: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  /** Content width. `md` suits a form, `lg` a result list. */
  size?: 'sm' | 'md' | 'lg'
  closeLabel: string
  /** When true, Escape, the backdrop click and the header close button all do nothing - for a step
   * that must not be dismissed mid-flight (e.g. an apply in progress whose only undo entry point
   * lives in state this Modal's unmount would discard). Defaults to false, same behaviour as before
   * this prop existed. */
  preventClose?: boolean
}

/**
 * The launcher's only dialog primitive.
 *
 * Keyboard behaviour matters here because these dialogs are how installations
 * get added: Escape closes, focus moves into the dialog on open and returns to
 * the trigger on close, and Tab is confined to the dialog.
 */
export function Modal({
  open,
  title,
  description,
  onClose,
  children,
  footer,
  size = 'md',
  closeLabel,
  preventClose = false,
}: ModalProps) {
  const id = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return

    previouslyFocused.current = document.activeElement as HTMLElement | null
    const panel = panelRef.current
    // Focus the first control in the body, not the close button in the header:
    // landing on "close" puts a focus ring on the one thing the user did not ask
    // for, and reads badly to a screen reader. Dialogs with nothing focusable
    // get the panel itself, so Escape and Tab still work.
    const first = bodyRef.current?.querySelector<HTMLElement>(FOCUSABLE)
    ;(first ?? panel)?.focus()

    openModalStack.push(id)

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        // Only the topmost open Modal reacts - see `openModalStack`'s own doc comment. A Modal
        // opened underneath this one (still in the stack, just not on top) must not also close.
        if (openModalStack[openModalStack.length - 1] !== id) return
        event.preventDefault()
        if (!preventClose) onClose()
        return
      }
      if (event.key !== 'Tab' || !panel) return

      const focusable = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (element) => element.offsetParent !== null,
      )
      if (focusable.length === 0) {
        // Nothing inside the panel to trap focus on (e.g. preventClose disabled every
        // control and hid the close button) - anchor the trap on the panel itself so
        // Tab/Shift+Tab cannot leak focus to whatever sits behind this Modal in DOM
        // order (review finding: leaked to an outer dialog's own close button, which
        // then discarded state this Modal's unmount would have lost).
        event.preventDefault()
        panel.focus()
        return
      }

      const firstElement = focusable[0]
      const lastElement = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault()
        lastElement.focus()
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault()
        firstElement.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      const index = openModalStack.indexOf(id)
      if (index !== -1) openModalStack.splice(index, 1)
      previouslyFocused.current?.focus()
    }
  }, [open, onClose, preventClose, id])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      {/* Scrim: dark, slightly warm, so the dialog reads as lit from within. */}
      <button
        type="button"
        aria-hidden
        tabIndex={-1}
        onClick={preventClose ? undefined : onClose}
        className="absolute inset-0 cursor-default bg-void/78 backdrop-blur-[2px]"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn(
          'panel-raised edge-flame relative flex max-h-full w-full flex-col rounded-md outline-none',
          size === 'sm' && 'max-w-md',
          size === 'md' && 'max-w-xl',
          size === 'lg' && 'max-w-3xl',
        )}
      >
        {/*
          Plain divs, not <header>/<footer>: the panel is portalled to
          document.body, so - unlike a view's own header inside <main> - these
          would map to a second `banner` and `contentinfo` landmark next to the
          title bar's and the action bar's (axe landmark-no-duplicate-banner /
          -contentinfo / landmark-unique, story 037 D6). A dialog's title strip
          is not a page banner; the dialog is named by aria-label already.
        */}
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div className="min-w-0 space-y-1">
            <h2 className="truncate font-display text-base tracking-[0.08em] text-ink uppercase">
              {title}
            </h2>
            {description && <p className="text-xs leading-relaxed text-ink-dim">{description}</p>}
          </div>
          {!preventClose && (
            <IconButton label={closeLabel} size="sm" onClick={onClose}>
              <X className="size-4" />
            </IconButton>
          )}
        </div>

        <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {children}
        </div>

        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3.5">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
