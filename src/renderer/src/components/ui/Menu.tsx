import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { anchorRect } from '../../lib/anchor-rect'
import { cn } from '../../lib/cn'

/** Matches the `w-64` below. Known up front so no measurement is needed. */
const MENU_WIDTH = 256
const GAP = 8
const EDGE = 8

export interface MenuItem {
  id: string
  label: string
  icon?: ReactNode
  hint?: string
  disabled?: boolean
  onSelect: () => void
}

interface Placement {
  left: number
  top?: number
  bottom?: number
}

/**
 * Click-to-open menu, portalled for the same reason as `HoverCard`: its trigger
 * lives inside a scrolling rail that would clip it.
 *
 * Positioned from the anchor alone, top- or bottom-anchored depending on which
 * half of the window the trigger sits in, so it never needs to measure itself
 * and never lands off-screen.
 */
export function Menu({
  items,
  children,
  side = 'right',
  label,
}: {
  items: MenuItem[]
  /** Render prop for the trigger; receives the open state. */
  children: (props: { open: boolean; toggle: () => void }) => ReactNode
  side?: 'right' | 'below'
  label: string
}) {
  const anchorRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [placement, setPlacement] = useState<Placement | null>(null)
  const open = placement !== null

  const toggle = (): void => {
    if (open) {
      setPlacement(null)
      return
    }
    // The wrapper is `display: contents`, so measure the trigger itself.
    const anchor = anchorRect(anchorRef.current)
    if (!anchor) return

    let left = side === 'right' ? anchor.right + GAP : anchor.left
    if (left + MENU_WIDTH > window.innerWidth - EDGE) {
      left = Math.max(EDGE, anchor.left - MENU_WIDTH - GAP)
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

    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node
      if (menuRef.current?.contains(target)) return
      if (anchorRef.current?.contains(target)) return
      setPlacement(null)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setPlacement(null)
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
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
            ref={menuRef}
            role="menu"
            aria-label={label}
            style={{
              left: placement.left,
              ...(placement.top !== undefined ? { top: placement.top } : {}),
              ...(placement.bottom !== undefined ? { bottom: placement.bottom } : {}),
            }}
            className="panel-raised fixed z-50 w-64 rounded-md p-1"
          >
            {items.map((item) => (
              <button
                key={item.id}
                role="menuitem"
                type="button"
                disabled={item.disabled}
                onClick={() => {
                  setPlacement(null)
                  item.onSelect()
                }}
                className={cn(
                  'flex w-full items-start gap-2.5 rounded-sm px-2.5 py-2 text-left',
                  'transition-colors duration-[--dur-fast]',
                  item.disabled ? 'pointer-events-none text-ink-faint' : 'text-ink hover:bg-hover',
                )}
              >
                {item.icon && <span className="mt-0.5 shrink-0 text-ink-dim">{item.icon}</span>}
                <span className="min-w-0">
                  <span className="block truncate text-sm">{item.label}</span>
                  {item.hint && (
                    <span className="mt-0.5 block text-xs leading-snug text-ink-muted">
                      {item.hint}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  )
}
