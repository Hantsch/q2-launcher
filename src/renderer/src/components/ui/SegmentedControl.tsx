import { Button } from './Button'

export interface SegmentedOption<V extends string> {
  value: V
  label: string
  testId?: string
}

/** Exclusive choice rendered as a row of toggle buttons. */
export function SegmentedControl<V extends string>({
  label,
  options,
  value,
  onChange,
  disabled,
}: {
  label: string
  options: readonly SegmentedOption<V>[]
  value: V
  onChange: (value: V) => void
  disabled?: boolean
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1.5">
      {options.map((o) => (
        <Button
          key={o.value}
          variant={value === o.value ? 'primary' : 'neutral'}
          size="sm"
          aria-pressed={value === o.value}
          disabled={disabled}
          onClick={() => onChange(o.value)}
          data-testid={o.testId}
        >
          {o.label}
        </Button>
      ))}
    </div>
  )
}
