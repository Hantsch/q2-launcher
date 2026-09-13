import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ExternalLink, FolderOpen } from 'lucide-react'
import { APP_CHANGELOG_URL, APP_REPO_URL } from '@shared/constants'
import { parseReleaseNotes } from '@shared/release-notes'
import type { ReleaseNotes as ReleaseNotesResponse } from '@shared/types'
import { invoke } from '../../lib/bridge'
import { useLauncher } from '../../store/useLauncher'
import { UpdateAction } from '../shell/UpdateAction'
import { Button } from '../ui/Button'
import { Badge, Divider, EmptyState, KeyValue, SectionLabel } from '../ui/primitives'
import { ReleaseNotes } from './ReleaseNotes'
import { UpdateCheckRow } from './UpdateCheckRow'

/**
 * Story 099 D3: the Settings > About section's inner content - extracted out of
 * `SettingsView.tsx`, which keeps only the surrounding `Panel` + `SectionLabel` chrome, the same
 * split `DownloadsSettingsSection` uses for its contributed section.
 *
 * Fetches the running version's release notes over `app:getReleaseNotes` on mount (D2's channel)
 * and renders them under the version row; a `null` response (AC5 - no changelog section for this
 * build) renders an `EmptyState` sentence instead. Two external links close the section: the
 * project repository (existing) and the full changelog (new), both routed through the same
 * `app:openExternal` channel as every other external link in this view - never `window.open`,
 * never in-app navigation.
 *
 * Story 099 D4: when 097/098's update state names a known release (`update.update !== null`), its
 * notes render *above* this-version's own block, marked "not yet installed" and paired with the
 * same phase-based `UpdateAction` the titlebar's `UpdatePopover` uses - so "download this update"
 * is one component, driven identically from either surface.
 *
 * Story 099 D5: `UpdateCheckRow` (below this-version's own release notes, above the userData/logs
 * rows) shows when the launcher last checked for updates and lets the user check now - the first
 * renderer caller of 097's `update:check` channel.
 */
export function AboutPanel() {
  const { t } = useTranslation()
  const appInfo = useLauncher((state) => state.appInfo)
  const update = useLauncher((state) => state.update)
  const [releaseNotes, setReleaseNotes] = useState<ReleaseNotesResponse>(null)

  useEffect(() => {
    let cancelled = false
    void invoke('app:getReleaseNotes').then((result) => {
      if (!cancelled) setReleaseNotes(result ?? null)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const pendingNotes = update.update ? parseReleaseNotes(update.update.notes) : []

  return (
    <>
      {update.update && (
        <>
          <div className="space-y-2" data-testid="about-update-available">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium text-ink" data-testid="about-update-version">
                {t('appUpdate.version', { version: update.update.version })}
              </p>
              <Badge tone="flame">{t('settings.about.notInstalled')}</Badge>
            </div>
            <div data-testid="about-update-notes">
              {pendingNotes.length > 0 ? (
                <ReleaseNotes sections={pendingNotes} />
              ) : (
                <EmptyState title={t('settings.about.notesEmpty')} className="px-0 py-3" />
              )}
            </div>
            <div data-testid="about-update-action">
              <UpdateAction />
            </div>
          </div>

          <Divider className="my-1" />
        </>
      )}

      <KeyValue label={t('settings.version')} mono>
        {appInfo?.appVersion ?? '-'}
      </KeyValue>
      <KeyValue label={t('settings.electron')} mono>
        {appInfo?.electronVersion ?? '-'}
      </KeyValue>
      <KeyValue label={t('settings.chrome')} mono>
        {appInfo?.chromeVersion ?? '-'}
      </KeyValue>
      <KeyValue label={t('settings.node')} mono>
        {appInfo?.nodeVersion ?? '-'}
      </KeyValue>

      <Divider className="my-1" />

      {releaseNotes ? (
        <div data-testid="about-release-notes">
          <ReleaseNotes sections={releaseNotes.sections} />
        </div>
      ) : (
        <div data-testid="about-release-notes-empty">
          <EmptyState title={t('settings.about.notesEmpty')} className="px-0 py-3" />
        </div>
      )}

      <Divider className="my-1" />

      <UpdateCheckRow />

      <Divider className="my-1" />

      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <SectionLabel>{t('settings.userData')}</SectionLabel>
          <p
            className="numeric truncate text-[11px] text-ink-muted"
            title={appInfo?.userDataPath}
            data-selectable
          >
            {appInfo?.userDataPath ?? '-'}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          icon={<FolderOpen className="size-3.5" />}
          disabled={!appInfo}
          onClick={() => {
            if (appInfo) void invoke('app:revealPath', appInfo.userDataPath)
          }}
        >
          {t('settings.openFolder')}
        </Button>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <SectionLabel>{t('settings.logs')}</SectionLabel>
          <p
            className="numeric truncate text-[11px] text-ink-muted"
            title={appInfo?.logPath}
            data-selectable
          >
            {appInfo?.logPath ?? '-'}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          icon={<FolderOpen className="size-3.5" />}
          disabled={!appInfo}
          onClick={() => {
            if (appInfo) void invoke('app:revealPath', appInfo.logPath)
          }}
        >
          {t('settings.openFolder')}
        </Button>
      </div>

      <Divider className="my-1" />

      <div className="flex flex-wrap gap-3">
        <Button
          variant="link"
          size="sm"
          icon={<ExternalLink className="size-3.5" />}
          data-testid="about-link-repository"
          onClick={() => void invoke('app:openExternal', APP_REPO_URL)}
        >
          {t('settings.repository')}
        </Button>
        <Button
          variant="link"
          size="sm"
          icon={<ExternalLink className="size-3.5" />}
          data-testid="about-link-changelog"
          onClick={() => void invoke('app:openExternal', APP_CHANGELOG_URL)}
        >
          {t('settings.changelog')}
        </Button>
      </div>
    </>
  )
}
