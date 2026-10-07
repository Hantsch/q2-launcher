// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { DATE_RANGE_PRESETS, type DateRangeValue } from '@shared/date-range'
import { initI18n } from '../../i18n'
import { DateRangePicker } from './DateRangePicker'

beforeAll(async () => {
  await initI18n('en')
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderPicker(value: DateRangeValue | null, onChange = vi.fn()) {
  render(
    createElement(DateRangePicker, {
      value,
      onChange,
      presets: DATE_RANGE_PRESETS,
      label: 'Date',
      testId: 'demo-date',
    }),
  )
  return { onChange, trigger: screen.getByTestId('demo-date-trigger') }
}

/** Opens the popover the same way a real click would (no `@testing-library/user-event` in this
 * repo - see `Popover.test.tsx`). */
function open(trigger: HTMLElement): void {
  fireEvent.click(trigger)
}

describe('DateRangePicker', () => {
  it('choosing a preset emits it and clears the custom fields', () => {
    const { onChange, trigger } = renderPicker(null)
    open(trigger)

    fireEvent.change(screen.getByTestId('demo-date-from'), { target: { value: '2026-01-01' } })
    expect(onChange).toHaveBeenLastCalledWith({ kind: 'custom', from: '2026-01-01', to: null })

    fireEvent.click(screen.getByTestId('demo-date-preset-today'))
    expect(onChange).toHaveBeenLastCalledWith({ kind: 'preset', preset: 'today' })
    expect((screen.getByTestId('demo-date-from') as HTMLInputElement).value).toBe('')
  })

  it('a from-date after the to-date shows the reason and emits nothing', () => {
    const { onChange, trigger } = renderPicker(null)
    open(trigger)

    fireEvent.change(screen.getByTestId('demo-date-from'), { target: { value: '2026-03-10' } })
    onChange.mockClear()
    fireEvent.change(screen.getByTestId('demo-date-to'), { target: { value: '2026-03-01' } })

    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByTestId('demo-date-error').textContent).toBe(
      'The from date is after the to date.',
    )
    expect(screen.getByTestId('demo-date-from').getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByTestId('demo-date-to').getAttribute('aria-invalid')).toBe('true')
  })

  it('a single open end is emitted as a half-open range', () => {
    const { onChange, trigger } = renderPicker(null)
    open(trigger)

    fireEvent.change(screen.getByTestId('demo-date-from'), { target: { value: '2026-05-01' } })
    expect(onChange).toHaveBeenLastCalledWith({ kind: 'custom', from: '2026-05-01', to: null })

    cleanup()
    const second = renderPicker(null)
    open(second.trigger)
    fireEvent.change(screen.getByTestId('demo-date-to'), { target: { value: '2026-05-31' } })
    expect(second.onChange).toHaveBeenLastCalledWith({
      kind: 'custom',
      from: null,
      to: '2026-05-31',
    })
  })

  it('the picker is operable by keyboard alone', () => {
    const { onChange, trigger } = renderPicker(null)

    trigger.focus()
    expect(document.activeElement).toBe(trigger)

    // Real browsers fire a click when Enter is pressed on a focused button; jsdom does not
    // synthesize that, so it's simulated explicitly (no `user-event` in this repo).
    fireEvent.keyDown(trigger, { key: 'Enter' })
    fireEvent.click(trigger)

    const dialog = screen.getByRole('dialog', { name: 'Date' })
    expect(dialog).toBeTruthy()

    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button, input'))
    const presetButtons = focusable.filter((el) => el.dataset.testid?.includes('-preset-'))
    const fromInput = screen.getByTestId('demo-date-from')
    const toInput = screen.getByTestId('demo-date-to')
    const clearButton = screen.getByTestId('demo-date-clear')

    expect(presetButtons.length).toBe(DATE_RANGE_PRESETS.length)
    const orderedIds = focusable.map((el) => el.dataset.testid ?? el.tagName)
    expect(orderedIds.indexOf(fromInput.getAttribute('data-testid') ?? '')).toBeGreaterThan(
      orderedIds.indexOf(presetButtons[presetButtons.length - 1].dataset.testid ?? ''),
    )
    expect(orderedIds.indexOf(toInput.getAttribute('data-testid') ?? '')).toBeGreaterThan(
      orderedIds.indexOf(fromInput.getAttribute('data-testid') ?? ''),
    )
    expect(orderedIds.indexOf(clearButton.getAttribute('data-testid') ?? '')).toBeGreaterThan(
      orderedIds.indexOf(toInput.getAttribute('data-testid') ?? ''),
    )

    const firstPreset = presetButtons[0]
    firstPreset.focus()
    fireEvent.keyDown(firstPreset, { key: 'Enter' })
    fireEvent.click(firstPreset)
    expect(onChange).toHaveBeenLastCalledWith({ kind: 'preset', preset: DATE_RANGE_PRESETS[0] })

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Date' })).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('the trigger shows the dates in the default locale format', () => {
    const formatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })
    const from = formatter.format(new Date(2026, 0, 5))
    const to = formatter.format(new Date(2026, 0, 20))

    const { trigger } = renderPicker({ kind: 'custom', from: '2026-01-05', to: '2026-01-20' })

    expect(trigger.textContent).toContain(from)
    expect(trigger.textContent).toContain(to)
  })
})
