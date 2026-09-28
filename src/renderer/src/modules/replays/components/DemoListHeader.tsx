import { useTranslation } from 'react-i18next'
import { cn } from '../../../lib/cn'
import { DEMO_LIST_GRID } from '../list-grid'

/**
 * The demos list's sticky column header - static labels on the same `DEMO_LIST_GRID` template as
 * every `DemoRow`, so each label sits over its column. Mirrors `../../servers/ServerListHeader.tsx`
 * except every column here is static (no sort wiring yet - that is a later deliverable).
 */
export function DemoListHeader() {
  const { t } = useTranslation()

  return (
    <div
      className={cn(
        DEMO_LIST_GRID,
        'sticky top-0 z-10 h-9 border-b border-l-transparent border-b-line bg-panel',
      )}
    >
      <span className="stencil flex h-9 items-center justify-start">{t('replays.column.name')}</span>
      <span className="stencil flex h-9 items-center justify-end text-right">{t('replays.column.map')}</span>
      <span className="stencil flex h-9 items-center justify-end text-right">{t('replays.column.mod')}</span>
      <span className="stencil flex h-9 items-center justify-end text-right">{t('replays.column.sides')}</span>
      <span className="stencil flex h-9 items-center justify-end text-right">{t('replays.column.date')}</span>
      <span className="stencil flex h-9 items-center justify-end text-right">
        {t('replays.column.duration')}
      </span>
      <span className="stencil flex h-9 items-center justify-end text-right">
        {t('replays.column.favourite')}
      </span>
    </div>
  )
}
