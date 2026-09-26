/**
 * Filter engine for the servers list — pure, colocated with `row-markers.ts` and `list-sort.ts` in
 * the same module. `ServerListFilter` is one flat bag of criteria; every field is either a select
 * (`null` means "not applied") or a boolean toggle (`false` means "not applied"), plus a free-text
 * search that always applies (against name/address/roster) regardless of the other fields.
 *
 * Pure by contract: this file lives in `src/shared`, so no `node:*` import, no DOM types, no IPC.
 */
import { isBotsOnly, isWaitingForOpponent, knownPlayerCount } from './row-markers'
import type { ServerGamemode } from './row-markers'
import type { ServerListEntry, ServerListRow } from '../modules/servers'

export interface ServerListFilter {
  search: string
  mod: string | null
  gamemode: ServerGamemode | null
  map: string | null
  nonEmpty: boolean
  /** Only servers known to have nobody on them. */
  empty: boolean
  /** Hides servers whose whole roster looks like bots (`isBotsOnly`) - an estimate. */
  hideBotsOnly: boolean
  noPassword: boolean
  waitingForOpponent: boolean
}

/** The filter with every criterion cleared — `filterServers` returns every row unchanged for this. */
export const EMPTY_SERVER_LIST_FILTER: ServerListFilter = {
  search: '',
  mod: null,
  gamemode: null,
  map: null,
  nonEmpty: false,
  empty: false,
  hideBotsOnly: false,
  noPassword: false,
  waitingForOpponent: false,
}

/** Whether any criterion in `f` actually restricts the list — a blank/whitespace-only search does
 * not count, matching `matchesSearch`'s own empty-term behaviour. */
export function isFilterActive(f: ServerListFilter): boolean {
  return (
    f.mod !== null ||
    f.gamemode !== null ||
    f.map !== null ||
    f.nonEmpty ||
    f.empty ||
    f.hideBotsOnly ||
    f.noPassword ||
    f.waitingForOpponent ||
    f.search.trim() !== ''
  )
}

/**
 * Whether `row` matches a free-text search term: an empty (or whitespace-only) term always matches.
 * Otherwise matches case-insensitively against the row's name, address, or - only when `players` is
 * the fetched roster array rather than a bare count or unknown - any player's name. Never throws.
 */
export function matchesSearch(
  row: Pick<ServerListEntry, 'name' | 'address' | 'players'>,
  term: string,
): boolean {
  const t = term.trim().toLowerCase()
  if (t === '') return true

  if (row.name !== undefined && row.name.toLowerCase().includes(t)) return true
  if (row.address.toLowerCase().includes(t)) return true

  if (Array.isArray(row.players)) {
    return row.players.some((player) => player.name.toLowerCase().includes(t))
  }

  return false
}

function matchesText(value: string | undefined, filterValue: string): boolean {
  return value !== undefined && value.toLowerCase() === filterValue.toLowerCase()
}

/**
 * Whether `row` satisfies every active criterion in `f` (search plus each select/toggle that is not
 * at its "not applied" value). An inactive field is skipped entirely rather than evaluated.
 */
export function matchesFilter(row: ServerListRow, f: ServerListFilter): boolean {
  if (!matchesSearch(row, f.search)) return false

  if (f.mod !== null && !matchesText(row.mod, f.mod)) return false
  if (f.map !== null && !matchesText(row.map, f.map)) return false
  if (f.gamemode !== null && row.gamemode !== f.gamemode) return false

  if (f.nonEmpty || f.empty || f.waitingForOpponent) {
    const n = knownPlayerCount(row)
    if (f.nonEmpty && !(n !== undefined && n > 0)) return false
    if (f.empty && n !== 0) return false
    if (f.waitingForOpponent && !isWaitingForOpponent(row)) return false
  }

  if (f.hideBotsOnly && isBotsOnly(row)) return false

  if (f.noPassword && row.needpass !== false) return false

  return true
}

/**
 * Filters `rows` by `f`, preserving input order (never sorts). Returns a new array containing every
 * row, in the same order, when no criterion in `f` is active.
 */
export function filterServers<T extends ServerListEntry>(
  rows: readonly T[],
  f: ServerListFilter,
): T[] {
  return rows.filter((r) => matchesFilter(r as unknown as ServerListRow, f))
}

function distinctSorted(values: (string | undefined)[]): string[] {
  const seen = new Map<string, string>()
  for (const value of values) {
    if (value === undefined) continue
    const key = value.toLowerCase()
    if (!seen.has(key)) seen.set(key, value)
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b))
}

/** The distinct `mod`/`map` values across `rows`, deduped case-insensitively (first spelling
 * encountered wins) and sorted with `localeCompare`, for populating filter dropdowns. */
export function filterOptions(rows: readonly ServerListEntry[]): { mods: string[]; maps: string[] } {
  return {
    mods: distinctSorted(rows.map((r) => r.mod)),
    maps: distinctSorted(rows.map((r) => r.map)),
  }
}
