import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { NewsFeed } from '@shared/modules/home'
import { Panel } from '../../components/ui/primitives'
import { getNews, onNewsChanged, refreshNews } from './client'
import { NewsHero } from './NewsHero'

/**
 * The home module's screen.
 *
 * Two regions, in this order and nothing between them: the news hero (story
 * 083), full-bleed and exactly 320px tall at the very top, and the dashboard
 * region below it. The hero has no horizontal padding of its own and is not
 * inside the scroller - it is `shrink-0` and closed by a bottom rule - so all
 * padding lives on the dashboard region, never on both.
 *
 * This is the feed's data-fetching boundary (D4 fixup): `getNews()` is fetched
 * once on mount, `onNewsChanged` keeps it live for the component's lifetime, and
 * `onRefresh` calls `refreshNews()` - mirrors `DownloadsView.tsx`'s
 * fetch-on-mount shape (a `cancelled` guard around a `client.ts` call, `Outcome`
 * unwrapped with `if (result.ok)`). A failed `Outcome` never throws or renders an
 * error: it just leaves the last-known feed in place, exactly like a failed
 * `news.refresh` does on the main side - `feedState.ts`'s `stale` state (driven by
 * `NewsFeed.lastRefreshFailed`) is the only surfaced sign of it, not a toast.
 * `slides` stays empty (and the hero shows its built-in welcome slide) until a
 * feed has actually loaded. The dashboard is still story 086's placeholder
 * block.
 */
export function HomeView() {
  const { t } = useTranslation()
  const [feed, setFeed] = useState<NewsFeed | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    void getNews().then((result) => {
      if (!cancelled && result.ok) setFeed(result.value)
    })
    const unsubscribe = onNewsChanged((next) => {
      if (!cancelled) setFeed(next)
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  function handleRefresh() {
    void refreshNews().then((result) => {
      if (result.ok) setFeed(result.value)
    })
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <NewsHero
        slides={feed?.slides ?? []}
        retrievedAt={feed?.retrievedAt}
        lastRefreshFailed={feed?.lastRefreshFailed}
        onRefresh={handleRefresh}
      />
      <div className="flex-1 overflow-y-auto p-4 scrollbar-gutter-stable">
        <div className="mx-auto max-w-2xl space-y-4 py-8">
          <Panel className="space-y-2 p-4">
            <h1 className="font-display text-xl tracking-[0.06em] text-ink uppercase">
              {t('home.title')}
            </h1>
            <p className="text-sm leading-relaxed text-ink-dim">{t('home.lead')}</p>
          </Panel>
        </div>
      </div>
    </div>
  )
}
