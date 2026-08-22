import {
  createContext,
  useContext,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react'
import { Check, ChevronDown, FolderOpen } from 'lucide-react'
import { cn } from '../../lib/cn'
import { Button } from './Button'

const FIELD_BASE =
  'h-9 w-full rounded-sm border border-line-strong bg-void/60 px-2.5 text-sm text-ink ' +
  'placeholder:text-ink-faint focus:border-flame-600 focus:outline-none ' +
  'transition-colors duration-[--dur-fast] disabled:opacity-50'

/**
 * The id a `Field` minted for the control it wraps.
 *
 * `Field`'s `<label>` is a *sibling* of the control, not a wrapper, so without a
 * matching id the control has no accessible name at all - axe's `label` and
 * `select-name` both fire (story 037 D6). Passing `htmlFor` per call site was
 * the existing escape hatch, but only 2 of 30+ `Field` uses did it, so the id
 * is generated here instead and adopted by whichever control renders inside.
 * Every `Field` in the app holds exactly one control, so one id per `Field` is
 * enough; a control that carries its own `id` always keeps it.
 */
const FieldControlIdContext = createContext<string | undefined>(undefined)

/** The control's own `id` if it has one, else the enclosing `Field`'s. */
function useControlId(id?: string): string | undefined {
  const fieldControlId = useContext(FieldControlIdContext)
  return id ?? fieldControlId
}

export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
  className,
}: {
  label: string
  hint?: string
  error?: string
  htmlFor?: string
  children: ReactNode
  className?: string
}) {
  const generatedId = useId()
  const controlId = htmlFor ?? generatedId
  return (
    <div className={cn('space-y-1.5', className)}>
      <label className="stencil block" htmlFor={controlId}>
        {label}
      </label>
      <FieldControlIdContext.Provider value={controlId}>{children}</FieldControlIdContext.Provider>
      {error ? (
        <p className="text-xs text-danger">{error}</p>
      ) : (
        hint && <p className="text-xs leading-relaxed text-ink-muted">{hint}</p>
      )}
    </div>
  )
}

export function Input({ className, id, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input id={useControlId(id)} className={cn(FIELD_BASE, className)} {...rest} />
}

/** Read-only path display with a Browse button - the shape every file picker uses. */
export function PathPicker({
  value,
  placeholder,
  onBrowse,
  browseLabel,
  disabled,
  id,
}: {
  value: string
  placeholder?: string
  onBrowse: () => void
  browseLabel: string
  disabled?: boolean
  id?: string
}) {
  return (
    <div className="flex gap-2">
      <input
        id={useControlId(id)}
        readOnly
        value={value}
        placeholder={placeholder}
        className={cn(FIELD_BASE, 'numeric cursor-default text-xs')}
        title={value}
        data-selectable
      />
      <Button
        variant="neutral"
        onClick={onBrowse}
        disabled={disabled}
        icon={<FolderOpen className="size-3.5" />}
      >
        {browseLabel}
      </Button>
    </div>
  )
}

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

export function Select({
  options,
  className,
  id,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { options: SelectOption[] }) {
  return (
    <div className="relative">
      <select
        id={useControlId(id)}
        className={cn(FIELD_BASE, 'cursor-pointer appearance-none pr-8', className)}
        {...rest}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-ink-muted" />
    </div>
  )
}

export function Switch({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  hint?: string
  disabled?: boolean
}) {
  const id = useId()
  return (
    <div className="flex items-start justify-between gap-6 py-2">
      <div className="min-w-0 space-y-0.5">
        <label htmlFor={id} className="block text-sm text-ink">
          {label}
        </label>
        {hint && <p className="text-xs leading-relaxed text-ink-muted">{hint}</p>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative mt-0.5 h-5 w-9 shrink-0 rounded-full border transition-colors duration-[--dur-fast]',
          checked ? 'border-flame-600 bg-flame-700' : 'border-line-strong bg-void',
          disabled && 'pointer-events-none opacity-45',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 size-3.5 rounded-full transition-[left] duration-[--dur-fast] ease-[--ease-out-quart]',
            checked ? 'left-4.5 bg-flame-200' : 'left-0.5 bg-ink-muted',
          )}
        />
      </button>
    </div>
  )
}

export function Checkbox({
  checked,
  onChange,
  label,
  disabled,
  className,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: ReactNode
  disabled?: boolean
  className?: string
}) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-center gap-2.5 text-sm text-ink',
        disabled && 'pointer-events-none opacity-45',
        className,
      )}
    >
      <span
        className={cn(
          'grid size-4 shrink-0 place-items-center rounded-xs border transition-colors duration-[--dur-fast]',
          checked ? 'border-flame-400 bg-flame-500' : 'border-line-strong bg-void',
        )}
      >
        {checked && <Check className="size-3 text-flame-ink" strokeWidth={3} />}
      </span>
      <input
        type="checkbox"
        className="sr-only"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="min-w-0">{label}</span>
    </label>
  )
}
