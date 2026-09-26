import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ExternalLink, FolderOpen } from 'lucide-react'
import { APP_CHANGELOG_URL, APP_REPO_URL } from '@shared/constants'
import type { ReleaseNotes as ReleaseNotesResponse } from '@shared/types'
import { invoke } from '../../lib/bridge'
import { useLauncher } from '../../store/useLauncher'
import { Button } from '../ui/Button'
import { Divider, KeyValue, SectionLabel } from '../ui/primitives'
import { ReleaseNotes } from './ReleaseNotes'

/**
 * Story 099 D3: the Settings > About section's inner content - extracted out of
 * `SettingsView.tsx`, which keeps only the surrounding section chrome, the same split
 * `DownloadsSettingsSection` uses for its contributed section.
 *
 * Fetches the running version's release notes over `app:getReleaseNotes` on mount (D2's channel)
 * and renders them first; a `null` response (AC5 - no changelog section for this build) renders a
 * one-line empty sentence instead. Two external links follow: the project repository and the full
 * changelog, both routed through the same `app:openExternal` channel as every other external link
 * in this view - never `window.open`, never in-app navigation.
 *
 * The running version, the update check (D5) and a pending update's notes (D4) live in
 * `AppVersionCard.tsx` at the top of Settings instead, so they are visible without scrolling.
 */
export function AboutPanel() {
  const { t } = useTranslation()
  const appInfo = useLauncher((state) => state.appInfo)
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

  return (
    <>
      <div className="space-y-2">
        <SectionLabel>{t('settings.about.whatsNew')}</SectionLabel>
        {releaseNotes ? (
          <div data-testid="about-release-notes">
            <ReleaseNotes sections={releaseNotes.sections} />
          </div>
        ) : (
          <p className="text-xs text-ink-muted" data-testid="about-release-notes-empty">
            {t('settings.about.notesEmpty')}
          </p>
        )}
      </div>

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

      <div className="space-y-1.5">
        <SectionLabel>{t('settings.about.technical')}</SectionLabel>
        <div className="grid gap-x-6 gap-y-1 sm:grid-cols-3">
          <KeyValue label={t('settings.electron')} mono>
            {appInfo?.electronVersion ?? '-'}
          </KeyValue>
          <KeyValue label={t('settings.chrome')} mono>
            {appInfo?.chromeVersion ?? '-'}
          </KeyValue>
          <KeyValue label={t('settings.node')} mono>
            {appInfo?.nodeVersion ?? '-'}
          </KeyValue>
        </div>
      </div>
    </>
  )
}
