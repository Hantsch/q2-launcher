import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { DemoRow } from '@shared/modules/replays'
import type { LocalizedMessage } from '@shared/types'
import { demoPlayEligibility } from '@shared/replays/demo-play'
import { useLauncher } from '../../../store/useLauncher'
import { Button } from '../../../components/ui/Button'
import { playDemo } from '../client'
import { usePlaybackStore } from '../playback-store'

export interface DemoPlayActionProps {
  demo: DemoRow
}

/**
 * Story 159 D3: the primary "Play" action for one demo, mounted into `DemoDetailPanel`. Whether it
 * can work is decided by the shared `demoPlayEligibility` (the same function main re-runs before
 * launching). When it cannot, the button stays visible and disabled and the single reason shows as
 * visible text, linked via `aria-describedby` (CLAUDE.md platform-parity rule) - never only a tooltip.
 * Only the demo id and installation id cross IPC, never a path.
 */
export function DemoPlayAction({ demo }: DemoPlayActionProps) {
  const { t } = useTranslation()
  const installations = useLauncher((state) => state.installations)
  const activeInstallationId = useLauncher((state) => state.settings.activeInstallationId)
  const platform = useLauncher((state) => state.appInfo?.platform ?? '')
  const launchPhase = useLauncher((state) => state.launch.phase)
  const [error, setError] = useState<LocalizedMessage | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setError(null)
  }, [demo.id])

  const eligibility = demoPlayEligibility({
    demo,
    installations,
    activeInstallationId,
    platform,
    gameRunning: launchPhase === 'starting' || launchPhase === 'running',
  })
  const reasonId = 'replays-demo-play-reason'

  async function handlePlay(): Promise<void> {
    if (!eligibility.ok) return
    setError(null)
    setBusy(true)
    try {
      const result = await playDemo({ demoId: demo.id, installationId: eligibility.installationId })
      if (!result.ok) setError(result.error)
      else if (!result.value.ok) setError(result.value.error)
      else usePlaybackStore.getState().beginSession(demo.fileName, demo.durationMs)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div>
        <Button
          variant="primary"
          onClick={() => void handlePlay()}
          disabled={!eligibility.ok || busy}
          aria-describedby={eligibility.ok ? undefined : reasonId}
          data-testid="replays-demo-play"
        >
          {t('replays.play.action')}
        </Button>
      </div>
      {!eligibility.ok && (
        <p className="text-xs text-ink-dim" id={reasonId} data-testid="replays-demo-play-reason">
          {t(eligibility.reason.key, eligibility.reason.params)}
        </p>
      )}
      {error && (
        <p className="text-xs text-danger" role="alert" data-testid="replays-demo-play-error">
          {t(error.key, error.params)}
        </p>
      )}
    </div>
  )
}
