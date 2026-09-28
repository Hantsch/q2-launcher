/**
 * Effective gamemode resolution for a demo row — sidecar/name-fact/heuristic precedence, the
 * heuristic table itself, an i18n-facing describer and the filter predicate the demo browser's
 * gamemode filter uses. Mirrors `src/shared/servers/row-markers.ts` and `list-filter.ts`'s
 * conventions: pure, never throws, a missing/unparseable source value never gets an invented
 * default beyond what the heuristics explicitly claim.
 *
 * Pure by contract: this file lives in `src/shared`, so no `node:*` import, no DOM types, no IPC.
 */
import { OPENTDM_PATTERN_ID } from '../replays/name-patterns'

/** A gamemode the launcher recognizes by id and can show a translated label for. */
export type KnownGamemode = 'ctf' | 'tdm' | 'duel'

/** Where an `EffectiveGamemode`'s value came from, in resolution precedence order. */
export type GamemodeSource = 'sidecar' | 'name' | 'guessed' | 'none'

/** The gamemode the demo browser shows for a row, plus where that value came from. */
export interface EffectiveGamemode {
  value: string | null
  source: GamemodeSource
}

const KNOWN_GAMEMODES: readonly KnownGamemode[] = ['ctf', 'tdm', 'duel']

/** Re-exported for anywhere that needs the OpenTDM pattern id without importing `name-patterns.ts`
 * directly (kept as a single re-export rather than a second literal). */
export { OPENTDM_PATTERN_ID }

function normalise(value: string): string {
  const trimmed = value.trim()
  const known = KNOWN_GAMEMODES.find((id) => id.toLowerCase() === trimmed.toLowerCase())
  return known ?? trimmed
}

/** Input the resolver and heuristic table read from — everything is optional since not every
 * source is always available for a given demo row. */
export interface GamemodeResolveInput {
  sidecar?: string
  nameFact?: string
  gameDir?: string
  matchedPatternId?: string
  playerCount?: number
}

/**
 * A single heuristic rule: `test` decides whether `mode` applies given the resolver's input. Rules
 * are tried in array order and the first match wins — see `GAMEMODE_HEURISTICS` for the exact,
 * order-significant table.
 */
export interface GamemodeHeuristic {
  id: string
  mode: KnownGamemode
  test: (input: GamemodeResolveInput) => boolean
}

function eqCi(value: string | undefined, target: string): boolean {
  return value !== undefined && value.toLowerCase() === target.toLowerCase()
}

/**
 * Ordered heuristic table, first match wins — all three rules produce `source: 'guessed'` (never a
 * final answer, always superseded by a sidecar or name-fact value at the resolver level):
 * 1. `gameDir` is `ctf` (case-insensitively) → `ctf`.
 * 2. Exactly two known players → `duel` (checked before the OpenTDM rule, so a two-player OpenTDM
 *    match still guesses `duel`).
 * 3. The matched name pattern is the shipped OpenTDM pattern, or `gameDir` is `opentdm` → `tdm`.
 */
export const GAMEMODE_HEURISTICS: readonly GamemodeHeuristic[] = [
  {
    id: 'ctf-game-dir',
    mode: 'ctf',
    test: (input) => eqCi(input.gameDir, 'ctf'),
  },
  {
    id: 'two-players-duel',
    mode: 'duel',
    test: (input) => input.playerCount === 2,
  },
  {
    id: 'opentdm-pattern-or-dir',
    mode: 'tdm',
    test: (input) => input.matchedPatternId === OPENTDM_PATTERN_ID || eqCi(input.gameDir, 'opentdm'),
  },
]

/**
 * Resolves a demo row's effective gamemode. Rungs, in order: a non-blank `sidecar` value; a
 * non-blank `nameFact`; the first matching `GAMEMODE_HEURISTICS` rule; else unknown
 * (`{ value: null, source: 'none' }`). A sidecar/name value that matches a known id
 * case-insensitively is normalised to that id; any other value is passed through trimmed as free
 * text. Never throws.
 */
export function resolveGamemode(input: GamemodeResolveInput): EffectiveGamemode {
  if (input.sidecar !== undefined && input.sidecar.trim() !== '') {
    return { value: normalise(input.sidecar), source: 'sidecar' }
  }
  if (input.nameFact !== undefined && input.nameFact.trim() !== '') {
    return { value: normalise(input.nameFact), source: 'name' }
  }
  const heuristic = GAMEMODE_HEURISTICS.find((rule) => rule.test(input))
  if (heuristic !== undefined) {
    return { value: heuristic.mode, source: 'guessed' }
  }
  return { value: null, source: 'none' }
}

/** Every i18n key `describeGamemode` can return, for coverage checks/tests against the locale
 * files. */
export const GAMEMODE_I18N_KEYS: readonly string[] = [
  'replays.gamemode.ctf',
  'replays.gamemode.tdm',
  'replays.gamemode.duel',
  'replays.gamemode.unknown',
  'replays.gamemode.guessed',
]

/** What a UI surface needs to render an `EffectiveGamemode`: either a translated-label key (known
 * id or unknown) or literal free text, plus a `guessedKey` marker present only when the value was
 * guessed rather than reported by a sidecar or the file name. */
export interface GamemodeDescription {
  labelKey?: string
  text?: string
  guessedKey?: string
}

/**
 * Describes `g` for display: a known id gets its label key, unknown (`value: null`) gets the
 * `unknown` label key, and any other free text is shown verbatim. `guessedKey` is added on top of
 * whichever of those applies, only when `g.source === 'guessed'`.
 */
export function describeGamemode(g: EffectiveGamemode): GamemodeDescription {
  const guessedKey = g.source === 'guessed' ? 'replays.gamemode.guessed' : undefined

  if (g.value === null) {
    return { labelKey: 'replays.gamemode.unknown', ...(guessedKey !== undefined ? { guessedKey } : {}) }
  }
  if ((KNOWN_GAMEMODES as readonly string[]).includes(g.value)) {
    return { labelKey: `replays.gamemode.${g.value}`, ...(guessedKey !== undefined ? { guessedKey } : {}) }
  }
  return { text: g.value, ...(guessedKey !== undefined ? { guessedKey } : {}) }
}

/** The demo browser's gamemode filter: `gamemode: null` means "any"; `excludeGuessed` additionally
 * drops rows whose effective value was only guessed, never reported. */
export interface GamemodeFilter {
  gamemode: string | null
  excludeGuessed: boolean
}

/**
 * Whether `g` matches `filter`. `filter.gamemode === null` ("any") matches every row except a
 * guessed one when `excludeGuessed` is set. A specific `filter.gamemode` requires `g.value` to
 * equal it case-insensitively (so an unknown row, `value: null`, never matches a specific filter)
 * and, again, is rejected if guessed while `excludeGuessed` is set.
 */
export function gamemodeFilterMatches(g: EffectiveGamemode, filter: GamemodeFilter): boolean {
  if (filter.gamemode === null) {
    return !(filter.excludeGuessed && g.source === 'guessed')
  }
  if (g.value === null || g.value.toLowerCase() !== filter.gamemode.toLowerCase()) return false
  return !(filter.excludeGuessed && g.source === 'guessed')
}

/**
 * Distinct non-null `value`s across `gs`, known and guessed merged together, sorted ascending —
 * for populating the gamemode filter's dropdown options.
 */
export function gamemodeFilterOptions(gs: EffectiveGamemode[]): string[] {
  const seen = new Set<string>()
  for (const g of gs) {
    if (g.value !== null) seen.add(g.value)
  }
  return [...seen].sort()
}
