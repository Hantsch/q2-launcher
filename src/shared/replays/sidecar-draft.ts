/**
 * The editable draft form of a demo sidecar: every field as a plain string (or string list) fit
 * for binding to a text input, plus the conversion to and from `SidecarFields`. This module is the
 * bridge between the editor UI's free-typed text and the strict, normalised sidecar schema; it
 * never reads or writes a file.
 *
 * Pure by contract: this file lives in `src/shared`, so no `node:*` import, no DOM types, no
 * `Buffer`, no IPC, no electron.
 */

import { normalizeSidecarFields, sidecarFieldsSchema, type SidecarFields } from './sidecar'

export type SidecarDraft = {
  name: string
  description: string
  mod: string
  gamemode: string
  map: string
  date: string
  rating: string
  favourite: boolean
  tags: string[]
  sides: Array<{ team: string; result: string; players: string[] }>
  originalDate: string | null
}

export const RATING_ERROR_KEY = 'replays.editor.error.rating' as const
export const DATE_ERROR_KEY = 'replays.editor.error.date' as const

/** Renders an ISO datetime string (with offset) into the local `YYYY-MM-DD HH:MM:SS` draft text. */
function isoToDraftText(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number): string => String(n).padStart(2, '0')
  const year = d.getFullYear()
  const month = pad(d.getMonth() + 1)
  const day = pad(d.getDate())
  const hours = pad(d.getHours())
  const minutes = pad(d.getMinutes())
  const seconds = pad(d.getSeconds())
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
}

/** Maps sidecar fields (possibly partial/absent) into their draft-form representation. */
export function draftFromSidecar(values: Partial<SidecarFields>): SidecarDraft {
  return {
    name: values.name ?? '',
    description: values.description ?? '',
    mod: values.mod ?? '',
    gamemode: values.gamemode ?? '',
    map: values.map ?? '',
    date: values.date !== undefined ? isoToDraftText(values.date) : '',
    rating: values.rating !== undefined ? String(values.rating) : '',
    favourite: values.favourite ?? false,
    tags: values.tags !== undefined ? [...values.tags] : [],
    sides:
      values.sides !== undefined
        ? values.sides.map((s) => ({
            team: s.team ?? '',
            result: s.result ?? '',
            players: [...s.players]
          }))
        : [],
    originalDate: values.date ?? null
  }
}

/** Parses a `YYYY-MM-DD HH:MM[:SS]` local-time string into a real Date, or `null` if unparsable. */
function parseLocalDateTime(text: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(text.trim())
  if (!match) return null
  const [, yearS, monthS, dayS, hourS, minuteS, secondS] = match
  const year = Number(yearS)
  const month = Number(monthS)
  const day = Number(dayS)
  const hour = Number(hourS)
  const minute = Number(minuteS)
  const second = secondS !== undefined ? Number(secondS) : 0

  const d = new Date(year, month - 1, day, hour, minute, second)
  // Reject overflowed dates/times (e.g. 2026-02-30, 2026-13-01, 10:70) — Date normalises them
  // silently, so verify the round-trip matches exactly what was typed.
  if (
    d.getFullYear() !== year ||
    d.getMonth() !== month - 1 ||
    d.getDate() !== day ||
    d.getHours() !== hour ||
    d.getMinutes() !== minute ||
    d.getSeconds() !== second
  ) {
    return null
  }
  return d
}

/** Formats a Date's local UTC offset as `±HH:MM`, matching `z.iso.datetime({ offset: true })`. */
function formatOffset(d: Date): string {
  const offsetMinutes = -d.getTimezoneOffset()
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const abs = Math.abs(offsetMinutes)
  const hours = String(Math.floor(abs / 60)).padStart(2, '0')
  const minutes = String(abs % 60).padStart(2, '0')
  return `${sign}${hours}:${minutes}`
}

function localDateTimeToIso(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  const year = d.getFullYear()
  const month = pad(d.getMonth() + 1)
  const day = pad(d.getDate())
  const hours = pad(d.getHours())
  const minutes = pad(d.getMinutes())
  const seconds = pad(d.getSeconds())
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${formatOffset(d)}`
}

/** Converts the draft's rating text; returns `undefined` for empty, a number, or `'error'`. */
function convertRating(text: string): number | undefined | 'error' {
  const trimmed = text.trim()
  if (trimmed === '') return undefined
  if (!/^-?\d+$/.test(trimmed)) return 'error'
  const n = Number(trimmed)
  if (!Number.isInteger(n) || n < 1 || n > 10) return 'error'
  return n
}

/** Converts the draft's date text; returns `undefined` for empty, an ISO string, or `'error'`. */
function convertDate(draft: Pick<SidecarDraft, 'date' | 'originalDate'>): string | undefined | 'error' {
  const trimmed = draft.date.trim()
  if (trimmed === '') return undefined

  // If unchanged from what draftFromSidecar would have produced for originalDate, return the
  // original verbatim rather than re-deriving it (avoids lossy round-trips through local time).
  if (draft.originalDate !== null && trimmed === isoToDraftText(draft.originalDate).trim()) {
    return draft.originalDate
  }

  const parsed = parseLocalDateTime(trimmed)
  if (parsed === null) return 'error'
  return localDateTimeToIso(parsed)
}

/** Builds a best-effort raw `SidecarFields` from a draft's non-rating/date fields. */
function rawFieldsFromDraftBase(draft: SidecarDraft): SidecarFields {
  const out: SidecarFields = {}
  if (draft.name !== '') out.name = draft.name
  if (draft.description !== '') out.description = draft.description
  if (draft.mod !== '') out.mod = draft.mod
  if (draft.gamemode !== '') out.gamemode = draft.gamemode
  if (draft.map !== '') out.map = draft.map
  if (draft.sides.length > 0) {
    out.sides = draft.sides.map((s) => ({
      team: s.team,
      result: s.result,
      players: [...s.players]
    }))
  }
  if (draft.tags.length > 0) out.tags = [...draft.tags]
  if (draft.favourite) out.favourite = true
  return out
}

/**
 * Converts a draft into schema-valid sidecar fields, or reports rating/date errors. Every other
 * field is normalised via `normalizeSidecarFields` and validated through `sidecarFieldsSchema`.
 */
export function draftToFields(
  draft: SidecarDraft
): { ok: true; fields: SidecarFields } | { ok: false; errors: Partial<Record<'rating' | 'date', string>> } {
  const rating = convertRating(draft.rating)
  const date = convertDate(draft)

  const errors: Partial<Record<'rating' | 'date', string>> = {}
  if (rating === 'error') errors.rating = RATING_ERROR_KEY
  if (date === 'error') errors.date = DATE_ERROR_KEY
  if (Object.keys(errors).length > 0) return { ok: false, errors }

  const raw = rawFieldsFromDraftBase(draft)
  if (typeof rating === 'number') raw.rating = rating
  if (typeof date === 'string') raw.date = date

  const normalized = normalizeSidecarFields(raw)
  const fields = sidecarFieldsSchema.parse(normalized)
  return { ok: true, fields }
}

/**
 * Best-effort, non-throwing conversion used only for dirty-checking: rating/date that don't
 * currently parse are simply omitted rather than blocking the comparison.
 */
function bestEffortFields(draft: SidecarDraft): SidecarFields {
  const raw = rawFieldsFromDraftBase(draft)
  const rating = convertRating(draft.rating)
  if (typeof rating === 'number') raw.rating = rating
  const date = convertDate(draft)
  if (typeof date === 'string') raw.date = date
  return normalizeSidecarFields(raw)
}

/** True iff the draft differs from the baseline once both are normalised (whitespace-insensitive). */
export function isDraftDirty(draft: SidecarDraft, baseline: SidecarDraft): boolean {
  const a = bestEffortFields(draft)
  const b = bestEffortFields(baseline)
  return JSON.stringify(a) !== JSON.stringify(b)
}

export function addSide(draft: SidecarDraft): SidecarDraft {
  return { ...draft, sides: [...draft.sides, { team: '', result: '', players: [] }] }
}

export function removeSide(draft: SidecarDraft, index: number): SidecarDraft {
  return { ...draft, sides: draft.sides.filter((_, i) => i !== index) }
}

export function addPlayer(draft: SidecarDraft, side: number, name: string): SidecarDraft {
  const trimmed = name.trim()
  if (trimmed === '') return draft
  const target = draft.sides[side]
  if (target === undefined) return draft
  const exists = target.players.some((p) => p.toLowerCase() === trimmed.toLowerCase())
  if (exists) return draft

  const sides = draft.sides.map((s, i) => (i === side ? { ...s, players: [...s.players, trimmed] } : s))
  return { ...draft, sides }
}

export function removePlayer(draft: SidecarDraft, side: number, index: number): SidecarDraft {
  const sides = draft.sides.map((s, i) =>
    i === side ? { ...s, players: s.players.filter((_, pi) => pi !== index) } : s
  )
  return { ...draft, sides }
}

export function movePlayer(
  draft: SidecarDraft,
  side: number,
  index: number,
  direction: -1 | 1
): SidecarDraft {
  const target = draft.sides[side]
  if (target === undefined) return draft
  const newIndex = index + direction
  if (newIndex < 0 || newIndex >= target.players.length) return draft

  const players = [...target.players]
  const tmp = players[index]!
  players[index] = players[newIndex]!
  players[newIndex] = tmp

  const sides = draft.sides.map((s, i) => (i === side ? { ...s, players } : s))
  return { ...draft, sides }
}

export function addTag(draft: SidecarDraft, tag: string): SidecarDraft {
  const trimmed = tag.trim()
  if (trimmed === '' || trimmed.length > 40) return draft
  if (draft.tags.some((t) => t.toLowerCase() === trimmed.toLowerCase())) return draft
  if (draft.tags.length >= 50) return draft
  return { ...draft, tags: [...draft.tags, trimmed] }
}

export function removeTag(draft: SidecarDraft, tag: string): SidecarDraft {
  return { ...draft, tags: draft.tags.filter((t) => t.toLowerCase() !== tag.toLowerCase()) }
}

/**
 * Ranks other demos' tags by usage count (desc, then alphabetical) for autocomplete, excluding
 * tags already present on the current draft and keeping only those matching `input` as a
 * case-insensitive substring. Caps at 8 results.
 */
export function suggestTags(otherDemosTags: string[][], input: string, current: string[]): string[] {
  const currentLower = new Set(current.map((t) => t.toLowerCase()))
  const inputLower = input.toLowerCase()

  const counts = new Map<string, { count: number; spellings: Map<string, number> }>()
  for (const tags of otherDemosTags) {
    for (const tag of tags) {
      const key = tag.toLowerCase()
      if (currentLower.has(key)) continue
      if (!key.includes(inputLower)) continue
      let entry = counts.get(key)
      if (entry === undefined) {
        entry = { count: 0, spellings: new Map() }
        counts.set(key, entry)
      }
      entry.count += 1
      entry.spellings.set(tag, (entry.spellings.get(tag) ?? 0) + 1)
    }
  }

  const ranked = [...counts.entries()].map(([, entry]) => {
    // Keep the most-used spelling; ties broken alphabetically for stability.
    const bestSpelling = [...entry.spellings.entries()].sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1]
      return a[0].localeCompare(b[0])
    })[0]![0]
    return { count: entry.count, spelling: bestSpelling }
  })

  return ranked
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count
      return a.spelling.localeCompare(b.spelling)
    })
    .slice(0, 8)
    .map((v) => v.spelling)
}

/**
 * Applies a quick favourite/rating patch directly onto on-disk sidecar fields, leaving every
 * other field untouched (no normalisation pass, so unrelated fields can never be silently
 * dropped or altered).
 */
export function withQuickEdit(
  values: Partial<SidecarFields>,
  patch: { favourite?: boolean; rating?: number | null }
): SidecarFields {
  const out: SidecarFields = { ...values }

  if ('favourite' in patch) {
    if (patch.favourite) {
      out.favourite = true
    } else {
      delete out.favourite
    }
  }

  if ('rating' in patch) {
    if (patch.rating === null || patch.rating === undefined) {
      delete out.rating
    } else {
      out.rating = patch.rating
    }
  }

  return out
}
