import { describe, expect, it } from 'vitest'
import {
  dateRangeValueSchema,
  isRangeOrderValid,
  matchesDateRange,
  normalizeDateRange,
  resolveDateRange,
} from './date-range'

describe('resolveDateRange — presets', () => {
  it('today covers local midnight to the next local midnight', () => {
    const now = new Date(2026, 5, 15, 13, 30).getTime()
    const { startMs, endMs } = resolveDateRange({ kind: 'preset', preset: 'today' }, now)

    expect(startMs).toBe(new Date(2026, 5, 15).getTime())
    expect(endMs).toBe(new Date(2026, 5, 16).getTime())
  })

  it('last 7 days starts at local midnight six days ago and includes today', () => {
    const now = new Date(2026, 5, 15, 9, 0).getTime()
    const { startMs, endMs } = resolveDateRange({ kind: 'preset', preset: 'last7Days' }, now)

    expect(startMs).toBe(new Date(2026, 5, 9).getTime())
    expect(endMs).toBe(new Date(2026, 5, 16).getTime())
  })

  it('last 30 days starts at local midnight 29 days ago', () => {
    const now = new Date(2026, 5, 15, 9, 0).getTime()
    const { startMs, endMs } = resolveDateRange({ kind: 'preset', preset: 'last30Days' }, now)

    expect(startMs).toBe(new Date(2026, 4, 17).getTime())
    expect(endMs).toBe(new Date(2026, 5, 16).getTime())
  })
})

describe('resolveDateRange — custom range', () => {
  it('a custom to-date includes that whole day', () => {
    const now = new Date(2026, 5, 15).getTime()
    const { startMs, endMs } = resolveDateRange(
      { kind: 'custom', from: '2026-06-10', to: '2026-06-12' },
      now,
    )

    expect(startMs).toBe(new Date(2026, 5, 10).getTime())
    expect(endMs).toBe(new Date(2026, 5, 13).getTime())
  })

  it('an open end is unbounded', () => {
    const now = new Date(2026, 5, 15).getTime()
    const fromOnly = resolveDateRange({ kind: 'custom', from: '2026-06-10', to: null }, now)
    expect(fromOnly.startMs).toBe(new Date(2026, 5, 10).getTime())
    expect(fromOnly.endMs).toBeNull()

    const toOnly = resolveDateRange({ kind: 'custom', from: null, to: '2026-06-10' }, now)
    expect(toOnly.startMs).toBeNull()
    expect(toOnly.endMs).toBe(new Date(2026, 5, 11).getTime())
  })
})

describe('isRangeOrderValid / normalizeDateRange', () => {
  it('a from-date later than the to-date is invalid', () => {
    expect(isRangeOrderValid('2026-06-12', '2026-06-10')).toBe(false)
    expect(normalizeDateRange({ kind: 'custom', from: '2026-06-12', to: '2026-06-10' })).toBeNull()
  })

  it('from equal to to is a valid single day', () => {
    expect(isRangeOrderValid('2026-06-10', '2026-06-10')).toBe(true)
    const value: import('./date-range').DateRangeValue = {
      kind: 'custom',
      from: '2026-06-10',
      to: '2026-06-10',
    }
    expect(normalizeDateRange(value)).toEqual(value)
  })

  it('a custom range with both ends open normalises to no filter', () => {
    expect(normalizeDateRange({ kind: 'custom', from: null, to: null })).toBeNull()
  })
})

describe('dateRangeValueSchema', () => {
  it('the schema rejects an impossible calendar date', () => {
    const result = dateRangeValueSchema.safeParse({
      kind: 'custom',
      from: '2026-02-30',
      to: null,
    })
    expect(result.success).toBe(false)
  })
})

describe('resolveDateRange — DST', () => {
  it('a range crossing a DST change still starts at local midnight', () => {
    const now = new Date(2026, 2, 31, 12, 0).getTime()
    const { startMs } = resolveDateRange({ kind: 'preset', preset: 'last7Days' }, now)
    expect(startMs).not.toBeNull()
    expect(new Date(startMs as number).getHours()).toBe(0)
  })
})

describe('matchesDateRange', () => {
  it('a demo without a date never matches an active range', () => {
    const range = { startMs: new Date(2026, 5, 1).getTime(), endMs: new Date(2026, 5, 2).getTime() }
    expect(matchesDateRange(null, range)).toBe(false)
  })
})
