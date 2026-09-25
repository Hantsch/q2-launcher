import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  SCAN_BLOCKED_GAME_RUNNING_REASON_KEY,
  type ScanBlockedReason,
  type ScanSnapshot,
  type ServerListEntry,
  type ServersScanState,
} from '@shared/modules/servers'
import { Button } from '../../components/ui/Button'
import { Panel } from '../../components/ui/primitives'
import { onScanChanged, readScan, setScanViewActive, startScan } from './client'

/** Story 116 D5: the visible reason for each `ScanBlockedReason` - a lookup table of one entry
 * today, future-proof if a later story adds another blocked reason (mirrors `write-guard.ts`'s
 * `WAITING_REASON_GAME_RUNNING` -> `jobs.waiting.gameRunning` single-entry convention). */
const BLOCKED_REASON_KEYS: Record<ScanBlockedReason, string> = {
  'game-running': SCAN_BLOCKED_GAME_RUNNING_REASON_KEY,
}

/** A scan that has never run and nothing known yet - `scan.read`'s own shape for a fresh
 * `ServersState` (mirrors `main/modules/servers/scan-runner.ts`'s initial state), used here only
 * as the pre-`readScan()` placeholder so the status readout always has something to render. */
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
}

/**
 * Story 115 D5: a deliberately minimal stand-in for the Servers view - just enough surface for
 * AC3 ("manual scan is available regardless of the auto settings"). The real server list, its
 * sorting/filtering and favourites-in-list are [[118]]/[[121]]'s job, not this one (Decisions) -
 * this view exists solely to give the manual refresh control somewhere real to live.
 *
 * Mounts -> `setScanViewActive(true)` (D3's cadence signal that the view is open) and a one-shot
 * `readScan()` for the current snapshot; unmounts -> `setScanViewActive(false)`. Everything after
 * the initial read arrives through `onScanChanged` - nothing here polls (mirrors `client.ts`'s own
 * "AC5: nothing in the renderer polls for progress" discipline). `onScanServer`'s pushes carry a
 * per-reply-attempt row, not a merged `ServerListEntry`, so they cannot update `entries`
 * incrementally - instead, a `scan.changed` push whose `finishedAt` just advanced (a completed
 * round - the same moment story 116 D4's stale-flip runs) triggers exactly one `readScan()` to
 * refresh the list; this is still push-driven, not polling.
 *
 * Story 116 D5: the refresh button is also disabled - and its testid renamed from
 * `servers-manual-refresh` to `servers-refresh` - while `scanState.blockedReason` is non-null (the
 * game is running), with the reason rendered as real text above it (`servers-scan-blocked`,
 * mirrors `JobRow.tsx`'s waiting-reason line). Main stays authoritative regardless (D-H): this
 * disabled state is convenience only, `scan.start` refuses the call either way. Otherwise the
 * button is always enabled, even mid-scan (`scan.start` refuses a concurrent start harmlessly -
 * D-L - so re-clicking is safe) and never gated by `autoScanOnOpen`/`autoRefreshEnabled`.
 *
 * A minimal row list (address, player count if known, and a `servers.row.stale` label for
 * `status: 'stale'` rows) renders below the status line - deliberately bare per D-K, just enough
 * to make AC3's stale indication provable on a real surface; the "real" server-list design is a
 * later story's job.
 */
export function ServersView() {
  const { t } = useTranslation()
  const [scanState, setScanState] = useState<ServersScanState>(IDLE_SCAN_STATE)
  const [entries, setEntries] = useState<ServerListEntry[]>([])
  // Tracks the last-seen `finishedAt` so a `scan.changed` push is only treated as "a round just
  // finished" (and triggers the one extra `readScan()` below) once, not on every progress-only
  // push during stage1/stage2 - a ref because it must not itself trigger a re-render.
  const lastFinishedAtRef = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void setScanViewActive(true)

    void readScan().then((result) => {
      if (cancelled || !result.ok) return
      const snapshot: ScanSnapshot = result.value
      setScanState(snapshot.state)
      setEntries(snapshot.entries)
      lastFinishedAtRef.current = snapshot.state.finishedAt
    })

    const unsubscribeChanged = onScanChanged((state) => {
      if (cancelled) return
      setScanState(state)

      // AC3/D4: a completed round is the moment stale flips - react to it here with a single
      // reactive re-read (still push-driven, not polling: one extra read per finished round, same
      // discipline `client.ts`'s own AC5 doc comment commits to), not on every progress push.
      if (!state.running && state.finishedAt !== lastFinishedAtRef.current) {
        lastFinishedAtRef.current = state.finishedAt
        void readScan().then((result) => {
          if (!cancelled && result.ok) setEntries(result.value.entries)
        })
      }
    })
    return () => {
      cancelled = true
      unsubscribeChanged()
      void setScanViewActive(false)
    }
  }, [])

  const handleRefresh = (): void => {
    void startScan()
  }

  const stateLabel = t(
    scanState.running ? 'module.servers.view.status.scanning' : 'module.servers.view.status.idle',
  )
  const isBlocked = scanState.blockedReason !== null

  return (
    <div className="h-full overflow-y-auto scrollbar-gutter-stable">
      <div className="mx-auto max-w-3xl space-y-4 p-6">
        <header className="space-y-1">
          <h1 className="font-display text-2xl tracking-[0.06em] text-ink uppercase">
            {t('module.servers.title')}
          </h1>
          <p className="text-xs text-ink-muted">{t('module.servers.description')}</p>
        </header>

        <Panel className="space-y-3 p-4">
          {isBlocked && scanState.blockedReason && (
            <p className="text-xs text-warning" data-testid="servers-scan-blocked">
              {t(BLOCKED_REASON_KEYS[scanState.blockedReason])}
            </p>
          )}

          <div className="flex items-center gap-3">
            <Button
              variant="neutral"
              onClick={handleRefresh}
              disabled={isBlocked}
              data-testid="servers-refresh"
            >
              {t('module.servers.view.refresh')}
            </Button>
            <span
              className="text-xs text-ink-muted"
              data-testid="servers-scan-status"
              // `data-running`/`data-finished-at` are test-observability attributes, not
              // user-facing text (the visible label below is the i18n-driven one) - a flow that
              // clicks the refresh button has nothing else to poll for "a scan visibly ran" that
              // isn't racy against how fast a scan against a single dead loopback target finishes.
              data-running={scanState.running}
              data-finished-at={scanState.finishedAt ?? ''}
            >
              {t('module.servers.view.status.line', {
                state: stateLabel,
                count: entries.length,
              })}
            </span>
          </div>
        </Panel>

        <Panel className="space-y-2 p-4">
          {entries.map((entry) => (
            <div
              key={entry.address}
              className="flex items-center gap-3 text-xs text-ink-muted"
              data-testid={`servers-row-${entry.address}`}
            >
              <span className="text-ink">{entry.address}</span>
              {(() => {
                // Story 116 D5 fix: `players` starts as a numeric `info` count and is replaced by
                // a full `ServerPlayer[]` roster once stage 2's `status` reply lands (see
                // `scan-service.ts`'s `mergeSuccessfulReply`) - a stale entry can carry either
                // shape, so both render a count.
                const count = Array.isArray(entry.players)
                  ? entry.players.length
                  : typeof entry.players === 'number'
                    ? entry.players
                    : undefined
                return count !== undefined && <span>{count}</span>
              })()}
              {entry.status === 'stale' && (
                <span
                  className="text-warning"
                  data-testid={`servers-row-stale-${entry.address}`}
                >
                  {t('servers.row.stale')}
                </span>
              )}
            </div>
          ))}
        </Panel>
      </div>
    </div>
  )
}
