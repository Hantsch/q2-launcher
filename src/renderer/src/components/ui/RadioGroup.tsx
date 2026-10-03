import { createContext, useContext, type ReactNode } from 'react'

interface RadioGroupState {
  name: string
  value: string
  onChange: (value: string) => void
}

const RadioGroupContext = createContext<RadioGroupState | null>(null)

/** Radios share one `name`, so the browser provides arrow-key movement and the single tab stop. */
export function RadioGroup({
  name,
  value,
  onChange,
  label,
  children,
}: RadioGroupState & { label: string; children: ReactNode }) {
  return (
    <RadioGroupContext.Provider value={{ name, value, onChange }}>
      <div role="radiogroup" aria-label={label} className="space-y-1.5">
        {children}
      </div>
    </RadioGroupContext.Provider>
  )
}

export function Radio({
  value,
  label,
  testId,
  disabled,
}: {
  value: string
  label: ReactNode
  testId?: string
  disabled?: boolean
}) {
  const group = useContext(RadioGroupContext)
  if (!group) throw new Error('Radio must be rendered inside a RadioGroup')
  return (
    <label className="flex items-center gap-2 text-sm text-ink-dim">
      <input
        type="radio"
        name={group.name}
        value={value}
        checked={group.value === value}
        onChange={() => group.onChange(value)}
        disabled={disabled}
        data-testid={testId}
        className="size-4 accent-flame-500 focus-visible:ring-2 focus-visible:ring-flame-500 focus-visible:outline-none disabled:opacity-50"
      />
      {label}
    </label>
  )
}
