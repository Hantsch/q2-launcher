/**
 * Sort/filter shaping for the Aliases tab's row list (story 044, D4).
 *
 * Pure, like every other `lib/*.ts` file in this module (see `cvar-rows.ts`) - no DOM, no hooks, no
 * i18n - so sorting and filtering can be unit-tested without a component harness. Generic over the
 * caller's own row wrapper (`AliasesTab.tsx`'s `DisplayRow` widens `buildAliasIndex`'s row with body/
 * budget presentation fields this module has no use for) rather than tied to `AliasIndexRow` itself,
 * so the tab never has to unwrap-then-rewrap its own list to use these.
 */

import type { AliasIndexRow } from '@shared/config/alias-references'

/** Anything the sort/filter helpers below need: the underlying index row, nested the same way
 * `AliasesTab.tsx`'s `DisplayRow` already carries it (`{ row: AliasIndexRow, ... }`). Generic so a
 * caller's own wrapper type flows through unchanged - these functions only ever reorder or select
 * elements, never construct or drop fields. */
export interface HasAliasIndexRow {
  row: AliasIndexRow
}

export type AliasSortDirection = 'asc' | 'desc'

/**
 * `rows` sorted by `row.name`, case-insensitively (`localeCompare` with `sensitivity: 'base'` - the
 * convention this codebase already uses for user-facing name lists, e.g.
 * `alias-import.test.ts`/`inspector.ts`), ascending unless `direction` says otherwise.
 *
 * Stable: `Array.prototype.sort` has been a stable sort since ES2019, so two rows that happen to
 * share a name (a duplicate pair) keep their original relative order rather than swapping places
 * between renders.
 */
export function sortAliasRows<T extends HasAliasIndexRow>(
  rows: readonly T[],
  direction: AliasSortDirection = 'asc',
): T[] {
  const sorted = [...rows].sort((a, b) =>
    a.row.name.localeCompare(b.row.name, undefined, { sensitivity: 'base' }),
  )
  if (direction === 'desc') sorted.reverse()
  return sorted
}

export interface AliasRowFilter {
  /** Case-insensitive substring match against `row.name`. Empty/whitespace-only (including
   * `undefined`) means "no name filter". */
  nameText?: string
  /** Restrict to rows nothing currently calls (`row.referrers.length === 0`). */
  unreferencedOnly?: boolean
}

/**
 * `rows` narrowed by `filter`'s name-text fragment and/or "unreferenced only" - both apply together
 * (AND, not OR) when both are set, per the story's "filters ... including in combination"
 * acceptance criterion. An unset/empty filter field never excludes anything on its own.
 */
export function filterAliasRows<T extends HasAliasIndexRow>(
  rows: readonly T[],
  filter: AliasRowFilter,
): T[] {
  const needle = filter.nameText?.trim().toLowerCase() ?? ''
  return rows.filter(({ row }) => {
    if (needle !== '' && !row.name.toLowerCase().includes(needle)) return false
    if (filter.unreferencedOnly && row.referrers.length > 0) return false
    return true
  })
}

/** Whether `row` collides with at least one other definition of the same name - a thin, named
 * wrapper over `row.duplicateOf.length > 0` so a call site reads as intent ("is this a duplicate")
 * rather than a bare length check on a field a reader has to go look up. */
export function isDuplicateAliasRow(row: AliasIndexRow): boolean {
  return row.duplicateOf.length > 0
}
