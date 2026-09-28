import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import type { DemoRow } from '@shared/modules/replays'
import { Button, IconButton } from '../../components/ui/Button'
import { VirtualDemoList } from './components/VirtualDemoList'
import { indexRead, onScanProgress, scanStart } from './client'

/**
 * Story 141 D4: a minimal Demos list view - just enough to make AC "every discovered demo across
 * every installation and mod is listed" provable on a real surface. Mirrors `ServersView`'s header
 * markup (the `h1`/status-line toolbar shape); everything else there (scan controls, sort, filter,
 * detail pane, tabs) is out of scope for this deliverable.
 *
 * Story 144 D4: the index is read once on mount (cache-first - whatever `index.read` already has,
 * rendered at once, even if it's a stale/previous-run snapshot) and a background scan is kicked off
 * right behind it. `onScanProgress` is subscribed for the component's lifetime; only once a push
 * reports `running: false` is the index re-read and the whole list swapped in one go - never a
 * partial/incremental patch, matching the story's "single swap on completion" design. The refresh
 * button re-triggers the same `scanStart()` and is disabled while the latest known progress says a
 * scan is running.
 *
 * Story 158/159 D4: the list itself is now `VirtualDemoList` (a virtualised, selectable body built
 * on the D3 row/header/grid pieces), and selecting a row opens a side detail panel - shell only,
 * a later story fills in its content. A row that vanishes on a re-read (its id no longer in the new
 * list) clears the selection rather than leaving it pointed at a row that no longer renders.
 */
export function ReplaysView() {
  const { t } = useTranslation()
  const [demos, setDemos] = useState<DemoRow[] | null>(null)
  const [scanning, setScanning] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const cancelledRef = useRef(false)

  useEffect(() => {
    cancelledRef.current = false

    function applyDemos(next: DemoRow[]): void {
      setDemos(next)
      setSelectedId((current) => {
        if (current === null) return current
        return next.some((demo) => demo.id === current) ? current : null
      })
    }

    void indexRead().then((result) => {
      if (cancelledRef.current) return
      applyDemos(result.ok ? result.value : [])
    })
    void scanStart()

    const unsubscribe = onScanProgress((progress) => {
      if (cancelledRef.current) return
      setScanning(progress.running)
      if (!progress.running) {
        void indexRead().then((result) => {
          if (cancelledRef.current) return
          applyDemos(result.ok ? result.value : [])
        })
      }
    })

    return () => {
      cancelledRef.current = true
      unsubscribe()
    }
  }, [])

  const loading = demos === null
  const isEmpty = !loading && demos.length === 0
  const selected = demos?.find((demo) => demo.id === selectedId) ?? null

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 border-b border-line px-5 py-4">
        <div className="min-w-0 space-y-1">
          <h1 className="font-display text-2xl tracking-[0.06em] text-ink uppercase">
            {t('replays.view.title')}
          </h1>
        </div>
        <Button
          variant="neutral"
          onClick={() => void scanStart()}
          disabled={scanning}
          data-testid="replays-refresh"
        >
          {scanning ? t('replays.list.refreshing') : t('replays.list.refresh')}
        </Button>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col p-5">
          {loading && (
            <p className="text-xs text-ink-muted" data-testid="replays-list-loading">
              {t('replays.list.loading')}
            </p>
          )}
          {isEmpty && (
            <p className="text-xs text-ink-muted" data-testid="replays-list-empty">
              {t('replays.list.empty')}
            </p>
          )}
          {!loading && !isEmpty && (
            <VirtualDemoList
              rows={demos}
              selectedId={selectedId}
              onSelect={(id) => setSelectedId(id)}
            />
          )}
        </div>

        {selected && (
          <aside
            data-testid="replays-demo-detail"
            className="flex w-80 shrink-0 flex-col border-l border-line p-5"
          >
            <div className="flex items-start justify-between gap-3">
              <h2
                className="min-w-0 truncate text-sm font-medium text-ink"
                data-testid="replays-demo-detail-title"
              >
                {selected.effective.name.value ?? selected.fileName}
              </h2>
              <IconButton
                label={t('replays.detail.close')}
                onClick={() => setSelectedId(null)}
                data-testid="replays-demo-detail-close"
              >
                <X className="size-4" aria-hidden="true" />
              </IconButton>
            </div>
          </aside>
        )}
      </div>
    </div>
  )
}
