import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Link2 } from 'lucide-react'
import type { ConfigProfile } from '@shared/modules/config'
import { anchorRect } from '../../lib/anchor-rect'
import { cn } from '../../lib/cn'
import { useLauncher } from '../../store/useLauncher'
import { ProfileAssignmentsPanel } from './ProfileAssignmentsPanel'

/** Matches the `w-80` below. Known up front so no measurement is needed. */
const PANEL_WIDTH = 320
const GAP = 8
const EDGE = 8

interface Placement {
  left: number
  top?: number
  bottom?: number
}

/**
 * Header-anchored stand-in for the old "Assignments" tab: a compact
 * "N of M assigned" trigger that opens a portalled popover with the full
 * checkbox list, so assignment lives next to the profile's other header
 * actions instead of claiming a whole tab for what is usually a quick toggle.
 *
 * Positioning mirrors `Menu.tsx` - right-aligned to the trigger and flipped
 * above/below depending on which half of the window it sits in - so it never
 * needs a measure-then-reposition pass.
 */
export function AssignmentsMenu({
  profile,
  onChanged,
}: {
  profile: ConfigProfile
  onChanged: (profiles: ConfigProfile[]) => void
}) {
  const { t } = useTranslation()
  const installations = useLauncher((state) => state.installations)
  const anchorRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [placement, setPlacement] = useState<Placement | null>(null)
  const open = placement !== null

  const toggle = (): void => {
    if (open) {
      setPlacement(null)
      return
    }
    const anchor = anchorRect(anchorRef.current)
    if (!anchor) return

    const left = Math.max(
      EDGE,
      Math.min(anchor.right - PANEL_WIDTH, window.innerWidth - PANEL_WIDTH - EDGE),
    )
    const anchorMiddle = anchor.top + anchor.height / 2
    setPlacement(
      anchorMiddle < window.innerHeight / 2
        ? { left, top: Math.max(EDGE, anchor.bottom + GAP) }
        : { left, bottom: Math.max(EDGE, window.innerHeight - anchor.top + GAP) },
    )
  }

  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node
      if (panelRef.current?.contains(target)) return
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
    <div ref={anchorRef} className="contents">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className={cn(
          'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-sm border px-2.5 text-xs font-medium',
          'transition-colors duration-[--dur-fast]',
          open
            ? 'border-flame-300 bg-flame-900/30 text-flame-200'
            : 'border-line-strong bg-raised text-ink-dim hover:bg-hover hover:text-ink',
        )}
      >
        <Link2 className="size-3.5" />
        {t('config.assignment.summary', {
          count: profile.assignments.length,
          total: installations.length,
        })}
      </button>

      {placement &&
        createPortal(
          <div
            ref={panelRef}
            style={{
              left: placement.left,
              ...(placement.top !== undefined ? { top: placement.top } : {}),
              ...(placement.bottom !== undefined ? { bottom: placement.bottom } : {}),
              maxHeight: `calc(100vh - ${EDGE * 2}px)`,
            }}
            className="panel-raised fixed z-50 w-80 overflow-y-auto rounded-md p-3"
          >
            <ProfileAssignmentsPanel profile={profile} onChanged={onChanged} />
          </div>,
          document.body,
        )}
    </div>
  )
}
