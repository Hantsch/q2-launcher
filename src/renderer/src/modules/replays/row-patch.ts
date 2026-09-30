import { resolveEffectiveValues, type ResolveEffectiveValuesInputs } from '@shared/demos/effective-values'
import type { DemoRow, DiscoveredDemo } from '@shared/modules/replays'
import type { SidecarReadResult } from './demo-editor-store'

/**
 * Story 155: one row with a freshly read sidecar swapped in, its effective values re-resolved the
 * same way main's `buildDemoRow` (`src/main/modules/replays/demo-rows.ts`) composes them for
 * `index.read` - so a notes save updates the row's name/mod/favourite in place, without a rescan.
 * The header shape here must stay in step with that file's `headerFromRow`.
 */
export function rowWithSidecar(row: DiscoveredDemo, sidecar: SidecarReadResult): DemoRow {
  const header =
    row.readable && row.gameDir !== null
      ? ({
          ok: true,
          gameDir: row.gameDir,
          map: row.map,
          pov: row.pov,
          players: row.players,
        } as ResolveEffectiveValuesInputs['header'])
      : null
  const effective = resolveEffectiveValues({
    fileName: row.fileName,
    sidecar: sidecar.values,
    header,
    nameFacts: row.nameFacts,
    fileTime: row.fileTime,
  })
  return { ...row, sidecar: { state: sidecar.state.state, values: sidecar.values }, effective }
}
