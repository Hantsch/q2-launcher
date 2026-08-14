import { useCallback, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { anchorRect } from '../../lib/anchor-rect'
import { cn } from '../../lib/cn'

/** Matches the `w-72` below. Known up front so no measurement is needed. */
const CARD_WIDTH = 288
const GAP = 10
const EDGE = 8

interface Placement {
  left: number
  /** Exactly one of these is set, which is what keeps the card on screen. */
  top?: number
  bottom?: number
}

/**
 * Hover/focus card, rendered in a portal.
 *
 * A portal rather than an absolutely positioned child, because the installation
 * rail is a scroll container: `overflow-y: auto` clips horizontal overflow, so an
 * in-flow popover would be cut off at the rail's edge.
 *
 * Placement is computed from the anchor alone - the card's width is known from
 * its class, and it is anchored by its top edge in the upper half of the screen
 * and by its bottom edge in the lower half. That removes any need to measure the
 * card, so there is no two-pass render and no way for a missed measurement to
 * leave the card stranded off-screen.
 *
 * Opens on pointer hover and on keyboard focus, so the rail is fully usable
 * without a mouse.
 */
export function HoverCard({
  content,
  children,
  openDelay = 140,
  closeDelay = 90,
  className,
}: {
  content: ReactNode
  children: ReactNode
  openDelay?: number
  closeDelay?: number
  className?: string
}) {
  const anchorRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<number | null>(null)
  const [placement, setPlacement] = useState<Placement | null>(null)

  const clearTimer = (): void => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  const open = useCallback(
    (immediate = false) => {
      clearTimer()
      const show = (): void => {
        const anchor = anchorRect(anchorRef.current)
        if (!anchor) return

        // Prefer the right side; flip left if the card would not fit.
        let left = anchor.right + GAP
        if (left + CARD_WIDTH > window.innerWidth - EDGE) {
          left = Math.max(EDGE, anchor.left - CARD_WIDTH - GAP)
        }

        const inUpperHalf = anchor.top + anchor.height / 2 < window.innerHeight / 2
        setPlacement(
          inUpperHalf
            ? { left, top: Math.max(EDGE, anchor.top) }
            : { left, bottom: Math.max(EDGE, window.innerHeight - anchor.bottom) },
        )
      }
      if (immediate || openDelay === 0) show()
      else timerRef.current = window.setTimeout(show, openDelay)
    },
    [openDelay],
  )

  const close = useCallback(() => {
    clearTimer()
    timerRef.current = window.setTimeout(() => setPlacement(null), closeDelay)
  }, [closeDelay])

  return (
    <>
      <div
        ref={anchorRef}
        // Pointer events cover mouse, pen and touch; the mouse pair is kept as a
        // belt-and-braces fallback for synthetic events that only emulate mouse.
        onPointerEnter={() => open()}
        onPointerLeave={close}
        onMouseEnter={() => open()}
        onMouseLeave={close}
        onFocusCapture={() => open(true)}
        onBlurCapture={close}
        className={className}
      >
        {children}
      </div>

      {placement &&
        createPortal(
          <div
            role="tooltip"
            onPointerEnter={clearTimer}
            onPointerLeave={close}
            style={{
              left: placement.left,
              ...(placement.top !== undefined ? { top: placement.top } : {}),
              ...(placement.bottom !== undefined ? { bottom: placement.bottom } : {}),
              maxHeight: `calc(100vh - ${EDGE * 2}px)`,
            }}
            className={cn('panel-raised fixed z-40 w-72 overflow-y-auto rounded-md p-3')}
          >
            {content}
          </div>,
          document.body,
        )}
    </>
  )
}
