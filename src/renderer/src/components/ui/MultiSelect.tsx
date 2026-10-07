import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/cn'
import { FIELD_BASE } from './controls'

const MAX_LISTED_CHARS = 24

export interface MultiSelectProps {
  label: string
  options: string[]
  value: string[]
  onChange: (next: string[]) => void
  summaryCount: (n: number) => string
  'data-testid'?: string
}

const sameName = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

export function MultiSelect({
  label,
  options,
  value,
  onChange,
  summaryCount,
  'data-testid': testId,
}: MultiSelectProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const baseId = useId()
  const listId = `${baseId}-list`

  // A selected value the source no longer offers stays visible so it can be unchecked.
  const rendered = [...options, ...value.filter((v) => !options.some((o) => sameName(o, v)))]
  const isChecked = (name: string): boolean => value.some((v) => sameName(v, name))
  const selected = rendered.filter(isChecked)

  const summary = (() => {
    if (selected.length === 0) return t('common.label.any')
    if (selected.length === 1) return selected[0]
    const joined = selected.join(', ')
    return joined.length <= MAX_LISTED_CHARS ? joined : summaryCount(selected.length)
  })()

  useEffect(() => {
    if (!open) return
    const el = listRef.current?.children[active]
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' })
  }, [open, active])

  const toggle = (name: string): void => {
    onChange(isChecked(name) ? value.filter((v) => !sameName(v, name)) : [...value, name])
  }

  const openPanel = (): void => {
    const first = rendered.findIndex(isChecked)
    setActive(first >= 0 ? first : 0)
    setOpen(true)
    queueMicrotask(() => listRef.current?.focus())
  }

  const closeToTrigger = (): void => {
    setOpen(false)
    triggerRef.current?.focus()
  }

  const onTriggerKey = (e: KeyboardEvent<HTMLButtonElement>): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!open) openPanel()
    } else if (e.key === 'Enter' && !open) {
      e.preventDefault()
      openPanel()
    }
  }

  const onListKey = (e: KeyboardEvent<HTMLUListElement>): void => {
    const last = rendered.length - 1
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setActive((i) => Math.min(i + 1, last))
        break
      case 'ArrowUp':
        e.preventDefault()
        setActive((i) => Math.max(i - 1, 0))
        break
      case 'Home':
        e.preventDefault()
        setActive(0)
        break
      case 'End':
        e.preventDefault()
        setActive(Math.max(last, 0))
        break
      case ' ':
      case 'Enter':
        e.preventDefault()
        if (rendered[active] !== undefined) toggle(rendered[active])
        break
      case 'Escape':
        e.preventDefault()
        closeToTrigger()
        break
      case 'Tab':
        setOpen(false)
        break
    }
  }

  const onBlur = (e: FocusEvent<HTMLDivElement>): void => {
    const next = e.relatedTarget as Node | null
    if (!next || !rootRef.current?.contains(next)) setOpen(false)
  }

  return (
    <div ref={rootRef} onBlur={onBlur}>
      <div className="relative">
        <button
          ref={triggerRef}
          type="button"
          aria-label={`${label}: ${summary}`}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listId}
          data-testid={testId}
          className={cn(
            FIELD_BASE,
            'cursor-pointer truncate pr-8 text-left focus-visible:ring-2 focus-visible:ring-flame-600',
          )}
          onClick={() => (open ? setOpen(false) : openPanel())}
          onKeyDown={onTriggerKey}
        >
          <span className="block truncate">{summary}</span>
        </button>
        <ChevronDown className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-ink-muted" />
      </div>
      {open ? (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-multiselectable="true"
          aria-label={label}
          aria-activedescendant={
            rendered.length > 0
              ? `${baseId}-opt-${Math.min(active, rendered.length - 1)}`
              : undefined
          }
          tabIndex={0}
          onKeyDown={onListKey}
          className="mt-1 max-h-60 overflow-y-auto rounded-sm border border-line-strong bg-void/60 py-1 focus-visible:ring-2 focus-visible:ring-flame-600 focus-visible:outline-none"
        >
          {rendered.map((name, i) => {
            const checked = isChecked(name)
            return (
              <li
                key={`${i}-${name.toLowerCase()}`}
                id={`${baseId}-opt-${i}`}
                role="option"
                aria-selected={checked}
                data-testid={testId ? `${testId}-option` : undefined}
                // Keeps focus on the listbox so a click does not trigger focusout.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setActive(i)
                  toggle(name)
                }}
                className={cn(
                  'flex min-h-7 cursor-pointer items-center gap-2 px-2.5 text-sm text-ink hover:bg-void',
                  i === active && 'bg-void outline outline-1 -outline-offset-1 outline-flame-600',
                )}
              >
                <span className="flex size-4 shrink-0 items-center justify-center">
                  {checked ? <Check className="size-4" aria-hidden="true" /> : null}
                </span>
                <span className="truncate">{name}</span>
              </li>
            )
          })}
        </ul>
      ) : null}
      <span role="status" aria-live="polite" className="sr-only">
        {t('common.label.selectedCount', { count: selected.length })}
      </span>
    </div>
  )
}
