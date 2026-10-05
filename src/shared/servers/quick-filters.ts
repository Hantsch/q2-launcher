/**
 * Saved quick filters for the servers list: a named snapshot of the filter's select/toggle criteria
 * (never the free-text search, which stays whatever the user typed). Pure by contract: this file
 * lives in `src/shared`, so no `node:*` import, no DOM types, no IPC.
 */
import { EMPTY_SERVER_LIST_FILTER } from './list-filter'
import type { ServerListFilter } from './list-filter'

export type QuickFilterCriteria = Omit<ServerListFilter, 'search'>

export interface QuickFilter {
  id: string
  name: string
  criteria: QuickFilterCriteria
}

export const QUICK_FILTER_MAX = 8
export const QUICK_FILTER_NAME_MAX = 32

export type QuickFilterNameProblem = 'empty' | 'tooLong' | 'taken'

/** The criteria part of `f` - everything except the free-text search. */
export function criteriaOf(f: ServerListFilter): QuickFilterCriteria {
  return {
    mod: f.mod,
    gamemode: f.gamemode,
    map: f.map,
    maxPingMs: f.maxPingMs,
    empty: f.empty,
    hideBotsOnly: f.hideBotsOnly,
    waitingForOpponent: f.waitingForOpponent,
  }
}

/** Whether any select is set or any toggle is on. */
export function hasCriteria(c: QuickFilterCriteria): boolean {
  return (
    c.mod !== null ||
    c.gamemode !== null ||
    c.map !== null ||
    c.maxPingMs !== null ||
    c.empty ||
    c.hideBotsOnly ||
    c.waitingForOpponent
  )
}

function sameText(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b
  return a.toLowerCase() === b.toLowerCase()
}

/** Field-wise equality; mod and map compare case-insensitively, like the filter's own matching. */
export function sameCriteria(a: QuickFilterCriteria, b: QuickFilterCriteria): boolean {
  return (
    sameText(a.mod, b.mod) &&
    sameText(a.map, b.map) &&
    a.gamemode === b.gamemode &&
    a.maxPingMs === b.maxPingMs &&
    a.empty === b.empty &&
    a.hideBotsOnly === b.hideBotsOnly &&
    a.waitingForOpponent === b.waitingForOpponent
  )
}

/** `c` replaces every criterion of `f`; the search is kept. */
export function applyCriteria(f: ServerListFilter, c: QuickFilterCriteria): ServerListFilter {
  return { ...c, search: f.search }
}

/** Clears every criterion of `f`; the search is kept. */
export function clearCriteria(f: ServerListFilter): ServerListFilter {
  return { ...EMPTY_SERVER_LIST_FILTER, search: f.search }
}

/**
 * Why `name` cannot be used for a quick filter, or `null` when it can. The name is trimmed first;
 * uniqueness is case-insensitive against `list`, skipping the entry `exceptId` (the one being renamed).
 */
export function validateQuickFilterName(
  name: string,
  list: readonly QuickFilter[],
  exceptId?: string,
): QuickFilterNameProblem | null {
  const trimmed = name.trim()
  if (trimmed === '') return 'empty'
  if (trimmed.length > QUICK_FILTER_NAME_MAX) return 'tooLong'
  const key = trimmed.toLowerCase()
  if (list.some((q) => q.id !== exceptId && q.name.trim().toLowerCase() === key)) return 'taken'
  return null
}
