import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { DiscoveredDemo } from '@shared/modules/replays'
import { Button } from '../../components/ui/Button'
import { indexRead, onScanProgress, scanStart } from './client'

/** The basename of an archive path, split on either separator - a small local helper since
 * `demo.archiveEntry.archivePath` may come from either platform's discovery run. */
function basename(path: string): string {
  return path.split(/[/\\]/).pop() ?? path
}

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
 */
export function ReplaysView() {
  const { t } = useTranslation()
  const [demos, setDemos] = useState<DiscoveredDemo[] | null>(null)
  const [scanning, setScanning] = useState(false)
  const cancelledRef = useRef(false)

  useEffect(() => {
    cancelledRef.current = false
    void indexRead().then((result) => {
      if (cancelledRef.current) return
      setDemos(result.ok ? result.value : [])
    })
    void scanStart()

    const unsubscribe = onScanProgress((progress) => {
      if (cancelledRef.current) return
      setScanning(progress.running)
      if (!progress.running) {
        void indexRead().then((result) => {
          if (cancelledRef.current) return
          setDemos(result.ok ? result.value : [])
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

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-gutter-stable p-5">
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
          <ul data-testid="replays-demo-list" aria-label={t('replays.list.label')}>
            {demos.map((demo) => {
              const baseSource =
                demo.source.kind === 'installation'
                  ? t('replays.list.source', {
                      installation: demo.source.installationName,
                      gameDir: demo.source.gameDir,
                    })
                  : t('replays.source.extraFolder', { path: demo.source.path })
              const sourceText = demo.archiveEntry
                ? t('replays.list.archiveSource', {
                    base: baseSource,
                    archive: basename(demo.archiveEntry.archivePath),
                    entry: demo.archiveEntry.entryPath,
                  })
                : baseSource

              return (
                <li
                  key={demo.id}
                  data-testid="replays-demo-row"
                  data-demo-id={demo.id}
                  {...(demo.archiveEntry ? { 'data-archive-entry': 'true' } : {})}
                  className="flex flex-col gap-0.5 border-b border-line py-2"
                >
                  <span className="text-sm text-ink" data-testid="replays-demo-name">
                    {demo.fileName}
                  </span>
                  <span className="text-xs text-ink-muted" data-testid="replays-demo-source">
                    {sourceText}
                  </span>
                  {demo.map !== null && (
                    <span className="text-xs text-ink-muted" data-testid="replays-demo-map">
                      {demo.map}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
