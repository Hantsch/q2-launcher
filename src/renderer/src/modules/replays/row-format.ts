import type { EffectiveSide } from '@shared/demos/effective-values'
import type { DemoFormat } from '@shared/modules/replays'

/**
 * The demo row's pure value formatters - same reasoning as `../servers/server-format.ts`: a
 * malformed field must degrade cleanly rather than throw, and the row component never re-derives
 * these rules itself.
 */

const DEFAULT_MORE_SUFFIX = (count: number): string => `+${count}`

/** One side's label: its team name when set (trimmed non-blank), else its player list. A player
 * list longer than three names is capped to the first three plus a `+n` suffix - `moreSuffix`
 * lets the caller supply translated text; a bare `+n` is the default so this stays usable without
 * one. */
function sideLabel(side: EffectiveSide, moreSuffix: (count: number) => string): string {
  if (side.team !== undefined && side.team.trim() !== '') return side.team
  const players = side.players
  if (players.length === 0) return ''
  if (players.length > 3) {
    return `${players.slice(0, 3).join(', ')} ${moreSuffix(players.length - 3)}`
  }
  return players.join(', ')
}

/**
 * Renders a demo's sides as one line: each side's label (team name, else players), joined
 * `" vs "`. A single unsided side of exactly two players is the common "just two players, no
 * teams" case - shown as `"A vs B"` rather than one comma-joined blob. Never throws; an empty
 * side list renders `''` (the caller shows `UnknownValue` for that).
 */
export function sidesText(
  sides: EffectiveSide[],
  moreSuffix: (count: number) => string = DEFAULT_MORE_SUFFIX,
): string {
  if (sides.length === 0) return ''

  const [only] = sides
  if (
    sides.length === 1 &&
    (only.team === undefined || only.team.trim() === '') &&
    only.players.length === 2
  ) {
    return `${only.players[0]} vs ${only.players[1]}`
  }

  return sides
    .map((side) => sideLabel(side, moreSuffix))
    .filter((label) => label !== '')
    .join(' vs ')
}

/**
 * Formats a demo's effective date (ms since epoch) as a localised date + short time. A non-finite
 * or missing value (the "unknown" case `resolveEffectiveValues` reports as `{ value: null }`)
 * becomes `null` - never a garbage date - and any `Intl` failure (an unrecognised `locale`) is
 * swallowed the same way rather than thrown.
 */
export function formatDemoDate(ms: number | null | undefined, locale: string): string | null {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return null
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(ms),
    )
  } catch {
    return null
  }
}

/** Formats a demo's container format for display - `replays.format.dm2`/`replays.format.mvd2`,
 * wrapped in `replays.format.gzip` when gzip-compressed. Takes a translator (same convention as
 * `sidesText`'s `moreSuffix`) rather than importing react-i18next, so this stays a plain function a
 * non-React test can call directly. */
export function formatLabel(
  format: DemoFormat,
  gzip: boolean,
  t: (key: string, params?: Record<string, unknown>) => string,
): string {
  const base = t(`replays.format.${format}`)
  return gzip ? t('replays.format.gzip', { format: base }) : base
}
