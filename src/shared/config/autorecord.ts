/**
 * Story 168 D1: the "record every map automatically" recipes, as pure logic over a profile's cvar
 * map. r1q2 has a native cvar (`cl_autorecord`); Q2PRO has none, so the recipe is a
 * `cl_beginmapcmd` command that runs `record` with macro-built names.
 *
 * Q2PRO expands `${...}` macros itself when the command runs, so the value is stored verbatim -
 * quotes and `$` stay intact. Reading is tolerant (players paste recipes with odd spacing and
 * alongside other commands); writing is minimal and never touches any other key.
 *
 * Pure by contract: lives in `src/shared`, no node, DOM or electron imports.
 */

import type { EngineKind } from '../types/engine'

export type AutorecordEngine = 'r1q2' | 'q2pro'

export interface AutorecordRecipe {
  /** Id in `SHIPPED_NAME_PATTERNS` that parses the file name this recipe produces. */
  patternId: string
}

/** The Q2PRO command, with literal `$`, `{` and `}` - Q2PRO expands the macros, not us. */
export const Q2PRO_AUTORECORD_COMMAND = 'record ${cl_mapname}_${com_date}_${com_time}'
/** The time format that makes the Q2PRO recipe's file name filesystem-safe (no colons). */
export const Q2PRO_TIME_FORMAT = '%H-%M-%S'

export const AUTORECORD_RECIPES: Record<AutorecordEngine, AutorecordRecipe> = {
  r1q2: { patternId: 'r1q2-autorecord' },
  q2pro: { patternId: 'q2pro-beginmapcmd' },
}

export type AutorecordState =
  { kind: 'unavailable' } | { kind: 'available'; engine: AutorecordEngine; on: boolean }

function recipeEngine(engine: EngineKind | null): AutorecordEngine | null {
  return engine === 'r1q2' || engine === 'q2pro' ? engine : null
}

function normalizeSegment(segment: string): string {
  return segment.trim().replace(/\s+/g, ' ')
}

function isRecipeSegment(segment: string): boolean {
  return normalizeSegment(segment) === Q2PRO_AUTORECORD_COMMAND
}

function q2proOn(cvars: Record<string, string>): boolean {
  const value = cvars['cl_beginmapcmd']
  return value !== undefined && value.split(';').some(isRecipeSegment)
}

export function readAutorecord(
  cvars: Record<string, string>,
  engine: EngineKind | null,
): AutorecordState {
  const kind = recipeEngine(engine)
  if (kind === null) return { kind: 'unavailable' }
  if (kind === 'r1q2') {
    const raw = (cvars['cl_autorecord'] ?? '').trim()
    const n = Number(raw)
    return { kind: 'available', engine: kind, on: raw !== '' && Number.isFinite(n) && n !== 0 }
  }
  return { kind: 'available', engine: kind, on: q2proOn(cvars) }
}

/** Returns a NEW cvar map with the recipe switched on or off; the input is never mutated. */
export function applyAutorecord(
  cvars: Record<string, string>,
  engine: EngineKind | null,
  on: boolean,
): Record<string, string> {
  const kind = recipeEngine(engine)
  const next = { ...cvars }
  if (kind === null) return next

  if (kind === 'r1q2') {
    if (on) next['cl_autorecord'] = '1'
    else delete next['cl_autorecord']
    return next
  }

  if (on) {
    if (!q2proOn(cvars)) {
      const existing = (cvars['cl_beginmapcmd'] ?? '')
        .trim()
        .replace(/;+\s*$/, '')
        .trim()
      next['cl_beginmapcmd'] =
        existing === '' ? Q2PRO_AUTORECORD_COMMAND : `${existing}; ${Q2PRO_AUTORECORD_COMMAND}`
    }
    next['com_time_format'] = Q2PRO_TIME_FORMAT
    return next
  }

  const value = cvars['cl_beginmapcmd']
  if (value !== undefined) {
    const rest = value
      .split(';')
      .map((segment) => segment.trim())
      .filter((segment) => segment !== '' && !isRecipeSegment(segment))
    if (rest.length === 0) delete next['cl_beginmapcmd']
    else next['cl_beginmapcmd'] = rest.join('; ')
  }
  if (cvars['com_time_format'] === Q2PRO_TIME_FORMAT) delete next['com_time_format']
  return next
}
