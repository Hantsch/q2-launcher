import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { anchorRect } from '../../lib/anchor-rect'

/** Matches the `w-80` below. Known up front so no measurement is needed. */
const POPOVER_WIDTH = 320
const GAP = 8
const EDGE = 8

interface Placement {
  left: number
  top?: number
  bottom?: number
}

/**
 * Click-to-open popover for rich content, portalled for the same reason as
 * `Menu`/`HoverCard`: a trigger inside a scrolling rail would otherwise have
 * its floating content clipped by `overflow-y: auto`.
 *
 * Positioned from the anchor alone, exactly like `Menu` - top- or
 * bottom-anchored depending on which half of the window the trigger sits in,
 * so it never needs to measure itself and never lands off-screen. Unlike
 * `Menu`, the content is arbitrary (not a flat item list), so this behaves
 * like a dialog on top of that positioning: `role="dialog"`, focus moves into
 * the panel on open and back to the trigger on close, and Escape/outside-click
 * both close it.
 */
export function Popover({
  content,
  children,
  side = 'below',
  label,
}: {
  /** Render prop for the popover's body; receives a `close` callback so content
   * (e.g. a close button) can dismiss it without the caller holding its own
   * open state. */
  content: (props: { close: () => void }) => ReactNode
  /** Render prop for the trigger; receives the open state. */
  children: (props: { open: boolean; toggle: () => void }) => ReactNode
  side?: 'right' | 'below'
  label: string
}) {
  const anchorRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)
  const [placement, setPlacement] = useState<Placement | null>(null)
  const open = placement !== null

  const close = (): void => setPlacement(null)

  const toggle = (): void => {
    if (open) {
      close()
      return
    }
    // The wrapper is `display: contents`, so measure the trigger itself.
    const anchor = anchorRect(anchorRef.current)
    if (!anchor) return

    previouslyFocused.current = document.activeElement as HTMLElement | null

    let left = side === 'right' ? anchor.right + GAP : anchor.left
    if (left + POPOVER_WIDTH > window.innerWidth - EDGE) {
      left = Math.max(EDGE, anchor.left - POPOVER_WIDTH - GAP)
    }

    const anchorMiddle = anchor.top + anchor.height / 2
    setPlacement(
      anchorMiddle < window.innerHeight / 2
        ? { left, top: Math.max(EDGE, side === 'right' ? anchor.top : anchor.bottom + GAP) }
        : {
            left,
            bottom: Math.max(
              EDGE,
              window.innerHeight - (side === 'right' ? anchor.bottom : anchor.top - GAP),
            ),
          },
    )
  }

  useEffect(() => {
    if (!open) return

    // Focus moves into the panel itself, mirroring `Modal`: there is no
    // guaranteed focusable control in caller-supplied content, so the panel is
    // the one thing always safe to focus.
    panelRef.current?.focus()

    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node
      if (panelRef.current?.contains(target)) return
      if (anchorRef.current?.contains(target)) return
      close()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      previouslyFocused.current?.focus()
    }
  }, [open])

  return (
    <>
      <div ref={anchorRef} className="contents">
        {children({ open, toggle })}
      </div>

      {placement &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label={label}
            tabIndex={-1}
            style={{
              left: placement.left,
              ...(placement.top !== undefined ? { top: placement.top } : {}),
              ...(placement.bottom !== undefined ? { bottom: placement.bottom } : {}),
            }}
            className="panel-raised fixed z-50 w-80 rounded-md p-3 outline-none"
          >
            {content({ close })}
          </div>,
          document.body,
        )}
    </>
  )
}
