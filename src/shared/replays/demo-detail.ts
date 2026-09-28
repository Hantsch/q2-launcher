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
import { demoSourceKey } from '../modules/replays'

export type DetailFieldId =
  | 'name'
  | 'map'
  | 'mod'
  | 'gamemode'
  | 'sides'
  | 'date'
  | 'pov'
  | 'host'
  | 'description'
  | 'tags'
  | 'favourite'
  | 'rating'
  | 'fileName'
  | 'format'
  | 'duration'
  | 'levelName'
  | 'source'

export interface DemoDetailField {
  id: DetailFieldId
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

/** A stable, serializable representation of a demo row's discovery source — mirrors
 * `DemoRow.tsx`'s `sourceText` (base source + archive entry), but built without i18n since this
 * module is shared/pure: `demoSourceKey` for the base, plus the archive path/entry when the row
 * came from inside a zip. */
function sourceValue(row: DemoRow): string {
  const base = demoSourceKey(row.source)
  return row.archiveEntry ? `${base}#${row.archiveEntry.archivePath}!${row.archiveEntry.entryPath}` : base
}

export function buildDemoDetail(row: DemoRow, sidecar: Partial<SidecarFields>): DemoDetail {
  const fields: DemoDetailField[] = []

  const push = (id: DetailFieldId, value: DemoDetailField['value'] | null | undefined, source: ValueSource | null) => {
    if (!hasValue(value)) return
    fields.push({ id, value: value as DemoDetailField['value'], source })
  }

  push('name', row.effective.name.value, row.effective.name.source)
  push('map', row.effective.map.value, row.effective.map.source)
  push('mod', row.effective.mod.value, row.effective.mod.source)
  push('gamemode', row.effective.gamemode.value, row.effective.gamemode.source)
  push('sides', row.effective.sides.value as SidecarSide[] | null, row.effective.sides.source)
  push('date', row.effective.date.value, row.effective.date.source)
  push('pov', row.effective.pov.value, row.effective.pov.source)
  push('host', row.effective.host.value, row.effective.host.source)

  push('description', sidecar.description, 'sidecar')
  push('tags', sidecar.tags, 'sidecar')
  if (sidecar.favourite === true) push('favourite', true, 'sidecar')
  if (sidecar.rating !== undefined) push('rating', sidecar.rating, 'sidecar')

  push('fileName', row.fileName, null)
  push('format', row.format, null)
  if (Number.isFinite(row.durationMs)) push('duration', row.durationMs as number, null)
  // `DemoRow` has no `levelName` field of its own (it lives only on a parsed `Dm2Header`, which the
  // row never carries) — always omitted, never shown blank.
  push('source', sourceValue(row), null)

  return {
    fields,
    knownPlayers: {
      demo: cleanPlayerList(row.players),
      name: cleanPlayerList(row.nameFacts?.players),
    },
    sidecarIssues: { state: row.sidecar.state },
  }
}
