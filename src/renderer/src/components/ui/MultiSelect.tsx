import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
} from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/cn'
import { FIELD_BASE } from './controls'

const MAX_LISTED_CHARS = 24

export interface MultiSelectOption {
  value: string
  label: string
  /** 1 = a child of the nearest preceding level-0 option. */
  level?: 0 | 1
  /** While this value is checked the option shows checked and cannot be toggled. */
  impliedBy?: string
}

export interface MultiSelectProps {
  label: string
  options: readonly (string | MultiSelectOption)[]
  value: string[]
  onChange: (next: string[]) => void
  summaryCount: (n: number) => string
  /** Shows a text field above the list that narrows rows by label. */
  filterable?: boolean
  filterLabel?: string
  'data-testid'?: string
}

interface Row {
  value: string
  label: string
  level: 0 | 1
  impliedBy?: string
}

const sameName = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

const toRow = (option: string | MultiSelectOption): Row =>
  typeof option === 'string'
    ? { value: option, label: option, level: 0 }
    : { ...option, level: option.level ?? 0 }

/**
 * Keeps a level-0 row while its own label or one of its level-1 rows matches; a matching
 * level-0 row keeps all its children so the group stays readable.
 */
function filterRows(rows: readonly Row[], query: string): Row[] {
  const q = query.toLowerCase()
  const hit = (row: Row): boolean => row.label.toLowerCase().includes(q)
  const out: Row[] = []
  let i = 0
  while (i < rows.length) {
    const head = rows[i]
    if (head.level === 1) {
      if (hit(head)) out.push(head)
      i++
      continue
    }
    let end = i + 1
    while (end < rows.length && rows[end].level === 1) end++
    const children = rows.slice(i + 1, end)
    if (hit(head)) out.push(head, ...children)
    else {
      const matching = children.filter(hit)
      if (matching.length > 0) out.push(head, ...matching)
    }
    i = end
  }
  return out
}

export function MultiSelect({
  label,
  options,
  value,
  onChange,
  summaryCount,
  filterable = false,
  filterLabel,
  'data-testid': testId,
}: MultiSelectProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const baseId = useId()
  const listId = `${baseId}-list`

  const isChecked = (name: string): boolean => value.some((v) => sameName(v, name))
  const isImplied = ({ impliedBy }: Row): boolean => impliedBy !== undefined && isChecked(impliedBy)

  // A selected value the source no longer offers stays visible so it can be unchecked.
  const rendered = useMemo(() => {
    const rows = options.map(toRow)
    const missing = value
      .filter((v) => !rows.some((r) => sameName(r.value, v)))
      .map((v): Row => ({ value: v, label: v, level: 0 }))
    return [...rows, ...missing]
  }, [options, value])
  const visible = useMemo(
    () => (filterable && query !== '' ? filterRows(rendered, query) : rendered),
    [filterable, query, rendered],
  )
  const selected = rendered.filter((r) => isChecked(r.value))
  // `active` may point past the end after the filter narrows the rows.
  const current = visible.length === 0 ? -1 : Math.min(Math.max(active, 0), visible.length - 1)

  const summary = (() => {
    if (selected.length === 0) return t('common.label.any')
    if (selected.length === 1) return selected[0].label
    const joined = selected.map((r) => r.label).join(', ')
    return joined.length <= MAX_LISTED_CHARS ? joined : summaryCount(selected.length)
  })()

  useEffect(() => {
    if (!open || current < 0) return
    const el = listRef.current?.children[current]
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' })
  }, [open, current])

  const toggle = (row: Row): void => {
    if (isImplied(row)) return
    onChange(
      isChecked(row.value) ? value.filter((v) => !sameName(v, row.value)) : [...value, row.value],
    )
  }

  const openPanel = (): void => {
    const first = rendered.findIndex((r) => isChecked(r.value))
    setActive(first >= 0 ? first : 0)
    setOpen(true)
    queueMicrotask(() => listRef.current?.focus())
  }

  const closePanel = (): void => {
    setOpen(false)
    setQuery('')
  }

  const closeToTrigger = (): void => {
    closePanel()
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
    const last = visible.length - 1
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setActive(Math.max(Math.min(current + 1, last), 0))
        break
      case 'ArrowUp':
        e.preventDefault()
        setActive(Math.max(current - 1, 0))
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
        if (current >= 0) toggle(visible[current])
        break
      case 'Escape':
        e.preventDefault()
        closeToTrigger()
        break
      case 'Tab':
        closePanel()
        break
      case 'Backspace':
        if (filterable) {
          e.preventDefault()
          setQuery((q) => q.slice(0, -1))
        }
        break
      default:
        // Type-to-filter keeps focus on the list, so arrows and Space keep working.
        if (filterable && e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
          e.preventDefault()
          setQuery((q) => q + e.key)
        }
    }
  }

  const onFilterKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown' || e.key === 'Enter') {
      e.preventDefault()
      listRef.current?.focus()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      closeToTrigger()
    }
  }

  const onBlur = (e: FocusEvent<HTMLDivElement>): void => {
    const next = e.relatedTarget as Node | null
    if (!next || !rootRef.current?.contains(next)) closePanel()
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
          onClick={() => (open ? closePanel() : openPanel())}
          onKeyDown={onTriggerKey}
        >
          <span className="block truncate">{summary}</span>
        </button>
        <ChevronDown className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-ink-muted" />
      </div>
      {open && filterable ? (
        <input
          type="text"
          value={query}
          aria-label={filterLabel}
          aria-controls={listId}
          data-testid={testId ? `${testId}-filter` : undefined}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onFilterKey}
          className="mt-1 h-7 w-full rounded-sm border border-line-strong bg-void/60 px-2.5 text-sm text-ink placeholder:text-ink-faint focus-visible:border-flame-600 focus-visible:ring-2 focus-visible:ring-flame-600 focus-visible:outline-none"
        />
      ) : null}
      {open ? (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-multiselectable="true"
          aria-label={label}
          aria-activedescendant={current >= 0 ? `${baseId}-opt-${current}` : undefined}
          tabIndex={0}
          onKeyDown={onListKey}
          className="mt-1 max-h-60 overflow-y-auto rounded-sm border border-line-strong bg-void/60 py-1 focus-visible:ring-2 focus-visible:ring-flame-600 focus-visible:outline-none"
        >
          {visible.map((row, i) => {
            const implied = isImplied(row)
            const checked = implied || isChecked(row.value)
            return (
              <li
                key={`${i}-${row.value.toLowerCase()}`}
                id={`${baseId}-opt-${i}`}
                role="option"
                aria-selected={checked}
                aria-disabled={implied ? 'true' : undefined}
                data-testid={testId ? `${testId}-option` : undefined}
                // Keeps focus on the listbox so a click does not trigger focusout.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setActive(i)
                  toggle(row)
                }}
                className={cn(
                  'flex min-h-7 items-center gap-2 text-sm hover:bg-void',
                  row.level === 1 ? 'pr-2.5 pl-8' : 'px-2.5',
                  implied ? 'cursor-default text-ink-muted' : 'cursor-pointer text-ink',
                  i === current && 'bg-void outline outline-1 -outline-offset-1 outline-flame-600',
                )}
              >
                <span className="flex size-4 shrink-0 items-center justify-center">
                  {checked ? <Check className="size-4" aria-hidden="true" /> : null}
                </span>
                <span className="truncate">{row.label}</span>
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
