import type { ReplaysScanProgress } from '@shared/modules/replays'

/**
 * Story 151 D3: pure derivation of the demo list's own display state - mirrors
 * `servers/list-state.ts`'s `deriveListState`/`describeScanProgress` shape so
 * `ReplaysListStatus.tsx` stays a thin renderer and this stays unit-testable without React/i18n.
 *
 * `'loading'` wins over everything else while a scan is running - even if rows already exist from
 * a previous round (the panel above the rows communicates progress, the rows themselves keep
 * showing whatever they last had). `'empty'` only applies once a scan is not running and there are
 * no rows; `'populated'` otherwise.
 */
export type ReplaysListState = 'loading' | 'empty' | 'populated'

export function deriveReplaysListState({
  scanning,
  rowCount,
}: {
  scanning: boolean
  rowCount: number
}): ReplaysListState {
  if (scanning) return 'loading'
  if (rowCount > 0) return 'populated'
  return 'empty'
}

/** One line of the loading readout, as an i18n key plus its interpolation params - translation
 * itself happens in `ReplaysListStatus.tsx`. */
export interface ReplaysScanProgressLine {
  key: string
  params?: Record<string, number>
}

/**
 * Describes a running scan's progress: a single "reading demos" line with no numbers while no
 * source has reported a total yet, otherwise the scanned/total counts summed across every source.
 */
export function describeReplaysScanProgress(progress: ReplaysScanProgress): ReplaysScanProgressLine {
  const hasTotal = progress.sources.some((source) => source.total > 0)
  if (!hasTotal) return { key: 'replays.list.loading' }

  const scanned = progress.sources.reduce((sum, source) => sum + source.scanned, 0)
  const total = progress.sources.reduce((sum, source) => sum + source.total, 0)
  return { key: 'replays.list.loadingProgress', params: { scanned, total } }
}
