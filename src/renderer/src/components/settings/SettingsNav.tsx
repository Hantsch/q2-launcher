import { useEffect, useRef, useState, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/cn'

export interface SettingsNavItem {
  /** DOM id of the section this entry scrolls to. */
  id: string
  label: string
}

export interface SettingsNavProps {
  items: readonly SettingsNavItem[]
  /** The scroll container the sections live in - watched to highlight the section in view. */
  scrollRootRef: RefObject<HTMLElement | null>
}

/** How far below the top of the view a section's top may sit and still count as current. */
const ACTIVE_OFFSET_PX = 96

/**
 * Settings' sticky table of contents: one entry per section, the one currently in view marked
 * (`aria-current` plus a flame bar and brighter text - never colour alone). Clicking an entry
 * scrolls its section to the top of the view.
 */
export function SettingsNav({ items, scrollRootRef }: SettingsNavProps) {
  const { t } = useTranslation()
  const [activeId, setActiveId] = useState(items[0]?.id)
  const jumpingRef = useRef(false)
  const idsKey = items.map((item) => item.id).join('|')

  useEffect(() => {
    const root = scrollRootRef.current
    if (!root) return
    const sectionIds = idsKey.split('|')
    const handleScroll = (): void => {
      // A jump from this nav already set its own target; the scroll it causes must not override
      // that (a short last section can never reach the top of the view).
      if (jumpingRef.current) {
        jumpingRef.current = false
        return
      }
      // The current section is the last one whose top has scrolled past the top of the view (plus
      // a little slack), or the last section outright once the view is scrolled to the bottom.
      const threshold = root.getBoundingClientRect().top + ACTIVE_OFFSET_PX
      let current = sectionIds[0]
      for (const id of sectionIds) {
        const top = document.getElementById(id)?.getBoundingClientRect().top
        if (top !== undefined && top <= threshold) current = id
      }
      if (root.scrollTop + root.clientHeight >= root.scrollHeight - 1) {
        current = sectionIds[sectionIds.length - 1]
      }
      setActiveId(current)
    }
    root.addEventListener('scroll', handleScroll, { passive: true })
    return () => root.removeEventListener('scroll', handleScroll)
  }, [idsKey, scrollRootRef])

  function jumpTo(id: string): void {
    setActiveId(id)
    const root = scrollRootRef.current
    const before = root?.scrollTop
    document.getElementById(id)?.scrollIntoView({ block: 'start' })
    // Only swallow the next scroll event if this jump actually moved the view.
    jumpingRef.current = root !== null && root.scrollTop !== before
  }

  return (
    <nav aria-label={t('settings.nav.label')} data-testid="settings-nav">
      <ul className="space-y-0.5">
        {items.map((item) => {
          const active = item.id === activeId
          return (
            <li key={item.id}>
              <button
                type="button"
                aria-current={active ? 'true' : undefined}
                onClick={() => jumpTo(item.id)}
                className={cn(
                  'flex h-8 w-full items-center rounded-sm border-l-2 px-2.5 text-left text-sm',
                  'transition-colors duration-[--dur-fast]',
                  active
                    ? 'border-flame-500 bg-hover font-medium text-ink'
                    : 'border-transparent text-ink-dim hover:bg-hover hover:text-ink',
                )}
              >
                <span className="truncate">{item.label}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
