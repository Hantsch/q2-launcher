import type { HTMLAttributes } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/cn'
import { useLauncher } from '../../store/useLauncher'
import { Panel, SectionLabel } from '../ui/primitives'
import { PendingUpdate } from './PendingUpdate'
import { UpdateCheckRow } from './UpdateCheckRow'

/**
 * The first thing Settings shows: the running launcher version, whether it is up to date, a
 * "check now" action, and - when a release is known - that release's notes and download action.
 * `data-testid="settings-version"` is the anchor the titlebar's `UpdatePopover` "What changed"
 * link scrolls to.
 */
export function AppVersionCard({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  const { t } = useTranslation()
  const appInfo = useLauncher((state) => state.appInfo)

  return (
    <Panel
      raised
      className={cn('space-y-4 p-5', className)}
      data-testid="settings-version"
      {...rest}
    >
      <div className="space-y-1">
        <SectionLabel>{t('settings.about.currentVersion')}</SectionLabel>
        <p className="flex items-baseline gap-2 text-ink">
          <span className="font-display text-lg tracking-[0.06em] uppercase">{t('app.name')}</span>
          <span
            className="numeric text-2xl font-medium"
            data-testid="settings-version-number"
            data-selectable
          >
            {appInfo?.appVersion ?? '-'}
          </span>
        </p>
      </div>

      <UpdateCheckRow />

      <PendingUpdate />
    </Panel>
  )
}
