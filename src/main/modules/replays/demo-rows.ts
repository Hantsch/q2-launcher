/**
 * Story 150: composes `index.read`'s real rows - a discovered demo (`DiscoveredDemo`) plus
 * its sidecar and its resolved effective values (`resolveEffectiveValues`,
 * `src/shared/demos/effective-values.ts`) - so the renderer never runs the resolver itself.
 *
 * `buildDemoRow` is pure and never throws: a `null` sidecar (archive entry, unknown id, or a
 * failed store read) becomes `{ state: 'none', values: {} }`; an `error` sidecar still feeds
 * whatever fields validated into resolution, it just reports `state: 'error'` on the row.
 * `composeDemoRows` is the only async/concurrency-bearing part, bounding how many sidecar reads run
 * at once so a large index never opens thousands of file handles at the same time.
 */

import { resolveEffectiveValues } from '@shared/demos/effective-values'
import type { DemoRow, DiscoveredDemo, SidecarState } from '@shared/modules/replays'
import { headerFromRow } from '@shared/replays/row-header'
import type { SidecarFields } from '@shared/replays/sidecar'

/** What a sidecar read answers with, once its `Outcome` (or archive-entry/unknown-id shortcut) has
 * been unwrapped: `null` stands for "no sidecar to read from" (archive entry, unknown id, or a
 * failed read) exactly like `sidecar-store.ts`'s own `{ state: 'none' }` answer for an archive
 * entry - the row ends up the same either way. */
export type DemoSidecarInput = { state: SidecarState; values: Partial<SidecarFields> } | null

/** Builds one `DemoRow` from a discovered demo and its (already-read) sidecar. Pure, synchronous,
 * never throws. */
export function buildDemoRow(demo: DiscoveredDemo, sidecar: DemoSidecarInput): DemoRow {
  const effective = resolveEffectiveValues({
    fileName: demo.fileName,
    sidecar: sidecar?.values ?? null,
    header: headerFromRow(demo),
    nameFacts: demo.nameFacts,
    fileTime: demo.fileTime,
  })

  return {
    ...demo,
    sidecar: {
      state: sidecar?.state.state ?? 'none',
      values: sidecar?.values ?? {},
    },
    effective,
  }
}

/** Composes every demo's row, reading its sidecar through `readSidecar` with at most `concurrency`
 * reads in flight at once - a fixed-size worker pool rather than chunking, so a slow read never
 * stalls reads for demos further down the list. */
export async function composeDemoRows(
  demos: DiscoveredDemo[],
  readSidecar: (id: string) => Promise<DemoSidecarInput>,
  concurrency = 16,
): Promise<DemoRow[]> {
  const rows: DemoRow[] = new Array(demos.length)
  let next = 0

  async function worker(): Promise<void> {
    for (;;) {
      const i = next++
      if (i >= demos.length) return
      const demo = demos[i]
      const sidecar = await readSidecar(demo.id)
      rows[i] = buildDemoRow(demo, sidecar)
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, demos.length))
  await Promise.all(Array.from({ length: workerCount }, () => worker()))

  return rows
}
