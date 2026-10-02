/**
 * Filter engine for the demo (replay) list — pure, colocated with `list-sort.ts` in the same
 * module. `DemoListFilter` is one flat bag of criteria; every field is either a select (`null`
 * means "not applied"), a boolean toggle (`false` means "not applied") or a list (`[]` means "not
 * applied"), plus a free-text search that always applies (against name/file name/map/description/
 * tags/players) regardless of the other fields. Mirrors `src/shared/servers/list-filter.ts`'s
 * shape and doc style.
 *
 * Pure by contract: this file lives in `src/shared`, so no `node:*` import, no DOM types, no IPC.
 */
import { z } from 'zod'
import { describeGamemode, gamemodeFilterMatches, gamemodeFilterOptions } from '../demos/gamemode'
import type { EffectiveGamemode, GamemodeSource } from '../demos/gamemode'
import type { DemoRow } from '../modules/replays'
import {
  dateRangeValueSchema,
  matchesDateRange,
  normalizeDateRange,
  resolveDateRange,
  type DateRangeValue,
} from '../date-range'

/** What `filterDemos`/`matchesDemoFilter` need from a demo row — a shape any row type can be
 * adapted to via a `toSubject` function, so the engine never depends on `DemoRow` directly. */
export interface DemoFilterSubject {
  fileName: string
  /** Effective name, or null when unresolved. */
  name: string | null
  /** Effective map, or null when unresolved. */
  map: string | null
  /** Effective mod, or null when unresolved. */
  mod: string | null
  gamemode: EffectiveGamemode
  sidecar: {
    description?: string
    tags?: string[]
    favourite?: boolean
    rating?: number
    sides?: { players: string[] }[]
  } | null
  /** Raw header players (`DemoRow.players`). */
  headerPlayers: readonly string[]
  /** Player names carried by the file-name-template facts (`DemoRow.nameFacts`); empty when none. */
  namePlayers: readonly string[]
  /** Effective date, as epoch ms, or null when unresolved. */
  date: number | null
}

export interface DemoListFilter {
  search: string
  mod: string | null
  gamemode: string | null
  map: string | null
  favouritesOnly: boolean
  minRating: number | null
  tags: string[]
  date: DateRangeValue | null
}

/** The filter with every criterion cleared — `filterDemos` returns every row unchanged for this. */
export const EMPTY_DEMO_LIST_FILTER: DemoListFilter = {
  search: '',
  mod: null,
  gamemode: null,
  map: null,
  favouritesOnly: false,
  minRating: null,
  tags: [],
  date: null,
}

/** Whether any criterion in `f` actually restricts the list — a blank/whitespace-only search does
 * not count, matching `matchesDemoSearch`'s own empty-term behaviour. */
export function isDemoFilterActive(f: DemoListFilter): boolean {
  return (
    f.mod !== null ||
    f.gamemode !== null ||
    f.map !== null ||
    f.favouritesOnly ||
    f.minRating !== null ||
    f.tags.length > 0 ||
    f.date !== null ||
    f.search.trim() !== ''
  )
}

/** `DemoListFilter`'s zod payload schema — `.strict()` so an unknown key is rejected outright, same
 * convention as the module's other persisted/IPC schemas. `date` is deliberately the odd one out: a
 * missing or structurally malformed value degrades to `null` alone (`.catch(null)`) rather than
 * failing the whole object, so a mangled date filter never wipes every sibling field the way a
 * mangled `minRating` does — see `normalizeDemoListFilter` for the second half (semantically invalid
 * ranges, e.g. `from > to`), which this schema cannot express. */
export const demoListFilterSchema = z
  .object({
    search: z.string().max(200),
    mod: z.string().max(64).nullable(),
    gamemode: z.string().max(64).nullable(),
    map: z.string().max(64).nullable(),
    favouritesOnly: z.boolean(),
    minRating: z.number().int().min(1).max(10).nullable(),
    tags: z.array(z.string().min(1).max(40)).max(50),
    date: dateRangeValueSchema.nullable().catch(null),
  })
  .strict()

/**
 * Reduces `f.date` through `normalizeDateRange` — the half of the "invalid date filter -> null"
 * contract `demoListFilterSchema`'s `.catch(null)` cannot cover on its own, since a `custom` range
 * with `from` after `to` (or both ends open) is structurally valid zod-wise. Callers that parse a
 * stored/incoming `DemoListFilter` must run the result through this before using it.
 */
export function normalizeDemoListFilter(f: DemoListFilter): DemoListFilter {
  return { ...f, date: normalizeDateRange(f.date) }
}

/**
 * Whether `s` matches a free-text search term: an empty (or whitespace-only) term always matches.
 * Otherwise matches case-insensitively against the subject's name, file name, map, sidecar
 * description, every sidecar tag, every player of every sidecar side, every header player, and
 * every name-fact player. Never throws.
 */
export function matchesDemoSearch(s: DemoFilterSubject, term: string): boolean {
  const t = term.trim().toLowerCase()
  if (t === '') return true

  const includes = (value: string | undefined | null): boolean =>
    value !== undefined && value !== null && value.toLowerCase().includes(t)

  if (includes(s.name)) return true
  if (includes(s.fileName)) return true
  if (includes(s.map)) return true
  if (includes(s.sidecar?.description)) return true

  if (s.sidecar?.tags?.some((tag) => tag.toLowerCase().includes(t))) return true
  if (s.sidecar?.sides?.some((side) => side.players.some((p) => p.toLowerCase().includes(t))))
    return true
  if (s.headerPlayers.some((p) => p.toLowerCase().includes(t))) return true
  if (s.namePlayers.some((p) => p.toLowerCase().includes(t))) return true

  return false
}

function matchesText(value: string | null, filterValue: string): boolean {
  return value !== null && value.toLowerCase() === filterValue.toLowerCase()
}

/**
 * Whether `s` satisfies every active criterion in `f` (search plus each select/toggle/list that is
 * not at its "not applied" value). An inactive field is skipped entirely rather than evaluated.
 */
export function matchesDemoFilter(
  s: DemoFilterSubject,
  f: DemoListFilter,
  nowMs: number = Date.now(),
): boolean {
  if (!matchesDemoSearch(s, f.search)) return false

  if (f.mod !== null && !matchesText(s.mod, f.mod)) return false
  if (f.map !== null && !matchesText(s.map, f.map)) return false
  if (
    f.gamemode !== null &&
    !gamemodeFilterMatches(s.gamemode, { gamemode: f.gamemode, excludeGuessed: false })
  ) {
    return false
  }

  if (f.favouritesOnly && s.sidecar?.favourite !== true) return false

  if (f.minRating !== null) {
    const rating = s.sidecar?.rating
    if (rating === undefined || rating < f.minRating) return false
  }

  if (f.tags.length > 0) {
    const tags = s.sidecar?.tags
    if (tags === undefined) return false
    const lowerTags = tags.map((t) => t.toLowerCase())
    if (!f.tags.some((tag) => lowerTags.includes(tag.toLowerCase()))) return false
  }

  if (!matchesDateRange(s.date, resolveDateRange(f.date, nowMs))) return false

  return true
}

/**
 * Filters `rows` by `f`, preserving input order (never sorts, never mutates). Returns a new array
 * containing every row, in the same order, when no criterion in `f` is active.
 */
export function filterDemos<T>(
  rows: readonly T[],
  f: DemoListFilter,
  toSubject: (row: T) => DemoFilterSubject,
  nowMs: number = Date.now(),
): T[] {
  return rows.filter((row) => matchesDemoFilter(toSubject(row), f, nowMs))
}

function distinctSorted(values: (string | undefined | null)[]): string[] {
  const seen = new Map<string, string>()
  for (const value of values) {
    if (value === undefined || value === null) continue
    const key = value.toLowerCase()
    if (!seen.has(key)) seen.set(key, value)
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b))
}

/** One gamemode filter dropdown option: the raw value to filter by, plus either a translated-label
 * key (known id) or literal display text (free text) — mirrors `describeGamemode`'s own split. */
export interface DemoGamemodeFilterOption {
  value: string
  labelKey?: string
  label?: string
}

/** The distinct `mod`/`map`/`tags` values and the gamemode options (via `gamemodeFilterOptions`,
 * described with `describeGamemode`) across `subjects`, deduped case-insensitively (first spelling
 * encountered wins) and sorted with `localeCompare`, for populating filter dropdowns. */
export function demoFilterOptions(subjects: readonly DemoFilterSubject[]): {
  mods: string[]
  maps: string[]
  gamemodes: DemoGamemodeFilterOption[]
  tags: string[]
} {
  const gamemodes = gamemodeFilterOptions(subjects.map((s) => s.gamemode)).map((value) => {
    const described = describeGamemode({ value, source: 'sidecar' })
    return described.labelKey !== undefined
      ? { value, labelKey: described.labelKey }
      : { value, label: described.text ?? value }
  })

  return {
    mods: distinctSorted(subjects.map((s) => s.mod)),
    maps: distinctSorted(subjects.map((s) => s.map)),
    gamemodes,
    tags: distinctSorted(subjects.flatMap((s) => s.sidecar?.tags ?? [])),
  }
}

/** `EffectiveValues.gamemode`'s source is typed as the wider `ValueSource` (it reuses `Effective<T>`
 * generically), but `resolveEffectiveValues` only ever assigns it `'sidecar' | 'name' | 'guessed'`
 * (or leaves it `null`) — narrowing here is a cast on that documented invariant, not a guess. */
function toEffectiveGamemode(g: DemoRow['effective']['gamemode']): EffectiveGamemode {
  if (g.source === null) return { value: null, source: 'none' }
  return { value: g.value, source: g.source as GamemodeSource }
}

/** Adapts a `DemoRow` (story 150's shared row type) into a `DemoFilterSubject`, reusing the row's
 * already-resolved `effective` values rather than recomputing them. */
export function demoFilterSubject(row: DemoRow): DemoFilterSubject {
  return {
    fileName: row.fileName,
    name: row.effective.name.value,
    map: row.effective.map.value,
    mod: row.effective.mod.value,
    gamemode: toEffectiveGamemode(row.effective.gamemode),
    sidecar: row.sidecar.state === 'none' ? null : row.sidecar.values,
    headerPlayers: row.players,
    namePlayers: row.nameFacts?.players ?? [],
    date: row.effective.date.value,
  }
}
