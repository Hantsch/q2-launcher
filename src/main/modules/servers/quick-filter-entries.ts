import { randomUUID } from 'node:crypto'
import {
  QUICK_FILTER_MAX,
  hasCriteria,
  validateQuickFilterName,
  type QuickFilter,
  type QuickFilterCriteria,
} from '@shared/servers/quick-filters'
import type { QuickFilterRefusalKey, QuickFiltersResult } from '@shared/modules/servers'
import { refuse } from '@shared/types'

/**
 * Story 197: the saved quick filters' three operations, pure functions over
 * `ServersState['quickFilters']` - no I/O, mirroring `watchlist-entries.ts`: an injectable `mintId`
 * and a `{ ok: true; list } | { ok: false; reasonKey }` result instead of a thrown error.
 */
export type QuickFilterMutationResult = QuickFiltersResult

const NAME_PROBLEM_KEYS: Record<'empty' | 'tooLong', QuickFilterRefusalKey> = {
  empty: 'servers.quickFilter.error.empty',
  tooLong: 'servers.quickFilter.error.tooLong',
}

/**
 * Saves `criteria` under `name`. An empty criteria set, an empty/too long name, or (unless
 * `overwrite`) a taken name is refused. With `overwrite`, the same-named entry (case-insensitive)
 * keeps its id and position and only its criteria are replaced. A new entry is appended, unless the
 * list is already at `QUICK_FILTER_MAX`.
 */
export function saveQuickFilter(
  list: readonly QuickFilter[],
  input: { name: string; criteria: QuickFilterCriteria; overwrite: boolean },
  mintId: () => string = randomUUID,
): QuickFilterMutationResult {
  if (!hasCriteria(input.criteria)) return refuse('servers.quickFilter.error.noCriteria')
  const problem = validateQuickFilterName(input.name, list)
  const name = input.name.trim()
  if (problem === 'empty' || problem === 'tooLong') return refuse(NAME_PROBLEM_KEYS[problem])
  if (problem === 'taken') {
    if (!input.overwrite) return refuse('servers.quickFilter.error.taken')
    const key = name.toLowerCase()
    return {
      ok: true,
      list: list.map((q) =>
        q.name.trim().toLowerCase() === key ? { ...q, criteria: input.criteria } : q,
      ),
    }
  }
  if (list.length >= QUICK_FILTER_MAX) return refuse('servers.quickFilter.error.cap')
  return { ok: true, list: [...list, { id: mintId(), name, criteria: input.criteria }] }
}

/** Renames the entry `id`. Refuses an unknown id, an empty/too long name, or one another entry has. */
export function renameQuickFilter(
  list: readonly QuickFilter[],
  input: { id: string; name: string },
): QuickFilterMutationResult {
  if (!list.some((q) => q.id === input.id)) return refuse('servers.quickFilter.error.notFound')
  const problem = validateQuickFilterName(input.name, list, input.id)
  if (problem === 'taken') return refuse('servers.quickFilter.error.taken')
  if (problem !== null) return refuse(NAME_PROBLEM_KEYS[problem])
  const name = input.name.trim()
  return { ok: true, list: list.map((q) => (q.id === input.id ? { ...q, name } : q)) }
}

/** Removes the entry `id`; an unknown id is a successful no-op. */
export function removeQuickFilter(
  list: readonly QuickFilter[],
  input: { id: string },
): QuickFilterMutationResult {
  return { ok: true, list: list.filter((q) => q.id !== input.id) }
}
