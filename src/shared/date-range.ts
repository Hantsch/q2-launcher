/**
 * Date-range filtering logic for the demo (replay) list — pure, presets + a custom from/to range,
 * both resolved against **local** time so "today"/"last 7 days" match what the clock on the wall
 * says, not UTC.
 *
 * Pure by contract: this file lives in `src/shared`, so no `node:*` import, no DOM types, no
 * electron import.
 */

import { z } from 'zod'

export const DATE_RANGE_PRESETS = ['today', 'last7Days', 'last30Days'] as const

export type DateRangePreset = (typeof DATE_RANGE_PRESETS)[number]

export type DateRangeValue =
  | { kind: 'preset'; preset: DateRangePreset }
  | { kind: 'custom'; from: string | null; to: string | null }

const ISO_LOCAL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** True only for a real calendar date in `YYYY-MM-DD` form (rejects `2026-02-30`, non-zero-padded
 * numbers, and garbage strings). */
export function isIsoLocalDate(s: string): boolean {
  if (!ISO_LOCAL_DATE_RE.test(s)) return false
  const [year, month, day] = s.split('-').map((part) => Number(part))
  const date = new Date(year, month - 1, day)
  return (
    date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
  )
}

const isoLocalDateSchema = z.string().refine(isIsoLocalDate, 'must be a valid YYYY-MM-DD date')

export const dateRangeValueSchema: z.ZodType<DateRangeValue> = z.union([
  z.object({
    kind: z.literal('preset'),
    preset: z.enum(DATE_RANGE_PRESETS),
  }),
  z.object({
    kind: z.literal('custom'),
    from: isoLocalDateSchema.nullable(),
    to: isoLocalDateSchema.nullable(),
  }),
])

/** False only when both `from` and `to` are set and `from` is after `to`. String comparison is
 * safe here because the format is fixed-width ISO (`YYYY-MM-DD`). */
export function isRangeOrderValid(from: string | null, to: string | null): boolean {
  if (from === null || to === null) return true
  return from <= to
}

/**
 * A `custom` value with both ends open, or with `from` after `to`, is not a real filter — it
 * normalizes to `null` (no filter). Everything else (including every preset) passes through
 * unchanged.
 */
export function normalizeDateRange(value: DateRangeValue | null): DateRangeValue | null {
  if (value === null) return null
  if (value.kind !== 'custom') return value
  if (value.from === null && value.to === null) return null
  if (!isRangeOrderValid(value.from, value.to)) return null
  return value
}

export interface ResolvedDateRange {
  startMs: number | null
  endMs: number | null
}

function localMidnight(year: number, month: number, day: number): number {
  return new Date(year, month, day).getTime()
}

function midnightOf(dateMs: number): { year: number; month: number; day: number } {
  const d = new Date(dateMs)
  return { year: d.getFullYear(), month: d.getMonth(), day: d.getDate() }
}

function parseIsoLocalDate(s: string): { year: number; month: number; day: number } {
  const [year, month, day] = s.split('-').map((part) => Number(part))
  return { year, month: month - 1, day }
}

/**
 * Resolves a `DateRangeValue` to a half-open `[startMs, endMs)` range in **local** time. Every
 * boundary is built with `new Date(y, m, d)` — never `nowMs - n * 86_400_000`, which breaks across
 * DST. `null` (including a `custom` value that normalizes away) means unbounded — matches
 * everything.
 */
export function resolveDateRange(value: DateRangeValue | null, nowMs: number): ResolvedDateRange {
  const normalized = normalizeDateRange(value)
  if (normalized === null) return { startMs: null, endMs: null }

  const { year, month, day } = midnightOf(nowMs)
  const todayMs = localMidnight(year, month, day)
  const tomorrowMs = localMidnight(year, month, day + 1)

  if (normalized.kind === 'preset') {
    switch (normalized.preset) {
      case 'today':
        return { startMs: todayMs, endMs: tomorrowMs }
      case 'last7Days':
        return { startMs: localMidnight(year, month, day - 6), endMs: tomorrowMs }
      case 'last30Days':
        return { startMs: localMidnight(year, month, day - 29), endMs: tomorrowMs }
    }
  }

  const startMs =
    normalized.from === null
      ? null
      : (() => {
          const f = parseIsoLocalDate(normalized.from as string)
          return localMidnight(f.year, f.month, f.day)
        })()
  const endMs =
    normalized.to === null
      ? null
      : (() => {
          const t = parseIsoLocalDate(normalized.to as string)
          return localMidnight(t.year, t.month, t.day + 1)
        })()

  return { startMs, endMs }
}

/**
 * `dateMs === null` never matches an active range (a date-less item can't be placed in time). If
 * both bounds are null, there is no active filter, so everything matches — including a null date.
 */
export function matchesDateRange(
  dateMs: number | null,
  range: { startMs: number | null; endMs: number | null },
): boolean {
  if (range.startMs === null && range.endMs === null) return true
  if (dateMs === null) return false
  if (range.startMs !== null && dateMs < range.startMs) return false
  if (range.endMs !== null && dateMs >= range.endMs) return false
  return true
}
