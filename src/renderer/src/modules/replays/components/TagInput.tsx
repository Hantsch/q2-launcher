import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { cn } from '../../../lib/cn'
import { IconButton } from '../../../components/ui/Button'

export interface TagInputProps {
  tags: string[]
  /** Already computed by the caller (via `suggestTags`) for the current input text - this
   * component is presentational/interaction-only, never the source of the ranking logic. */
  suggestions: string[]
  disabled?: boolean
  onAddTag: (tag: string) => void
  onRemoveTag: (tag: string) => void
  onInputChange: (text: string) => void
  /** A refused tag stays in the input with the returned reason shown beneath it. */
  validate?: (tag: string) => { key: string; params?: Record<string, string | number> } | null
}

/**
 * Story 155: a module-local ARIA combobox for the sidecar's free-form tags - no shared atom exists
 * for this shape, and this is its only user. ArrowDown/ArrowUp move a highlighted suggestion, Enter
 * picks the highlighted one (or commits the typed text if none is highlighted), comma also commits
 * the typed text, Escape closes the list.
 */
export function TagInput({
  tags,
  suggestions,
  disabled,
  onAddTag,
  onRemoveTag,
  onInputChange,
  validate,
}: TagInputProps) {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const [highlighted, setHighlighted] = useState(-1)
  const [reason, setReason] = useState<{ key: string; params?: Record<string, string | number> }>()
  const reasonId = useId()
  const listboxId = useId()

  const commit = (value: string): void => {
    const trimmed = value.trim()
    const refused = trimmed === '' ? null : validate?.(trimmed)
    if (refused) {
      setText(value)
      setReason(refused)
      setOpen(false)
      setHighlighted(-1)
      return
    }
    setReason(undefined)
    setText('')
    onInputChange('')
    setOpen(false)
    setHighlighted(-1)
    if (trimmed === '') return
    onAddTag(trimmed)
  }

  const pickHighlightedOrText = (): void => {
    if (highlighted >= 0 && highlighted < suggestions.length) {
      commit(suggestions[highlighted]!)
    } else {
      commit(text)
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1.5">
        {tags.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 rounded-full border border-line-strong px-2 py-0.5 text-xs text-ink"
            data-testid="replays-tag-chip"
          >
            {tag}
            <IconButton
              label={t('replays.editor.tags.remove', { tag })}
              size="sm"
              variant="ghost"
              className="size-4 border-0"
              disabled={disabled}
              onClick={() => onRemoveTag(tag)}
            >
              <X className="size-3" aria-hidden="true" />
            </IconButton>
          </span>
        ))}
      </div>

      <div className="relative">
        <input
          role="combobox"
          aria-expanded={open && suggestions.length > 0}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-invalid={reason !== undefined}
          aria-describedby={reason !== undefined ? reasonId : undefined}
          aria-activedescendant={
            open && highlighted >= 0 ? `${listboxId}-option-${highlighted}` : undefined
          }
          value={text}
          disabled={disabled}
          placeholder={t('replays.editor.tags.placeholder')}
          className={cn(
            'h-9 w-full rounded-sm border border-line-strong bg-void/60 px-2.5 text-sm text-ink',
            'placeholder:text-ink-faint focus:border-flame-600 focus:outline-none',
            'transition-colors duration-[--dur-fast] disabled:opacity-50',
          )}
          data-testid="replays-tag-input"
          onChange={(event) => {
            const value = event.target.value
            if (value.endsWith(',')) {
              commit(value.slice(0, -1))
              return
            }
            setText(value)
            setReason(undefined)
            setOpen(true)
            setHighlighted(-1)
            onInputChange(value)
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              if (suggestions.length === 0) return
              setOpen(true)
              setHighlighted((prev) => (prev + 1) % suggestions.length)
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              if (suggestions.length === 0) return
              setOpen(true)
              setHighlighted((prev) => (prev <= 0 ? suggestions.length - 1 : prev - 1))
            } else if (event.key === 'Enter') {
              event.preventDefault()
              pickHighlightedOrText()
            } else if (event.key === 'Escape') {
              setOpen(false)
              setHighlighted(-1)
            }
          }}
        />
        {open && suggestions.length > 0 && (
          <ul
            role="listbox"
            id={listboxId}
            className="absolute z-10 mt-1 w-full rounded-sm border border-line-strong bg-panel shadow-lg"
          >
            {suggestions.map((suggestion, index) => (
              <li
                key={suggestion}
                id={`${listboxId}-option-${index}`}
                role="option"
                aria-selected={index === highlighted}
                data-testid="replays-tag-option"
                className={cn(
                  'cursor-pointer px-2.5 py-1.5 text-sm text-ink',
                  index === highlighted && 'bg-hover',
                )}
                onMouseDown={(event) => {
                  event.preventDefault()
                  commit(suggestion)
                }}
              >
                {suggestion}
              </li>
            ))}
          </ul>
        )}
      </div>
      {reason !== undefined && (
        <p id={reasonId} className="text-xs text-danger" data-testid="replays-tag-error">
          {t(reason.key, reason.params)}
        </p>
      )}
    </div>
  )
}
