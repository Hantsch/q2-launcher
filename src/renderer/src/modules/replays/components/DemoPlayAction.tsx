import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { DemoRow } from '@shared/modules/replays'
import type { LocalizedMessage } from '@shared/types'
import { demoPlayEligibility } from '@shared/replays/demo-play'
import { useLauncher } from '../../../store/useLauncher'
import { Button } from '../../../components/ui/Button'
import { playDemo } from '../client'
import { usePlaybackStore, type StageRect } from '../playback-store'

const STAGE_MEASURE_FRAMES = 30
const STAGE_STABLE_FRAMES = 3
const MIN_STAGE_PX = 8
const MIN_USABLE_STAGE_PX = 64

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

  const acknowledgeable = !eligibility.ok && eligibility.acknowledgeable === true

  async function handlePlay(acknowledgeModMissing = false): Promise<void> {
    const target = acknowledgeModMissing
      ? demoPlayEligibility({
          demo,
          installations,
          activeInstallationId,
          platform,
          gameRunning: launchPhase === 'starting' || launchPhase === 'running',
          acknowledgeModMissing: true,
        })
      : eligibility
    if (!target.ok) return
    setError(null)
    setBusy(true)
    const playback = usePlaybackStore.getState()
    try {
      // Story 170 D5: stage mode first, so the picture box exists and can be measured for the launch.
      playback.armStage()
      // The stage picture is laid out and measured a few frames after mounting (and the rows around it
      // can still reflow) - wait, bounded, until its rect has been the same for a few frames.
      let stable = 0
      let last: StageRect | null = null
      // Without ResizeObserver (jsdom) nothing ever measures, so waiting would only delay the play.
      const canMeasure = typeof ResizeObserver !== 'undefined'
      for (let frame = 0; canMeasure && frame < STAGE_MEASURE_FRAMES && stable < STAGE_STABLE_FRAMES; frame += 1) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
        const rect = usePlaybackStore.getState().stageRect
        const same = rect !== null && last !== null && rect.x === last.x && rect.y === last.y && rect.width === last.width && rect.height === last.height
        stable = same && rect.width > MIN_STAGE_PX ? stable + 1 : 0
        last = rect
      }
      // A rect that never settled can still be the border-only box before layout: launch normally then.
      const measured = usePlaybackStore.getState().stageRect
      const stage = measured && measured.width >= MIN_USABLE_STAGE_PX && measured.height >= MIN_USABLE_STAGE_PX ? measured : null
      const result = await playDemo({
        demoId: demo.id,
        installationId: target.installationId,
        ...(acknowledgeModMissing ? { acknowledgeModMissing: true } : {}),
        ...(stage ? { stage: { ...stage } } : {}),
      })
      if (!result.ok) {
        playback.disarmStage()
        setError(result.error)
      } else if (!result.value.ok) {
        playback.disarmStage()
        setError(result.value.error)
      } else {
        const placement = result.value.value.stage
        playback.beginSession(demo.fileName, demo.durationMs)
        playback.setStageReason(placement && !placement.placed ? placement.reason : null)
      }
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
      {acknowledgeable && (
        <div>
          <Button
            variant="neutral"
            onClick={() => void handlePlay(true)}
            disabled={busy}
            data-testid="replays-demo-play-anyway"
          >
            {t('replays.play.anyway')}
          </Button>
        </div>
      )}
      {error && (
        <p className="text-xs text-danger" role="alert" data-testid="replays-demo-play-error">
          {t(error.key, error.params)}
        </p>
      )}
    </div>
  )
}
