import { useEffect, useState } from 'react'
import type { NewsFeed } from '@shared/modules/home'
import { getNews, onNewsChanged, refreshNews } from './client'
import { Dashboard } from './dashboard/Dashboard'
import { NewsHero } from './NewsHero'

/**
 * The home module's screen.
 *
 * One scroller for the whole screen: the news hero (story 083, full-bleed and exactly 320px tall)
 * and the dashboard region below it both live *inside* it, so a tall dashboard scrolls the hero
 * away instead of squeezing itself under a pinned header (User feedback: "die ganze page soll
 * scrollable sein wenn overflow ist"). The hero still brings no horizontal padding of its own -
 * all padding lives on the dashboard region, never on both.
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
 * feed has actually loaded.
 *
 * `<Dashboard />` is the only content below the hero. The placeholder `Panel` that used to sit
 * between them (`home.title`/`home.lead`) is gone: once the dashboard carries real tiles, a card
 * announcing that news "will live" here only cost vertical space.
 */
export function HomeView() {
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
    /* tabIndex so a keyboard-only user can reach and scroll this container once the dashboard
       makes it overflow - axe's scrollable-region-focusable rule, same reasoning/precedent as
       ConfigCodeView.tsx's own `tabIndex={0}` scroll panels. */
    <div className="h-full overflow-y-auto scrollbar-gutter-stable" tabIndex={0}>
      <NewsHero
        slides={feed?.slides ?? []}
        retrievedAt={feed?.retrievedAt}
        lastRefreshFailed={feed?.lastRefreshFailed}
        onRefresh={handleRefresh}
      />
      <div className="p-4">
        <Dashboard />
      </div>
    </div>
  )
}
