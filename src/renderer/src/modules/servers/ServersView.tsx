import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ScanSnapshot, ServersScanState } from '@shared/modules/servers'
import { Button } from '../../components/ui/Button'
import { Panel } from '../../components/ui/primitives'
import { onScanChanged, onScanServer, readScan, setScanViewActive, startScan } from './client'

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
}

/**
 * Story 115 D5: a deliberately minimal stand-in for the Servers view - just enough surface for
 * AC3 ("manual scan is available regardless of the auto settings"). The real server list, its
 * sorting/filtering and favourites-in-list are [[118]]/[[121]]'s job, not this one (Decisions) -
 * this view exists solely to give the manual refresh control somewhere real to live.
 *
 * Mounts -> `setScanViewActive(true)` (D3's cadence signal that the view is open) and a one-shot
 * `readScan()` for the current snapshot; unmounts -> `setScanViewActive(false)`. Everything after
 * the initial read arrives through `onScanChanged`/`onScanServer` - nothing here polls (mirrors
 * `client.ts`'s own "AC5: nothing in the renderer polls for progress" discipline).
 *
 * The refresh button is always enabled, even mid-scan (`scan.start` refuses a concurrent start
 * harmlessly - D-L in `@shared/modules/servers` - so re-clicking is safe) and never gated by
 * `autoScanOnOpen`/`autoRefreshEnabled`, which is the entire point of this deliverable.
 */
export function ServersView() {
  const { t } = useTranslation()
  const [scanState, setScanState] = useState<ServersScanState>(IDLE_SCAN_STATE)
  const [knownAddresses, setKnownAddresses] = useState<ReadonlySet<string>>(new Set())

  useEffect(() => {
    let cancelled = false
    void setScanViewActive(true)

    void readScan().then((result) => {
      if (cancelled || !result.ok) return
      const snapshot: ScanSnapshot = result.value
      setScanState(snapshot.state)
      setKnownAddresses(new Set(snapshot.entries.map((entry) => entry.address)))
    })

    const unsubscribeChanged = onScanChanged((state) => {
      if (!cancelled) setScanState(state)
    })
    const unsubscribeServer = onScanServer((row) => {
      if (cancelled) return
      setKnownAddresses((previous) => {
        if (previous.has(row.target.address)) return previous
        return new Set(previous).add(row.target.address)
      })
    })

    return () => {
      cancelled = true
      unsubscribeChanged()
      unsubscribeServer()
      void setScanViewActive(false)
    }
  }, [])

  const handleRefresh = (): void => {
    void startScan()
  }

  const stateLabel = t(
    scanState.running ? 'module.servers.view.status.scanning' : 'module.servers.view.status.idle',
  )

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
          <div className="flex items-center gap-3">
            <Button
              variant="neutral"
              onClick={handleRefresh}
              data-testid="servers-manual-refresh"
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
                count: knownAddresses.size,
              })}
            </span>
          </div>
        </Panel>
      </div>
    </div>
  )
}
