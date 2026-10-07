import type { OkHeader } from '../demos/effective-values'
import type { DiscoveredDemo } from '../modules/replays'

/** The `ResolveEffectiveValuesInputs['header']` shape, built straight from the row: only when the
 * row parsed (`readable`) and actually carries a game dir - a readable row with no game dir has no
 * header worth resolving against. One builder for main's rows, rename and the renderer's re-resolve,
 * so "what the row shows" and "what a rename would lose" never diverge. */
export function headerFromRow(row: DiscoveredDemo): OkHeader | null {
  if (!row.readable || row.gameDir === null) return null
  // Only the fields `resolveEffectiveValues` reads - never a real `Dm2Header`/`Mvd2Header`.
  return {
    ok: true,
    gameDir: row.gameDir,
    map: row.map,
    pov: row.pov,
    players: row.players,
    roster: row.roster,
  }
}
