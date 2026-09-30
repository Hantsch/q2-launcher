import { useRef, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Star } from 'lucide-react'
import { cn } from '../../../lib/cn'

const STARS = Array.from({ length: 10 }, (_, index) => index + 1)

export interface StarRatingProps {
  value: number | null
  onChange: (value: number | null) => void
  disabled?: boolean
  /** Id of the visible text that says why the control is disabled. */
  describedBy?: string
  label: string
}

/** Story 179 D3: a 1-10 star radio group. Clicking the current star clears it. */
export function StarRating({ value, onChange, disabled = false, describedBy, label }: StarRatingProps) {
  const { t } = useTranslation()
  const buttons = useRef<Array<HTMLButtonElement | null>>([])
  const tabStop = value ?? 1

  const move = (next: number | null) => {
    onChange(next)
    // Focus follows the new value straight away; the roving tabindex catches up on re-render.
    buttons.current[(next ?? 1) - 1]?.focus()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        move(Math.min((value ?? 0) + 1, 10))
        break
      case 'ArrowLeft':
      case 'ArrowDown':
        move(Math.max((value ?? 2) - 1, 1))
        break
      case 'Home':
        move(1)
        break
      case 'End':
        move(10)
        break
      case 'Delete':
      case 'Backspace':
        move(null)
        break
      default:
        return
    }
    event.preventDefault()
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-describedby={disabled ? describedBy : undefined}
      data-testid="replays-detail-rating"
      className="inline-flex items-center"
      onKeyDown={onKeyDown}
    >
      {STARS.map((n) => (
        <button
          key={n}
          ref={(node) => {
            buttons.current[n - 1] = node
          }}
          type="button"
          role="radio"
          aria-checked={n === value}
          aria-label={t('replays.detail.rating.star', { count: n })}
          aria-describedby={disabled ? describedBy : undefined}
          disabled={disabled}
          tabIndex={n === tabStop ? 0 : -1}
          onClick={() => onChange(n === value ? null : n)}
          data-testid={`replays-detail-rating-star-${n}`}
          className={cn(
            'inline-flex size-7 items-center justify-center rounded-sm',
            'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-flame-500',
            'disabled:pointer-events-none disabled:opacity-45',
          )}
        >
          <Star
            className={cn('size-4', value !== null && n <= value ? 'fill-flame-500 text-flame-500' : 'text-ink-muted')}
            aria-hidden="true"
          />
        </button>
      ))}
    </div>
  )
}
