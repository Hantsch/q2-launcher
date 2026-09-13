import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../ui/Button'
import { ProgressBar } from '../ui/ProgressBar'
import { formatBytes, formatSpeed } from '../../lib/format'
import { useLauncher } from '../../store/useLauncher'

/**
 * Story 099 D4: the phase-based primary update action, extracted out of `UpdatePopover.tsx` (R7)
 * so the titlebar's popover and About's pending-update block (099) drive the exact same
 * download/cancel/restart logic instead of two independent copies of it. Takes no props and reads
 * `update` from the store itself - same convention `UpdatePopover` used before this extraction -
 * since both call sites need identical store-driven behaviour.
 *
 * Exactly one primary action per phase (098 Decisions):
 *  - `available` -> "Download" (a carried-over download failure, AC7, shows its reason above the
 *    button - the update stays offerable, so the button is never replaced by the error).
 *  - `downloading` -> the shared `ProgressBar` + "Cancel".
 *  - `downloaded` -> "Restart and install", unless the *last* attempt in this component instance
 *    was refused (AC6) - then the refusal reason replaces the button rather than sitting next to
 *    it. Local-only state: unmounting (e.g. the popover closing) clears it, so a fresh mount always
 *    offers a fresh attempt.
 *  - `error` -> the check-failure reason, no action (there is nothing known to offer).
 */
export function UpdateAction() {
  const { t } = useTranslation()
  const update = useLauncher((state) => state.update)
  const startDownload = useLauncher((state) => state.startDownload)
  const cancelDownload = useLauncher((state) => state.cancelDownload)
  const installAndRestart = useLauncher((state) => state.installAndRestart)

  const [restarting, setRestarting] = useState(false)
  const [refusalKey, setRefusalKey] = useState<string | null>(null)

  async function handleRestart(): Promise<void> {
    setRestarting(true)
    setRefusalKey(null)
    const result = await installAndRestart()
    setRestarting(false)
    if (!result.ok) setRefusalKey(result.error.key)
  }

  return (
    <>
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
    </>
  )
}
