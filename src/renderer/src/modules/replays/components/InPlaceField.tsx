import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../../lib/cn'
import { Input, TextArea } from '../../../components/ui/controls'

export type FieldReason = { key: string; params?: Record<string, string | number> }
export type CommitResult = 'saved' | 'failed' | 'cancelled'

export interface InPlaceFieldProps {
  /** The on-disk text; the field follows it while the user has not typed. */
  value: string
  /** Resting text while not focused (e.g. a localised date); the typed text shows once focused. */
  display?: string
  placeholder: string
  /** Accessible name. */
  label: string
  multiline?: boolean
  readOnly?: boolean
  validate: (text: string) => FieldReason | null
  onCommit: (text: string) => Promise<CommitResult>
  testId: string
  /** `title` renders the field as the detail's heading; the default is body text. */
  size?: 'sm' | 'title'
}

// Important modifiers: the UI kit's base classes set the boxed look and `cn` does not merge conflicts.
const QUIET =
  'border-transparent! bg-transparent! hover:border-line-strong! focus:border-flame-600! ' +
  'focus:bg-void/60!'

/**
 * A fact that reads like text and edits in place: Enter (Ctrl+Enter when multiline) or leaving the
 * field commits a changed, valid text; Escape reverts. A refused text stays in the field with its
 * reason beneath it. (story 243)
 */
export function InPlaceField({
  value,
  display,
  placeholder,
  label,
  multiline,
  readOnly,
  validate,
  onCommit,
  testId,
  size = 'sm',
}: InPlaceFieldProps) {
  const { t } = useTranslation()
  const sizeClass = size === 'title' ? 'text-lg! font-semibold! h-10!' : 'text-sm'
  const errorId = useId()
  const [draft, setDraftState] = useState<string | null>(null)
  const [focused, setFocused] = useState(false)
  const [reason, setReason] = useState<FieldReason | null>(null)

  const latest = useRef({ draft, value, validate, onCommit })
  latest.current = { draft, value, validate, onCommit }
  const inFlight = useRef(false)

  const setDraft = (next: string | null): void => {
    latest.current.draft = next
    setDraftState(next)
  }

  const commit = async (): Promise<void> => {
    const { draft: text, value: onDisk, validate: check, onCommit: save } = latest.current
    if (text === null || inFlight.current) return
    if (text === onDisk) {
      setReason(null)
      setDraft(null)
      return
    }
    const refused = check(text)
    setReason(refused)
    if (refused !== null) return
    inFlight.current = true
    try {
      const result = await save(text)
      if ((result === 'saved' || result === 'cancelled') && latest.current.draft === text) {
        setDraft(null)
      }
    } finally {
      inFlight.current = false
    }
  }

  useEffect(
    () => () => {
      const { draft: text, value: onDisk, validate: check, onCommit: save } = latest.current
      if (text !== null && text !== onDisk && !inFlight.current && check(text) === null) {
        void save(text)
      }
    },
    [],
  )

  if (readOnly) {
    const shown = display ?? value
    return (
      <span
        className={cn('block truncate', sizeClass, shown === '' ? 'text-ink-faint' : 'text-ink')}
        data-testid={testId}
      >
        {shown === '' ? placeholder : shown}
      </span>
    )
  }

  const text = draft ?? value
  const shown = !focused && draft === null && display !== undefined ? display : text

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      setDraft(null)
      setReason(null)
    } else if (event.key === 'Enter' && (!multiline || event.ctrlKey)) {
      event.preventDefault()
      void commit()
    }
  }

  const shared = {
    value: shown,
    placeholder,
    'aria-label': label,
    'aria-invalid': reason !== null,
    'aria-describedby': reason !== null ? errorId : undefined,
    'data-testid': testId,
    onFocus: () => setFocused(true),
    onBlur: () => {
      setFocused(false)
      void commit()
    },
    onKeyDown,
  }

  return (
    <div className="min-w-0">
      {multiline ? (
        <TextArea
          {...shared}
          className={cn(QUIET, sizeClass)}
          onChange={(event) => setDraft(event.target.value)}
        />
      ) : (
        <Input
          {...shared}
          className={cn(QUIET, sizeClass)}
          onChange={(event) => setDraft(event.target.value)}
        />
      )}
      {reason !== null && (
        <p id={errorId} className="mt-1 text-xs text-danger" data-testid={`${testId}-error`}>
          {t(reason.key, reason.params)}
        </p>
      )}
    </div>
  )
}
