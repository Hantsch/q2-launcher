import { useEffect, useMemo, useState } from 'react'
import type { DemoRow } from '@shared/modules/replays'
import type { LocalizedMessage } from '@shared/types'
import { demoPlayEligibility, type DemoPlayEligibility } from '@shared/replays/demo-play'
import { useLauncher } from '../../store/useLauncher'
import { playDemo } from './client'
import { usePlaybackStore, type StageRect } from './playback-store'

const STAGE_MEASURE_FRAMES = 30
const STAGE_STABLE_FRAMES = 3
const MIN_STAGE_PX = 8
const MIN_USABLE_STAGE_PX = 64

export interface DemoPlay {
  /** Null while no demo is given - not playable, and there is no reason to show. */
  eligibility: DemoPlayEligibility | null
  busy: boolean
  error: LocalizedMessage | null
  /** Plays the demo this hook was rendered with; `acknowledgeModMissing` plays past the mod warning. */
  play(acknowledgeModMissing?: boolean): Promise<void>
}

/**
 * Story 180 D2 (moved out of story 159 D3's `DemoPlayAction`, behaviour unchanged): whether `demo`
 * can be played - decided by the shared `demoPlayEligibility`, the same function main re-runs
 * before launching - and the play itself. Only the demo id and installation id cross IPC, never a
 * path. `play` closes over the render's `demo`: a caller that keeps it past a re-render (the action
 * bar) must go through a ref to the latest `play`, or it plays the previously selected demo.
 */
export function useDemoPlay(demo: DemoRow | null): DemoPlay {
  const installations = useLauncher((state) => state.installations)
  const activeInstallationId = useLauncher((state) => state.settings.activeInstallationId)
  const platform = useLauncher((state) => state.appInfo?.platform ?? '')
  const launchPhase = useLauncher((state) => state.launch.phase)
  const [error, setError] = useState<LocalizedMessage | null>(null)
  const [busy, setBusy] = useState(false)
  const gameRunning = launchPhase === 'starting' || launchPhase === 'running'

  const demoId = demo?.id ?? null
  useEffect(() => {
    setError(null)
  }, [demoId])

  // Memoised so the result (and its `reason`) keeps its identity across unrelated re-renders - a
  // published action built from it stays stable instead of republishing every render.
  const eligibility = useMemo(
    () =>
      demo === null
        ? null
        : demoPlayEligibility({ demo, installations, activeInstallationId, platform, gameRunning }),
    [demo, installations, activeInstallationId, platform, gameRunning],
  )

  async function play(acknowledgeModMissing = false): Promise<void> {
    if (demo === null || eligibility === null) return
    const target = acknowledgeModMissing
      ? demoPlayEligibility({
          demo,
          installations,
          activeInstallationId,
          platform,
          gameRunning,
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
      for (
        let frame = 0;
        canMeasure && frame < STAGE_MEASURE_FRAMES && stable < STAGE_STABLE_FRAMES;
        frame += 1
      ) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
        const rect = usePlaybackStore.getState().stageRect
        const same =
          rect !== null &&
          last !== null &&
          rect.x === last.x &&
          rect.y === last.y &&
          rect.width === last.width &&
          rect.height === last.height
        stable = same && rect.width > MIN_STAGE_PX ? stable + 1 : 0
        last = rect
      }
      // A rect that never settled can still be the border-only box before layout: launch normally then.
      const measured = usePlaybackStore.getState().stageRect
      const stage =
        measured && measured.width >= MIN_USABLE_STAGE_PX && measured.height >= MIN_USABLE_STAGE_PX
          ? measured
          : null
      const result = await playDemo({
        demoId: demo.id,
        installationId: target.installationId,
        ...(acknowledgeModMissing ? { acknowledgeModMissing: true } : {}),
        ...(stage ? { stage: { ...stage } } : {}),
      })
      if (!result.ok) {
        playback.disarmStage()
        setError(result.error)
      } else {
        const placement = result.value.stage
        playback.beginSession(demo.fileName, demo.durationMs)
        playback.setStageReason(placement && !placement.ok ? { key: placement.reasonKey } : null)
      }
    } finally {
      setBusy(false)
    }
  }

  return { eligibility, busy, error, play }
}
