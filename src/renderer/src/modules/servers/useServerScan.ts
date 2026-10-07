import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  ScanSnapshot,
  ServerListRow,
  ServersBrowseMode,
  ServersScanState,
} from '@shared/modules/servers'
import { useModuleQuery } from '../../lib/useModuleQuery'
import {
  listMasterSources,
  onScanChanged,
  onScanServer,
  readScan,
  setMode,
  setScanViewActive,
  startScan,
} from './client'

/** `scan.read`'s shape for a scan that never ran - the placeholder until the first read lands. */
const IDLE_SCAN_STATE: ServersScanState = {
  running: false,
  phase: 'idle',
  stage1Done: 0,
  stage1Total: 0,
  stage2Done: 0,
  stage2Total: 0,
  sourceFailures: [],
  startedAt: null,
  finishedAt: null,
  blockedReason: null,
  scope: null,
  mode: 'online',
}

const NO_LAN_ROUND: ScanSnapshot['lan'] = { lastFinishedAt: null, failureKey: null }
const NO_ROWS: ServerListRow[] = []

export interface ServerScan {
  scanState: ServersScanState
  /** The displayed mode's rows only - a snapshot of the other mode is never shown. */
  entries: ServerListRow[]
  lan: ScanSnapshot['lan']
  mode: ServersBrowseMode
  /** Source id -> its address, for naming a `sourceFailures` entry. */
  sourceLabels: Record<string, string>
  changeMode: (next: ServersBrowseMode) => void
  /** A full scan; `selected` still gets a stage-2 query even if stage 1 reports it empty. */
  refresh: (selected?: string) => void
  /** Re-scans exactly the rows the filter shows; `selected` is kept as in `refresh`. */
  refreshShown: (addresses: string[], selected?: string) => void
  refreshFavourites: () => void
  refreshServer: (address: string) => void
  /** Re-reads the list, e.g. after a favourite changed. */
  rereadEntries: () => void
}

/**
 * The Servers view's scan: opening it announces the view to main's cadence, every later change
 * arrives by push (nothing polls), and a fresh mount always browses Online - the mode is local and
 * never persisted.
 */
export function useServerScan(): ServerScan {
  const [mode, setBrowseMode] = useState<ServersBrowseMode>('online')
  const [scanState, setScanState] = useState<ServersScanState>(IDLE_SCAN_STATE)
  // Read synchronously by the push handlers: a `scan.server` push can land before React renders
  // the `scan.changed` that preceded it.
  const modeRef = useRef<ServersBrowseMode>('online')
  /** The mode of the running/last scan (`scan.server` pushes carry no mode of their own). */
  const scanModeRef = useRef<ServersBrowseMode>('online')
  const lastFinishedAtRef = useRef<string | null>(null)
  /** Every snapshot read waits for main to have taken the displayed mode. */
  const modeSetRef = useRef<Promise<unknown>>(Promise.resolve())

  // Pushes and reads arrive in main's emission order, so whichever lands last is main's truth.
  const noteState = useCallback((state: ServersScanState): void => {
    setScanState(state)
    scanModeRef.current = state.mode
    lastFinishedAtRef.current = state.finishedAt
  }, [])

  // Declared before the snapshot query so `modeSetRef` holds the reset before the first read runs.
  // Main remembers the last mode: reset it BEFORE announcing the view open, or the cadence's
  // view-open trigger could broadcast a LAN scan while the UI shows Online.
  useEffect(() => {
    let open = true
    modeSetRef.current = setMode('online').then(() => {
      if (open) void setScanViewActive(true)
    })
    return () => {
      open = false
      void setScanViewActive(false)
    }
  }, [])

  const snapshot = useModuleQuery<ScanSnapshot>(
    () =>
      modeSetRef.current
        .then(() => readScan())
        .then((result) => {
          if (result.ok) noteState(result.value.state)
          return result
        }),
    { deps: [mode] },
  )
  const { setData: applySnapshot, reload: rereadEntries } = snapshot

  useEffect(() => {
    let disposed = false
    // At most one read in flight plus one trailing read, so a burst of pushes never piles up reads.
    let inFlight = false
    let pending = false
    const readLatest = (): void => {
      if (disposed) return
      if (inFlight) {
        pending = true
        return
      }
      inFlight = true
      void readScan().then((result) => {
        inFlight = false
        if (!disposed && result.ok) {
          noteState(result.value.state)
          applySnapshot(result.value)
        }
        if (pending) {
          pending = false
          readLatest()
        }
      })
    }

    const unsubscribeChanged = onScanChanged((state) => {
      if (disposed) return
      const roundFinished = !state.running && state.finishedAt !== lastFinishedAtRef.current
      noteState(state)
      // A completed round is when rows flip stale - one re-read per round, not per progress push.
      if (roundFinished) readLatest()
    })
    const unsubscribeServer = onScanServer(() => {
      if (modeRef.current === scanModeRef.current) readLatest()
    })

    return () => {
      disposed = true
      unsubscribeChanged()
      unsubscribeServer()
    }
  }, [noteState, applySnapshot])

  const sources = useModuleQuery(listMasterSources)
  const sourceLabels = useMemo(
    () => Object.fromEntries((sources.data ?? []).map((source) => [source.id, source.address])),
    [sources.data],
  )
  const sourceLabelsRef = useRef(sourceLabels)
  sourceLabelsRef.current = sourceLabels
  const reloadSources = sources.reload
  // Re-list when a failure names a source added after the list was read. Keyed on the failures
  // alone: a source that no longer exists must not re-list in a loop.
  useEffect(() => {
    if (
      scanState.sourceFailures.some((failure) => !(failure.sourceId in sourceLabelsRef.current))
    ) {
      reloadSources()
    }
  }, [scanState.sourceFailures, reloadSources])

  const changeMode = useCallback((next: ServersBrowseMode): void => {
    if (next === modeRef.current) return
    modeRef.current = next
    modeSetRef.current = setMode(next)
    setBrowseMode(next)
  }, [])

  const data = snapshot.data
  return {
    scanState,
    entries: data && data.mode === mode ? data.entries : NO_ROWS,
    lan: data?.lan ?? NO_LAN_ROUND,
    mode,
    sourceLabels,
    changeMode,
    refresh: (selected) => void startScan({ kind: 'all' }, selected),
    refreshShown: (addresses, selected) =>
      void startScan({ kind: 'addresses', addresses }, selected),
    refreshFavourites: () => void startScan({ kind: 'favourites' }),
    refreshServer: (address) => void startScan({ kind: 'server', address }),
    rereadEntries,
  }
}
