import { useTranslation } from 'react-i18next'
import { FeatureGate, useFeatureUnlocked } from '../../components/features/FeatureGate'
import { cn } from '../../lib/cn'

export type ServersTab = 'list' | 'watchlist'

/**
 * Story 132 D3: the Servers view's tab strip, mirroring `ConfigView.tsx`'s own tab-strip idiom
 * (plain buttons, not ARIA tabs, `data-testid="config-tab-${id}"`-style naming). The strip only
 * exists once the `watchlist` feature is unlocked - while locked it renders nothing at all, so the
 * pre-story single-screen `ServersView` stays visually identical (FeatureGate's own "nobody asks
 * for something they don't see" rule, applied to the strip itself rather than just the tab).
 */
export function ServersTabStrip({
  activeTab,
  onChange,
}: {
  activeTab: ServersTab
  onChange: (tab: ServersTab) => void
}) {
  const { t } = useTranslation()
  const unlocked = useFeatureUnlocked('watchlist')
  if (!unlocked) return null

  return (
    <div data-testid="servers-tab-strip" className="flex flex-wrap gap-1.5 border-b border-line">
      <button
        type="button"
        data-testid="servers-tab-list"
        onClick={() => onChange('list')}
        className={cn(
          'flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-xs font-medium transition-colors duration-[--dur-fast]',
          activeTab === 'list'
            ? 'bg-flame-900/30 text-flame-200'
            : 'text-ink-dim hover:bg-hover hover:text-ink',
        )}
      >
        {t('servers.tabs.list')}
      </button>
      <FeatureGate feature="watchlist">
        <button
          type="button"
          data-testid="servers-tab-watchlist"
          onClick={() => onChange('watchlist')}
          className={cn(
            'flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-xs font-medium transition-colors duration-[--dur-fast]',
            activeTab === 'watchlist'
              ? 'bg-flame-900/30 text-flame-200'
              : 'text-ink-dim hover:bg-hover hover:text-ink',
          )}
        >
          {t('servers.watchlist.title')}
        </button>
      </FeatureGate>
    </div>
  )
}
