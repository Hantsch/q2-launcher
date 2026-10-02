/**
 * Demo detail model — story 155: the field-by-field view a demo's detail panel renders, built from
 * a `DemoRow` (`src/shared/modules/replays.ts`) plus its sidecar values. `buildDemoDetail` picks the
 * fixed, ordered set of fields the detail panel shows, omitting any field with no value anywhere
 * (never showing a blank), and separately reports the players the demo/file name actually know
 * about regardless of what the sidecar's `sides` says — the sidecar's sides only ever describe
 * teams/results, never rewrite who the launcher itself saw play.
 *
 * Pure by contract: this file lives in `src/shared`, so no `node:*` import, no DOM types, no
 * electron.
 */

import type { DemoRow } from '../modules/replays'
import type { SidecarFields, SidecarSide } from './sidecar'
import { hasValue, type ValueSource } from '../demos/effective-values'

export type DetailFieldId =
  'fileName' | 'duration' | 'date' | 'map' | 'mod' | 'gamemode' | 'sides' | 'pov'

/** The two ordered groups the detail renders: facts about the file, then facts about the match. */
export type DetailFieldGroup = 'file' | 'match'

export interface DemoDetailField {
  id: DetailFieldId
  group: DetailFieldGroup
  value: string | number | boolean | SidecarSide[] | string[]
  source: ValueSource | null
}

/** Mirrors `DemoRow['sidecar']`'s own `state` — the row never carries a real issues list (story
 * 147's per-field issues are consumed while the row is built, `src/main/modules/replays/demo-rows.ts`
 * keeps only the outcome), so this is the whole of what a row can report. */
export interface DemoDetailSidecarState {
  state: DemoRow['sidecar']['state']
}

export interface DemoDetail {
  fields: DemoDetailField[]
  knownPlayers: { demo: string[]; name: string[] }
  sidecarIssues: DemoDetailSidecarState
}

/** Trims each entry, drops empties, de-duplicates in encounter order (first spelling wins). */
function cleanPlayerList(players: string[] | undefined): string[] {
  if (players === undefined) return []
  const seen = new Set<string>()
  const result: string[] = []
  for (const raw of players) {
    const trimmed = raw.trim()
    if (trimmed === '') continue
    if (seen.has(trimmed)) continue
    seen.add(trimmed)
    result.push(trimmed)
  }
  return result
}

// `_sidecar` is unused: the sidecar's values already reach the row through `row.effective`.
export function buildDemoDetail(row: DemoRow, _sidecar: Partial<SidecarFields>): DemoDetail {
  const fields: DemoDetailField[] = []

  const push = (
    id: DetailFieldId,
    group: DetailFieldGroup,
    value: DemoDetailField['value'] | null | undefined,
    source: ValueSource | null,
  ) => {
    if (!hasValue(value)) return
    fields.push({ id, group, value: value as DemoDetailField['value'], source })
  }

  push('fileName', 'file', row.fileName, null)
  if (Number.isFinite(row.durationMs)) push('duration', 'file', row.durationMs as number, null)
  push('date', 'file', row.effective.date.value, row.effective.date.source)
  push('map', 'match', row.effective.map.value, row.effective.map.source)
  push('mod', 'match', row.effective.mod.value, row.effective.mod.source)
  push('gamemode', 'match', row.effective.gamemode.value, row.effective.gamemode.source)
  push(
    'sides',
    'match',
    row.effective.sides.value as SidecarSide[] | null,
    row.effective.sides.source,
  )
  push('pov', 'match', row.effective.pov.value, row.effective.pov.source)

  return {
    fields,
    knownPlayers: {
      demo: cleanPlayerList(row.players),
      name: cleanPlayerList(row.nameFacts?.players),
    },
    sidecarIssues: { state: row.sidecar.state },
  }
}
