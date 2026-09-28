import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  isRangeOrderValid,
  normalizeDateRange,
  type DateRangePreset,
  type DateRangeValue,
} from '@shared/date-range'
import { Popover } from './Popover'
import { Button } from './Button'
import { Field, Input } from './controls'

const dateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })

function formatIsoDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number)
  return dateFormatter.format(new Date(year, month - 1, day))
}

interface Draft {
  from: string
  to: string
}

const BLANK_DRAFT: Draft = { from: '', to: '' }

function draftFromValue(value: DateRangeValue | null): Draft {
  if (value?.kind === 'custom') {
    return { from: value.from ?? '', to: value.to ?? '' }
  }
  return BLANK_DRAFT
}

export interface DateRangePickerProps {
  value: DateRangeValue | null
  onChange: (value: DateRangeValue | null) => void
  presets: readonly DateRangePreset[]
  /** Trigger's accessible name prefix AND the popover's `label`. */
  label: string
  testId?: string
}

/**
 * Generic date-range picker: a preset list plus a custom from/to range, composed from the
 * existing `Popover`/`Button`/`Field`/`Input` primitives. No domain types - `src/shared/date-range`
 * is itself generic, and this component takes no knowledge of what it's filtering.
 */
export function DateRangePicker({ value, onChange, presets, label, testId }: DateRangePickerProps) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState<Draft>(() => draftFromValue(value))
  const errorId = useId()

  const triggerText =
    value === null
      ? t('common.dateRange.any')
      : value.kind === 'preset'
        ? t(`common.dateRange.preset.${value.preset}`)
        : value.from && value.to
          ? t('common.dateRange.range', {
              from: formatIsoDate(value.from),
              to: formatIsoDate(value.to),
            })
          : value.from
            ? t('common.dateRange.fromOnly', { from: formatIsoDate(value.from) })
            : value.to
              ? t('common.dateRange.toOnly', { to: formatIsoDate(value.to) })
              : t('common.dateRange.any')

  const handlePresetClick = (preset: DateRangePreset): void => {
    setDraft(BLANK_DRAFT)
    onChange({ kind: 'preset', preset })
  }

  const handleClear = (): void => {
    setDraft(BLANK_DRAFT)
    onChange(null)
  }

  const handleFieldChange = (field: keyof Draft, raw: string): void => {
    const nextDraft = { ...draft, [field]: raw }
    setDraft(nextDraft)
    const from = nextDraft.from || null
    const to = nextDraft.to || null
    if (isRangeOrderValid(from, to)) {
      onChange(normalizeDateRange({ kind: 'custom', from, to }))
    }
  }

  const hasError = !isRangeOrderValid(draft.from || null, draft.to || null)

  return (
    <Popover
      label={label}
      content={() => (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {presets.map((preset) => (
              <Button
                key={preset}
                variant="neutral"
                size="sm"
                aria-pressed={value?.kind === 'preset' && value.preset === preset}
                data-testid={testId ? `${testId}-preset-${preset}` : undefined}
                onClick={() => handlePresetClick(preset)}
              >
                {t(`common.dateRange.preset.${preset}`)}
              </Button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Field label={t('common.dateRange.from')}>
              <Input
                type="date"
                value={draft.from}
                style={{ colorScheme: 'dark' }}
                data-testid={testId ? `${testId}-from` : undefined}
                aria-invalid={hasError || undefined}
                aria-describedby={hasError ? errorId : undefined}
                onChange={(event) => handleFieldChange('from', event.target.value)}
              />
            </Field>
            <Field label={t('common.dateRange.to')}>
              <Input
                type="date"
                value={draft.to}
                style={{ colorScheme: 'dark' }}
                data-testid={testId ? `${testId}-to` : undefined}
                aria-invalid={hasError || undefined}
                aria-describedby={hasError ? errorId : undefined}
                onChange={(event) => handleFieldChange('to', event.target.value)}
              />
            </Field>
          </div>

          {hasError && (
            <p
              id={errorId}
              role="alert"
              className="text-xs text-danger"
              data-testid={testId ? `${testId}-error` : undefined}
            >
              {t('common.dateRange.fromAfterTo')}
            </p>
          )}

          <Button
            variant="ghost"
            size="sm"
            data-testid={testId ? `${testId}-clear` : undefined}
            onClick={handleClear}
          >
            {t('common.dateRange.clear')}
          </Button>
        </div>
      )}
    >
      {({ toggle }) => (
        <Button
          variant="neutral"
          data-testid={testId ? `${testId}-trigger` : undefined}
          onClick={toggle}
        >
          {label}: {triggerText}
        </Button>
      )}
    </Popover>
  )
}
