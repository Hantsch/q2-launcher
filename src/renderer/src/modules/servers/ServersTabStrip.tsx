import { useTranslation } from 'react-i18next'
import { useFeatureUnlocked } from '../../components/features/FeatureGate'
import { ExperimentalBadge } from '../../components/ui/ExperimentalBadge'
import { Tabs } from '../../components/ui/Tabs'

export type ServersTab = 'list' | 'watchlist'

/**
 * Story 132 D3: the Servers view's tab strip, mirroring `ConfigView.tsx`'s own tab-strip idiom
 * (the shared `Tabs`, `data-testid="config-tab-${id}"`-style naming). The strip only
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
    <Tabs
      idBase="servers"
      ariaLabel={t('servers.tabs.label')}
      testId="servers-tab-strip"
      className="border-b border-line"
      value={activeTab}
      onChange={(id) => onChange(id as ServersTab)}
      items={[
        { id: 'list', label: t('servers.tabs.list'), testId: 'servers-tab-list' },
        {
          id: 'watchlist',
          label: t('servers.watchlist.title'),
          badge: <ExperimentalBadge />,
          testId: 'servers-tab-watchlist',
        },
      ]}
    />
  )
}
