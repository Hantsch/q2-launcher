import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../ui/Button'
import { ProgressBar } from '../ui/ProgressBar'
import { formatBytes, formatSpeed } from '../../lib/format'
import { ROUTE_SETTINGS, useLauncher } from '../../store/useLauncher'

/**
 * Story 098 D3: the update popover's content, opened from `UpdateButton`. Reads the mirrored
 * `update` slice directly from the store (same convention as `ActionBar`'s `JobReadout`) rather
 * than taking it as a prop, so a real `useLauncher.setState` is enough to drive every phase in
 * tests.
 *
 * Exactly one primary action per phase (Decisions):
 *  - `available` -> "Download" (a carried-over download failure, AC7, shows its reason above the
 *    button - the update stays offerable, so the button is never replaced by the error).
 *  - `downloading` -> the shared `ProgressBar` + "Cancel".
 *  - `downloaded` -> "Restart and install", unless the *last* attempt in this popover instance was
 *    refused (AC6) - then the refusal reason replaces the button rather than sitting next to it.
 *    Local-only state: closing the popover (it unmounts while closed, `Popover.tsx`) clears it, so
 *    reopening always offers a fresh attempt.
 *  - `error` -> the check-failure reason, no action (there is nothing known to offer).
 *
 * "What changed" links into Settings -> About ([[099]]'s surface, `data-testid="settings-about"`
 * added there) rather than rendering notes here - 099 owns notes rendering.
 */
export function UpdatePopover({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const update = useLauncher((state) => state.update)
  const startDownload = useLauncher((state) => state.startDownload)
  const cancelDownload = useLauncher((state) => state.cancelDownload)
  const installAndRestart = useLauncher((state) => state.installAndRestart)
  const dismissUpdate = useLauncher((state) => state.dismissUpdate)
  const setRoute = useLauncher((state) => state.setRoute)

  const [restarting, setRestarting] = useState(false)
  const [refusalKey, setRefusalKey] = useState<string | null>(null)

  async function handleRestart(): Promise<void> {
    setRestarting(true)
    setRefusalKey(null)
    const result = await installAndRestart()
    setRestarting(false)
    if (!result.ok) setRefusalKey(result.error.key)
  }

  function goToAbout(): void {
    setRoute(ROUTE_SETTINGS)
    onClose()
    // Settings is a long scrolling view (SettingsView.tsx) and `settings-about` (099's anchor) sits
    // at the bottom of it, after every module-contributed section - without this, the user lands at
    // the top with the release notes off-screen. The route change above only takes effect on the
    // next render commit, which lands after this handler returns, so the anchor is not in the DOM
    // yet; two rAFs (one for the commit, one for the browser's next paint) is the smallest wait that
    // reliably sees it before scrolling, mirroring the `scrollIntoView` calls already used elsewhere
    // in the renderer (e.g. ControlsTab.tsx).
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document.querySelector('[data-testid="settings-about"]')?.scrollIntoView({ block: 'start' })
      })
    })
  }

  const version = update.update?.version

  return (
    <div className="space-y-3" data-testid="update-popover">
      <div className="space-y-1">
        <p className="text-sm font-medium text-ink" data-testid="update-popover-version">
          {version ? t('appUpdate.version', { version }) : t('appUpdate.popover.label')}
        </p>
        <Button
          variant="link"
          size="sm"
          onClick={goToAbout}
          data-testid="update-popover-whatchanged"
        >
          {t('appUpdate.whatChanged')}
        </Button>
      </div>

      {update.phase === 'available' && (
        <div className="space-y-2" data-testid="update-popover-available">
          {update.error && (
            <p className="text-xs text-danger" data-testid="update-popover-download-error">
              {t(update.error.key, update.error.params ?? {})}
            </p>
          )}
          <Button
            variant="primary"
            fullWidth
            onClick={() => void startDownload()}
            data-testid="update-popover-download"
          >
            {t('appUpdate.action.download')}
          </Button>
        </div>
      )}

      {update.phase === 'downloading' && (
        <div className="space-y-2" data-testid="update-popover-downloading">
          <ProgressBar
            ratio={update.progress?.ratio ?? null}
            label={t('appUpdate.progress.label')}
          />
          <div className="numeric flex items-center justify-between text-[11px] text-ink-muted">
            <span>
              {update.progress
                ? update.progress.bytesTotal
                  ? `${formatBytes(update.progress.bytesDone)} / ${formatBytes(update.progress.bytesTotal)}`
                  : formatBytes(update.progress.bytesDone)
                : formatBytes(undefined)}
            </span>
            <span>{formatSpeed(update.progress?.bytesPerSecond ?? undefined)}</span>
          </div>
          <Button
            variant="neutral"
            fullWidth
            onClick={() => void cancelDownload()}
            data-testid="update-popover-cancel"
          >
            {t('appUpdate.action.cancel')}
          </Button>
        </div>
      )}

      {update.phase === 'downloaded' &&
        (refusalKey ? (
          <p className="text-xs text-danger" data-testid="update-popover-refusal">
            {t(refusalKey)}
          </p>
        ) : (
          <Button
            variant="primary"
            fullWidth
            disabled={restarting}
            onClick={() => void handleRestart()}
            data-testid="update-popover-restart"
          >
            {t('appUpdate.action.restart')}
          </Button>
        ))}

      {update.phase === 'error' && update.error && (
        <p className="text-xs text-danger" data-testid="update-popover-check-error">
          {t(update.error.key, update.error.params ?? {})}
        </p>
      )}

      <Button
        variant="ghost"
        size="sm"
        onClick={() => void dismissUpdate()}
        data-testid="update-popover-dismiss"
      >
        {t('appUpdate.action.dismiss')}
      </Button>
    </div>
  )
}
