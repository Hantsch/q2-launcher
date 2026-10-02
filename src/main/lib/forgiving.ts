import { z } from 'zod'

/** Why a persisted row was left out; `index` is its position in the raw array. */
export type RowDrop<T, U = T> =
  | { reason: 'invalid'; index: number; row: unknown; error: z.ZodError }
  | { reason: 'refused'; index: number; row: unknown; parsed: T }
  | { reason: 'duplicate'; index: number; row: unknown; parsed: U; key: string }

type KeyOf<U> = ((row: U) => string) | Record<string, (row: U) => string>

/**
 * Parses `raw` as an array, keeping only the elements that pass `schema` - the row-level
 * counterpart to a whole-field `.catch()`: one malformed row costs only itself.
 */
export function parseForgivingRows<T>(
  schema: z.ZodType<T>,
  raw: unknown,
  options: { onDrop?: (drop: RowDrop<T>) => void } = {},
): T[] {
  if (!Array.isArray(raw)) return []
  const kept: T[] = []
  raw.forEach((row: unknown, index) => {
    const result = schema.safeParse(row)
    if (result.success) kept.push(result.data)
    else options.onDrop?.({ reason: 'invalid', index, row, error: result.error })
  })
  return kept
}

/**
 * Shape, then `refine` (null refuses the row), then dedupe, per row in order. Keys are recorded
 * only for kept rows, so a row dropped on one key never reserves its other keys. First wins.
 */
export function parseKeyedRows<T, U = T>(
  schema: z.ZodType<T>,
  raw: unknown,
  options: {
    keyOf: KeyOf<U>
    refine?: (parsed: T) => U | null
    onDrop?: (drop: RowDrop<T, U>) => void
  },
): U[] {
  if (!Array.isArray(raw)) return []
  const keyFns: [string, (row: U) => string][] =
    typeof options.keyOf === 'function' ? [['key', options.keyOf]] : Object.entries(options.keyOf)
  const seen = new Map<string, Set<string>>(keyFns.map(([name]) => [name, new Set()]))
  const kept: U[] = []
  raw.forEach((row: unknown, index) => {
    const result = schema.safeParse(row)
    if (!result.success) {
      options.onDrop?.({ reason: 'invalid', index, row, error: result.error })
      return
    }
    const parsed = options.refine ? options.refine(result.data) : (result.data as unknown as U)
    if (parsed === null) {
      options.onDrop?.({ reason: 'refused', index, row, parsed: result.data })
      return
    }
    const keys = keyFns.map(([name, fn]) => [name, fn(parsed)] as const)
    const clash = keys.find(([name, key]) => seen.get(name)!.has(key))
    if (clash) {
      options.onDrop?.({ reason: 'duplicate', index, row, parsed, key: clash[0] })
      return
    }
    for (const [name, key] of keys) seen.get(name)!.add(key)
    kept.push(parsed)
  })
  return kept
}

/** A missing envelope parses as `{}`; anything the schema rejects yields a fresh `fallback()`. */
export function parseForgivingEnvelope<T>(
  schema: z.ZodType<T>,
  raw: unknown,
  fallback: () => T,
): T {
  const result = schema.safeParse(raw === undefined ? {} : raw)
  return result.success ? result.data : fallback()
}

/** First occurrence wins. */
export function dedupeByKey<T>(rows: T[], keyOf: (row: T) => string): T[] {
  const seenKeys = new Set<string>()
  return rows.filter((row) => {
    const key = keyOf(row)
    if (seenKeys.has(key)) return false
    seenKeys.add(key)
    return true
  })
}
