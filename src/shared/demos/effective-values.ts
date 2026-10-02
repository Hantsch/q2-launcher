/**
 * Effective-value resolver for a demo file: for each user-facing field (name, map, mod, gamemode,
 * sides, date, pov, host) picks the first "rung" that actually has a value — sidecar override,
 * demo header, file-name template facts, file system time, or a last-resort guess — and reports
 * which rung won, so the UI can show the user where a value came from.
 *
 * Pure by contract: this file lives in `src/shared`, so no `node:*` import, no DOM types, no
 * `Buffer`, no IPC, no electron.
 */

import type { SidecarFields } from '../replays/sidecar'
import type { NameFacts } from '../replays/name-template'
import type { Dm2Header, Dm2Unparsable } from './dm2-header'
import type { Mvd2Header, Mvd2Unparsable } from './mvd2-header'
import { resolveGamemode } from './gamemode'

/** The sources a field's effective value can come from, ordered from most to least authoritative
 * (the order here is documentation only — actual precedence is encoded per-field by the rung
 * order passed to `firstValue`). */
export const VALUE_SOURCES = ['sidecar', 'demo', 'name', 'file', 'guessed'] as const

export type ValueSource = (typeof VALUE_SOURCES)[number]

export type Effective<T> = { value: T; source: ValueSource } | { value: null; source: null }

/** True unless `v` is null/undefined, a string that is blank after trimming, or an empty array. */
export function hasValue(v: unknown): boolean {
  if (v === null || v === undefined) return false
  if (typeof v === 'string') return v.trim() !== ''
  if (Array.isArray(v)) return v.length > 0
  return true
}

/**
 * Returns the first rung whose value satisfies `hasValue`, wrapped with its source. Exported so a
 * later story can extend the candidate list for a single field without touching the others.
 */
export function firstValue<T>(
  rungs: ReadonlyArray<{ source: ValueSource; value: T | null | undefined }>,
): Effective<T> {
  for (const rung of rungs) {
    if (hasValue(rung.value)) return { value: rung.value as T, source: rung.source }
  }
  return { value: null, source: null }
}

/** The file time to use when nothing else supplies a date: `birthtimeMs` when it is a trustworthy
 * creation time (finite, positive, not after `mtimeMs`), else `mtimeMs`. */
export function effectiveFileTime(stats: { birthtimeMs: number; mtimeMs: number }): number {
  const { birthtimeMs, mtimeMs } = stats
  if (Number.isFinite(birthtimeMs) && birthtimeMs > 0 && birthtimeMs <= mtimeMs) return birthtimeMs
  return mtimeMs
}

export interface ResolveEffectiveValuesInputs {
  fileName: string
  sidecar: Partial<SidecarFields> | null
  header: Dm2Header | Dm2Unparsable | Mvd2Header | Mvd2Unparsable | null
  nameFacts: NameFacts | null
  fileTime: { birthtimeMs: number; mtimeMs: number }
  /** The id of the shipped/user name pattern that matched this file, from `parseDemoName`, if any —
   * used only for the gamemode heuristic. */
  matchedPatternId?: string
}

export interface EffectiveSide {
  team?: string
  result?: string
  players: string[]
}

export interface EffectiveValues {
  name: Effective<string>
  map: Effective<string>
  mod: Effective<string>
  gamemode: Effective<string>
  sides: Effective<EffectiveSide[]>
  date: Effective<number>
  pov: Effective<string>
  host: Effective<string>
}

/** The header, narrowed to its `ok: true` shape, or `null` when absent/unparsable. Both `Dm2Header`
 * and `Mvd2Header` share the fields this module reads (`map`, `pov`, `players`, `gameDir`). */
type OkHeader = {
  ok: true
  gameDir: string
  map: string | null
  pov: string | null
  players: string[]
}

function okHeader(header: ResolveEffectiveValuesInputs['header']): OkHeader | null {
  return header !== null && header.ok ? header : null
}

/** Parses a name-fact date (local time zone), or `undefined` if no date fact is present. */
function nameFactDateMs(nameFacts: NameFacts | null): number | undefined {
  const date = nameFacts?.date
  if (date === undefined) return undefined
  const { year, month, day } = date
  const hour = date.hour ?? 0
  const minute = date.minute ?? 0
  const second = date.second ?? 0
  return new Date(year, month - 1, day, hour, minute, second).getTime()
}

/** Parses a sidecar ISO date string, or `undefined` if absent/unparsable. */
function sidecarDateMs(sidecar: Partial<SidecarFields> | null): number | undefined {
  const raw = sidecar?.date
  if (raw === undefined) return undefined
  const parsed = Date.parse(raw)
  return Number.isNaN(parsed) ? undefined : parsed
}

export function resolveEffectiveValues(inputs: ResolveEffectiveValuesInputs): EffectiveValues {
  const { fileName, sidecar, nameFacts, fileTime, matchedPatternId } = inputs
  const header = okHeader(inputs.header)

  const name = firstValue<string>([
    { source: 'sidecar', value: sidecar?.name },
    { source: 'name', value: fileName },
  ])

  const map = firstValue<string>([
    { source: 'sidecar', value: sidecar?.map },
    { source: 'demo', value: header?.map ?? undefined },
    { source: 'name', value: nameFacts?.map },
  ])

  const mod = firstValue<string>([
    { source: 'sidecar', value: sidecar?.mod },
    { source: 'demo', value: header?.gameDir },
  ])

  const demoPlayers = header?.players
  const namePlayers = nameFacts?.players
  const sides = firstValue<EffectiveSide[]>([
    { source: 'sidecar', value: sidecar?.sides },
    {
      source: 'demo',
      value:
        demoPlayers !== undefined && demoPlayers.length > 0
          ? [{ players: demoPlayers }]
          : undefined,
    },
    {
      source: 'name',
      value:
        namePlayers !== undefined && namePlayers.length > 0
          ? [{ players: namePlayers }]
          : undefined,
    },
  ])

  const playerCount =
    sides.value !== null
      ? sides.value.reduce((sum, side) => sum + side.players.length, 0)
      : undefined

  const gamemodeResult = resolveGamemode({
    sidecar: sidecar?.gamemode,
    nameFact: nameFacts?.gamemode,
    gameDir: mod.value ?? undefined,
    matchedPatternId,
    playerCount,
  })
  const gamemode: Effective<string> =
    gamemodeResult.source === 'none'
      ? { value: null, source: null }
      : { value: gamemodeResult.value as string, source: gamemodeResult.source }

  const date = firstValue<number>([
    { source: 'sidecar', value: sidecarDateMs(sidecar) },
    { source: 'name', value: nameFactDateMs(nameFacts) },
    { source: 'file', value: effectiveFileTime(fileTime) },
  ])

  const pov = firstValue<string>([
    { source: 'demo', value: header?.pov ?? undefined },
    { source: 'name', value: nameFacts?.pov },
  ])

  const host = firstValue<string>([{ source: 'name', value: nameFacts?.host }])

  return { name, map, mod, gamemode, sides, date, pov, host }
}
