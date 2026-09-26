import { useTranslation } from 'react-i18next'
import { parseReleaseNotes } from '@shared/release-notes'
import { useLauncher } from '../../store/useLauncher'
import { UpdateAction } from '../shell/UpdateAction'
import { Badge } from '../ui/primitives'
import { ReleaseNotes } from './ReleaseNotes'

/**
 * Story 099 D4: when 097/098's update state names a known release (`update.update !== null`), its
 * notes render marked "not yet installed" and paired with the same phase-based `UpdateAction` the
 * titlebar's `UpdatePopover` uses - so "download this update" is one component, driven identically
 * from either surface. Lives in `AppVersionCard.tsx`, right under the running version, so an
 * available update is visible the moment Settings opens. Renders nothing when no release is known.
 */
export function PendingUpdate() {
  const { t } = useTranslation()
  const update = useLauncher((state) => state.update)

  if (!update.update) return null

  const notes = parseReleaseNotes(update.update.notes)

  return (
    <div
      className="space-y-3 rounded-sm border border-flame-700 bg-flame-900/20 p-3"
      data-testid="about-update-available"
    >
      <div className="flex items-center gap-2">
        <p className="text-sm font-medium text-ink" data-testid="about-update-version">
          {t('appUpdate.version', { version: update.update.version })}
        </p>
        <Badge tone="flame">{t('settings.about.notInstalled')}</Badge>
      </div>
      <div className="max-h-60 overflow-y-auto" data-testid="about-update-notes">
        {notes.length > 0 ? (
          <ReleaseNotes sections={notes} />
        ) : (
          <p className="text-xs text-ink-muted">{t('settings.about.notesEmpty')}</p>
        )}
      </div>
      <div className="sm:max-w-xs" data-testid="about-update-action">
        <UpdateAction />
      </div>
    </div>
  )
}
