import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import { cn } from '../../lib/cn'

export interface TabItem {
  id: string
  label: ReactNode
  badge?: ReactNode
  testId?: string
}

/**
 * Manual-activation tab strip: arrow keys and Home/End only move focus; Enter/Space (a native
 * button click) selects. Exactly one tab is in the tab order (roving tabindex).
 */
export function Tabs({
  idBase,
  value,
  onChange,
  items,
  ariaLabel,
  className,
  testId,
}: {
  idBase: string
  value: string
  onChange: (id: string) => void
  items: TabItem[]
  ariaLabel: string
  className?: string
  testId?: string
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({})

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number
    if (event.key === 'ArrowRight') next = (index + 1) % items.length
    else if (event.key === 'ArrowLeft') next = (index - 1 + items.length) % items.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = items.length - 1
    else return
    event.preventDefault()
    refs.current[items[next].id]?.focus()
  }

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      data-testid={testId}
      className={cn('flex flex-wrap gap-1.5', className)}
    >
      {items.map((item, index) => {
        const selected = item.id === value
        return (
          <button
            key={item.id}
            ref={(node) => {
              refs.current[item.id] = node
            }}
            type="button"
            role="tab"
            id={`${idBase}-tab-${item.id}`}
            aria-selected={selected}
            aria-controls={`${idBase}-panel-${item.id}`}
            tabIndex={selected ? 0 : -1}
            data-testid={item.testId}
            onClick={() => onChange(item.id)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              'flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-xs font-medium transition-colors duration-[--dur-fast]',
              selected
                ? 'bg-flame-900/30 text-flame-200'
                : 'text-ink-dim hover:bg-hover hover:text-ink',
            )}
          >
            {item.label}
            {item.badge}
          </button>
        )
      })}
    </div>
  )
}

export function TabPanel({
  idBase,
  tabId,
  children,
  className,
}: {
  idBase: string
  tabId: string
  children: ReactNode
  className?: string
}) {
  return (
    <div
      role="tabpanel"
      id={`${idBase}-panel-${tabId}`}
      aria-labelledby={`${idBase}-tab-${tabId}`}
      className={className}
    >
      {children}
    </div>
  )
}
