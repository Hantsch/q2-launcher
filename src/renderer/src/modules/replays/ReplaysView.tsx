import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { DiscoveredDemo } from '@shared/modules/replays'
import { listDemos } from './client'

/**
 * Story 141 D4: a minimal Demos list view - just enough to make AC "every discovered demo across
 * every installation and mod is listed" provable on a real surface. Mirrors `ServersView`'s header
 * markup (the `h1`/status-line toolbar shape); everything else there (scan controls, sort, filter,
 * detail pane, tabs) is out of scope for this deliverable.
 *
 * Local `useState`/`useEffect` only, no Zustand store - a one-shot `listDemos()` on mount, same
 * "load once, no polling" discipline the rest of this module already follows.
 */
export function ReplaysView() {
  const { t } = useTranslation()
  const [demos, setDemos] = useState<DiscoveredDemo[] | null>(null)

  useEffect(() => {
    let cancelled = false
    void listDemos().then((result) => {
      if (cancelled) return
      setDemos(result.ok ? result.value : [])
    })
    return () => {
      cancelled = true
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
            {demos.map((demo) => (
              <li
                key={demo.id}
                data-testid="replays-demo-row"
                data-demo-id={demo.id}
                className="flex flex-col gap-0.5 border-b border-line py-2"
              >
                <span className="text-sm text-ink" data-testid="replays-demo-name">
                  {demo.fileName}
                </span>
                <span className="text-xs text-ink-muted" data-testid="replays-demo-source">
                  {t('replays.list.source', {
                    installation: demo.source.installationName,
                    gameDir: demo.source.gameDir,
                  })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
