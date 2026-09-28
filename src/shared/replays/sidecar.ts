/**
 * Demo sidecar files — a small JSON file living next to a demo (e.g. `final.dm2.json`) that
 * carries what the user wrote about that demo: a name, a description, tags, favourite/rating,
 * teams/results/players per side, and so on. This module only defines the schema, normalises
 * user input into the smallest faithful representation, and serialises it deterministically; it
 * never reads or writes a file.
 *
 * Pure by contract: this file lives in `src/shared`, so no `node:*` import, no DOM types, no
 * `Buffer`, no IPC, no electron.
 */

import { z } from 'zod'

export const SIDECAR_SCHEMA_VERSION = 1

export const sidecarSideSchema = z
  .object({
    team: z.string().max(64).optional(),
    result: z.string().max(32).optional(),
    players: z.array(z.string().max(64)).max(64)
  })
  .strict()

export const sidecarFieldsSchema = z
  .object({
    name: z.string().max(200).optional(),
    description: z.string().max(4000).optional(),
    mod: z.string().max(64).optional(),
    gamemode: z.string().max(64).optional(),
    map: z.string().max(64).optional(),
    sides: z.array(sidecarSideSchema).max(16).optional(),
    tags: z.array(z.string().min(1).max(40)).max(50).optional(),
    favourite: z.boolean().optional(),
    rating: z.number().int().min(1).max(10).optional(),
    date: z.iso.datetime({ offset: true }).optional()
  })
  .strict()

export type SidecarSide = z.infer<typeof sidecarSideSchema>
export type SidecarFields = z.infer<typeof sidecarFieldsSchema>

export const sidecarFileSchema = sidecarFieldsSchema
  .extend({
    schemaVersion: z.literal(SIDECAR_SCHEMA_VERSION)
  })
  .strict()

export type SidecarFile = z.infer<typeof sidecarFileSchema>

/** Trims a string field; returns `undefined` if the trimmed result is empty. */
function normalizeOptionalString(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/** Trims each entry, drops empties, de-duplicates case-insensitively keeping the first spelling. */
function normalizeStringList(values: string[] | undefined): string[] | undefined {
  if (values === undefined) return undefined
  const seen = new Set<string>()
  const result: string[] = []
  for (const raw of values) {
    const trimmed = raw.trim()
    if (trimmed === '') continue
    const key = trimmed.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(trimmed)
  }
  return result.length === 0 ? undefined : result
}

function normalizeSide(side: SidecarSide): SidecarSide | undefined {
  const team = normalizeOptionalString(side.team)
  const result = normalizeOptionalString(side.result)
  const players = (side.players ?? []).map((p) => p.trim()).filter((p) => p !== '')

  if (team === undefined && result === undefined && players.length === 0) {
    return undefined
  }

  const normalized: SidecarSide = { players }
  if (team !== undefined) normalized.team = team
  if (result !== undefined) normalized.result = result
  return normalized
}

/**
 * Normalises user-entered sidecar fields into the smallest faithful representation: strings are
 * trimmed, empties dropped, lists de-duplicated, empty lists omitted, and `favourite: false`
 * (the default) omitted. Never adds a key that wasn't meaningfully present.
 */
export function normalizeSidecarFields(f: SidecarFields): SidecarFields {
  const out: SidecarFields = {}

  const name = normalizeOptionalString(f.name)
  if (name !== undefined) out.name = name

  const description = normalizeOptionalString(f.description)
  if (description !== undefined) out.description = description

  const mod = normalizeOptionalString(f.mod)
  if (mod !== undefined) out.mod = mod

  const gamemode = normalizeOptionalString(f.gamemode)
  if (gamemode !== undefined) out.gamemode = gamemode

  const map = normalizeOptionalString(f.map)
  if (map !== undefined) out.map = map

  if (f.sides !== undefined) {
    const sides = f.sides.map(normalizeSide).filter((s): s is SidecarSide => s !== undefined)
    if (sides.length > 0) out.sides = sides
  }

  const tags = normalizeStringList(f.tags)
  if (tags !== undefined) out.tags = tags

  if (f.favourite === true) out.favourite = true

  if (f.rating !== undefined) out.rating = f.rating

  if (f.date !== undefined) out.date = f.date

  return out
}

/** True iff no keys remain on the given fields. */
export function isEmptySidecar(f: SidecarFields): boolean {
  return Object.keys(f).length === 0
}

/**
 * Serialises sidecar fields with a fixed key order (`schemaVersion` first, then the story's
 * field order), pretty-printed with 2-space indent and a trailing newline. Absent keys are
 * omitted entirely.
 */
export function serializeSidecar(f: SidecarFields): string {
  const out: Record<string, unknown> = { schemaVersion: SIDECAR_SCHEMA_VERSION }

  if (f.name !== undefined) out.name = f.name
  if (f.description !== undefined) out.description = f.description
  if (f.mod !== undefined) out.mod = f.mod
  if (f.gamemode !== undefined) out.gamemode = f.gamemode
  if (f.map !== undefined) out.map = f.map
  if (f.sides !== undefined) {
    out.sides = f.sides.map((side) => {
      const s: Record<string, unknown> = {}
      if (side.team !== undefined) s.team = side.team
      if (side.result !== undefined) s.result = side.result
      s.players = side.players
      return s
    })
  }
  if (f.tags !== undefined) out.tags = f.tags
  if (f.favourite !== undefined) out.favourite = f.favourite
  if (f.rating !== undefined) out.rating = f.rating
  if (f.date !== undefined) out.date = f.date

  return JSON.stringify(out, null, 2) + '\n'
}

/** The sidecar file name for a demo file name: the full demo file name, plus `.json`. */
export function sidecarFileName(demoFileName: string): string {
  return `${demoFileName}.json`
}
