import type { ServersBrowseMode, ServersScanState } from '@shared/modules/servers'

/**
 * Story 121: pure derivation of the servers list's own display state from the scan's live
 * state plus the current (unfiltered) row count - no React, no i18n, just the branching so
 * `list-state.test.ts` can cover it directly and `ServersListStatus.tsx` stays a thin renderer.
 *
 * `'loading'` wins over everything else while a scan is running (even if rows already exist from
 * a previous round - the panel above the rows communicates progress, the rows themselves keep
 * showing whatever they last had). `'empty'` only applies once a scan has actually finished with
 * zero rows (`finishedAt !== null`) - a scan that has never run yet is `'idle'`, not `'empty'`,
 * so a fresh install doesn't say "no server found" before it has even looked.
 */
export type ServersListState = 'loading' | 'empty' | 'lanEmpty' | 'idle' | 'populated'

/**
 * Story 196: `mode` is the mode the list *displays*; `state.mode` is the mode of the running/last
 * scan. A scan of the other mode never drives this list's loading/empty states. In LAN mode the
 * "finished with no rows" signal is `lanLastFinishedAt` (the last LAN round), not `finishedAt`.
 */
export function deriveListState(
  state: ServersScanState,
  rowCount: number,
  mode: ServersBrowseMode = 'online',
  lanLastFinishedAt: string | null = null,
): ServersListState {
  if (mode === 'lan') {
    if (state.running && state.mode === 'lan') return 'loading'
    if (rowCount > 0) return 'populated'
    return lanLastFinishedAt !== null ? 'lanEmpty' : 'idle'
  }
  if (state.running && state.mode === 'online') return 'loading'
  if (rowCount > 0) return 'populated'
  // The scan state is shared across modes: a finished LAN round is not an online result.
  if (state.mode === 'online' && state.finishedAt !== null) return 'empty'
  return 'idle'
}

/** One line of the loading readout, as an i18n key plus its interpolation params (translation
 * itself happens in `ServersListStatus.tsx` - this stays pure/no-i18n per this file's own
 * discipline). */
export interface ScanProgressLine {
  key: string
  params?: Record<string, number>
}

/**
 * Describes a running scan's progress as one or two lines: a single "asking the lists" line while
 * stage 1 doesn't even know its target count yet, otherwise the stage1 found/pending counts, plus
 * a stage2 line appended once the scan has moved into stage 2.
 */
export function describeScanProgress(state: ServersScanState): ScanProgressLine[] {
  const lines: ScanProgressLine[] = []

  if (state.running && state.stage1Total === 0) {
    lines.push({ key: 'servers.list.loading.sources' })
  } else {
    lines.push({
      key: 'servers.list.loading.stage1',
      params: { found: state.stage1Total, pending: state.stage1Total - state.stage1Done },
    })
  }

  if (state.phase === 'stage2') {
    lines.push({
      key: 'servers.list.loading.stage2',
      params: { done: state.stage2Done, total: state.stage2Total },
    })
  }

  return lines
}
