import { useTranslation } from 'react-i18next'
import { Button } from '../../../components/ui/Button'

/**
 * Story 086 D4: the dashboard's own header - a title plus the arrange-mode toggle (User decision:
 * the arrange control sits with the content it edits, not the titlebar utility row). Mounted by
 * `Dashboard.tsx` itself, inside its own width-measured container, so `disabled` can be driven
 * straight from the same `isNarrow` check `DashboardGrid` already computes (Decisions (Sprint):
 * arrange mode is unavailable while the dashboard is single-column - a stack has no cell geometry
 * to arrange).
 *
 * A native `title` attribute carries the disabled hint - no new tooltip primitive needed for one
 * short, occasional explanation.
 */
export function HomeHeader({
  arrangeMode,
  onToggle,
  disabled,
}: {
  arrangeMode: boolean
  onToggle: () => void
  disabled: boolean
}) {
  const { t } = useTranslation()

  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="font-display text-sm tracking-[0.06em] text-ink uppercase">
        {t('home.dashboard.header.title')}
      </h2>
      <Button
        variant={arrangeMode ? 'primary' : 'neutral'}
        size="sm"
        data-testid="dashboard-arrange-toggle"
        disabled={disabled}
        title={disabled ? t('home.dashboard.header.arrangeDisabledHint') : undefined}
        onClick={onToggle}
      >
        {t(arrangeMode ? 'home.dashboard.header.arrangeOn' : 'home.dashboard.header.arrangeOff')}
      </Button>
    </div>
  )
}
