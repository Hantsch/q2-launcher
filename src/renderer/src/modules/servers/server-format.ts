import type { ServerListRow } from '@shared/modules/servers'
import { knownPlayerCount } from '@shared/servers/row-markers'

/**
 * Story 122 D3: the row's value formatters, moved out of `ServerRow.tsx` so `ServerDetailHeader.tsx`
 * can reuse the exact same rules rather than re-deriving them - one bad field must render `—`
 * without breaking the rest, so every value on both surfaces is routed through these.
 */

/** Renders an unknown value as an em dash rather than `0` or blank (spec: "Every unknown value
 * renders as `—`, never `0` or blank"). Also treats a non-finite number (`NaN`, `Infinity`) and an
 * empty/non-string string as unknown - a malformed field must degrade to a dash, never throw or
 * render garbage. */
export function orDash(value: string | number | undefined | null): string {
  if (value === undefined || value === null) return '—'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '—'
  return value === '' ? '—' : value
}

/** A row's display name: its `name` when non-empty, its address otherwise. */
export function displayName(row: Pick<ServerListRow, 'name' | 'address'>): string {
  return row.name && row.name.length > 0 ? row.name : row.address
}

/** `x/y` occupancy formatting - each side independently dashed when unknown. */
export function formatOccupancy(row: Pick<ServerListRow, 'players' | 'maxclients'>): string {
  const playerCount = knownPlayerCount(row)
  return `${orDash(playerCount)}/${orDash(row.maxclients)}`
}

/** `N ms` ping formatting, dashed when unknown or non-finite (e.g. `NaN`). */
export function formatPing(row: Pick<ServerListRow, 'rttMs'>): string {
  return row.rttMs !== undefined && Number.isFinite(row.rttMs) ? `${row.rttMs} ms` : '—'
}
