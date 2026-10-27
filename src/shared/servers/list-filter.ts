/**
 * Filter engine for the servers list — pure, colocated with `row-markers.ts` and `list-sort.ts` in
 * the same module. `ServerListFilter` is one flat bag of criteria; every field is either a select
 * (`null` means "not applied") or a boolean toggle (`false` means "not applied"), plus a free-text
 * search that always applies (against name/address/roster) regardless of the other fields.
 *
 * Pure by contract: this file lives in `src/shared`, so no `node:*` import, no DOM types, no IPC.
 */
import { equalsIgnoreCase, matchesTerm } from '../list/search'
import { isBotsOnly, isWaitingForOpponent, knownPlayerCount } from './row-markers'
import type { ServerGamemode } from './row-markers'
import type { ServerListEntry, ServerListRow } from '../modules/servers'
import { CONTINENTS, countryName, parseLocationToken } from './location'
import type { LocationToken, ServerLocation } from './location'

export const MAX_PING_STEPS = [50, 100, 150, 200] as const
export type MaxPingMs = (typeof MAX_PING_STEPS)[number]

export interface ServerListFilter {
  search: string
  mod: string[]
  gamemode: ServerGamemode | null
  map: string[]
  /** Strict "below" this many ms; only online rows with a measured ping match. */
  maxPingMs: MaxPingMs | null
  /** Only servers known to have nobody on them. */
  empty: boolean
  /** Hides servers whose whole roster looks like bots (`isBotsOnly`) - an estimate. */
  hideBotsOnly: boolean
  waitingForOpponent: boolean
  /** Location tokens (`region:EU`, `country:DE`, `lan`, `unknown`); a server passes on any match. */
  location: LocationToken[]
}

/** The filter with every criterion cleared — `filterServers` returns every row unchanged for this. */
export const EMPTY_SERVER_LIST_FILTER: ServerListFilter = {
  search: '',
  mod: [],
  gamemode: null,
  map: [],
  maxPingMs: null,
  empty: false,
  hideBotsOnly: false,
  waitingForOpponent: false,
  location: [],
}

/** Whether any criterion in `f` actually restricts the list — a blank/whitespace-only search does
 * not count, matching `matchesSearch`'s own empty-term behaviour. */
export function isFilterActive(f: ServerListFilter): boolean {
  return (
    f.mod.length > 0 ||
    f.gamemode !== null ||
    f.map.length > 0 ||
    f.maxPingMs !== null ||
    f.empty ||
    f.hideBotsOnly ||
    f.waitingForOpponent ||
    f.location.length > 0 ||
    f.search.trim() !== ''
  )
}

/**
 * Whether `row` matches a free-text search term: an empty (or whitespace-only) term always matches.
 * Otherwise matches case-insensitively against the row's name, address, or - only when `players` is
 * the fetched roster array rather than a bare count or unknown - any player's name. Never throws.
 *
 * Quoted mode: a trimmed term of at least three characters that starts and ends with a double quote
 * (`"ffa"`) matches exactly instead - the text between the quotes (case-insensitive, not trimmed)
 * must equal the whole name, the whole address, or, where a roster was fetched, a whole player
 * name. Anything else (an unclosed quote, empty quotes, a lone quote, single quotes) is plain text.
 */
export function matchesSearch(
  row: Pick<ServerListEntry, 'name' | 'address' | 'players'>,
  term: string,
): boolean {
  return matchesTerm(term, [
    row.name,
    row.address,
    ...(Array.isArray(row.players) ? row.players.map((p) => p.name) : []),
  ])
}

function matchesLocationToken(location: ServerLocation | undefined, token: LocationToken): boolean {
  const parsed = parseLocationToken(token)
  if (!parsed) return false
  const kind = location?.kind ?? 'unknown'
  switch (parsed.kind) {
    case 'lan':
    case 'unknown':
      return kind === parsed.kind
    case 'region':
      return location?.kind === 'country' && location.continent === parsed.continent
    case 'country':
      return location?.kind === 'country' && location.country === parsed.country
  }
}

function matchesText(value: string | undefined, filterValue: string): boolean {
  return equalsIgnoreCase(value, filterValue)
}

/**
 * Whether `row` satisfies every active criterion in `f` (search plus each select/toggle that is not
 * at its "not applied" value). An inactive field is skipped entirely rather than evaluated.
 */
export function matchesFilter(row: ServerListRow, f: ServerListFilter): boolean {
  if (!matchesSearch(row, f.search)) return false

  if (f.mod.length > 0 && !f.mod.some((m) => matchesText(row.mod, m))) return false
  if (f.map.length > 0 && !f.map.some((m) => matchesText(row.map, m))) return false
  if (f.location.length > 0 && !f.location.some((t) => matchesLocationToken(row.location, t))) {
    return false
  }
  if (f.gamemode !== null && row.gamemode !== f.gamemode) return false
  if (
    f.maxPingMs !== null &&
    !(row.status === 'online' && row.rttMs !== undefined && row.rttMs < f.maxPingMs)
  ) {
    return false
  }

  if (f.empty || f.waitingForOpponent) {
    const n = knownPlayerCount(row)
    if (f.empty && n !== 0) return false
    if (f.waitingForOpponent && !isWaitingForOpponent(row)) return false
  }

  if (f.hideBotsOnly && isBotsOnly(row)) return false

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
export function filterOptions(rows: readonly ServerListEntry[]): {
  mods: string[]
  maps: string[]
} {
  return {
    mods: distinctSorted(rows.map((r) => r.mod)),
    maps: distinctSorted(rows.map((r) => r.map)),
  }
}

/**
 * The location tokens to offer for `rows`, in display order: each present region (`CONTINENTS`
 * order) followed by its present countries by English name, then `lan`, then `unknown`. A token in
 * `selected` that no row carries stays listed so a saved choice can always be undone; an absent
 * country goes last because its continent is not known.
 */
export function locationOptions(
  rows: readonly ServerListEntry[],
  selected: readonly LocationToken[],
): LocationToken[] {
  const countries = new Map<string, Set<string>>()
  let lan = false
  let unknown = false
  const addCountry = (continent: string, country: string): void => {
    const set = countries.get(continent) ?? new Set<string>()
    set.add(country)
    countries.set(continent, set)
  }
  for (const { location } of rows) {
    if (location?.kind === 'country') addCountry(location.continent, location.country)
    else if (location?.kind === 'lan') lan = true
    else unknown = true
  }

  const regions = new Set<string>(countries.keys())
  const extraCountries: string[] = []
  const extra: LocationToken[] = []
  for (const token of selected) {
    const parsed = parseLocationToken(token)
    if (parsed?.kind === 'region') regions.add(parsed.continent)
    else if (parsed?.kind === 'country') extraCountries.push(parsed.country)
    else if (parsed?.kind === 'lan') lan = true
    else if (parsed?.kind === 'unknown') unknown = true
    else extra.push(token)
  }
  // An absent country carries no continent of its own, so it cannot be placed under a region.
  const present = new Set([...countries.values()].flatMap((set) => [...set]))
  const trailing = [...new Set(extraCountries)].filter((c) => !present.has(c))

  const out: LocationToken[] = []
  for (const continent of CONTINENTS) {
    if (!regions.has(continent)) continue
    out.push(`region:${continent}`)
    const codes = [...(countries.get(continent) ?? [])].sort((a, b) =>
      countryName(a, 'en').localeCompare(countryName(b, 'en')),
    )
    for (const code of codes) out.push(`country:${code}`)
  }
  if (lan) out.push('lan')
  if (unknown) out.push('unknown')
  for (const code of trailing) out.push(`country:${code}`)
  return [...out, ...extra]
}
