import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { usePlaybackStore } from '../playback-store'
import { useStageReport } from '../useStageReport'
import { fitAspect, type FitRect } from '../stage-fit'
import { Button } from '../../../components/ui/Button'
import { EngineCanvas } from '../integrated/EngineCanvas'
import type { PlayerMode } from '@shared/replays/player-mode'
import type { LocalizedMessage } from '@shared/types'

const STAGE_ASPECT = 4 / 3

export interface DemoStageProps {
  /** Overrides the store's `stageReason` (an i18n key with its params). */
  reason?: LocalizedMessage | null
  /** `integrated` draws the engine in the picture box; only `engine` reports the rect to main. */
  mode?: PlayerMode
  /** Switches to engine mode and plays the refused demo there; the button shows when the store offers it. */
  onPlayInEngineMode?: () => void
}

/**
 * Story 170: the free area of the Demos view while a demo plays (or is about to) - a centred 4:3
 * picture box whose measured viewport rect is what the launcher hands `demo.play` as the stage.
 */
export function DemoStage({ reason, mode = 'engine', onPlayInEngineMode }: DemoStageProps) {
  const { t } = useTranslation()
  const areaRef = useRef<HTMLDivElement>(null)
  const pictureRef = useRef<HTMLDivElement>(null)
  const [fit, setFit] = useState<FitRect>({ x: 0, y: 0, width: 0, height: 0 })
  const storeReason = usePlaybackStore((s) => s.stageReason)
  const shownReason = reason !== undefined ? reason : storeReason
  const engineModeOffer = usePlaybackStore((s) => s.stageEngineModeOffer)
  const integratedPhase = usePlaybackStore((s) => s.integratedPhase)
  // The canvas outlives the loading, playing and finished phases and a refusal shown over it.
  const showCanvas = usePlaybackStore(
    (s) => mode === 'integrated' && s.session?.kind === 'integrated',
  )

  useEffect(() => {
    const el = areaRef.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) setFit(fitAspect(entry.contentRect, STAGE_ASPECT))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useStageReport(pictureRef, mode === 'engine')

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 p-5" data-testid="replays-stage">
      <div ref={areaRef} className="relative min-h-0 flex-1">
        <div
          ref={pictureRef}
          className="absolute flex items-center justify-center border border-line bg-panel text-sm text-ink-muted"
          style={{ left: fit.x, top: fit.y, width: fit.width, height: fit.height }}
          data-testid="replays-stage-picture"
        >
          {showCanvas ? <EngineCanvas /> : t('replays.stage.label')}
          {showCanvas && integratedPhase === 'loading' && (
            <p
              className="absolute inset-0 flex items-center justify-center bg-panel/80 text-sm text-ink"
              role="status"
              data-testid="replays-integrated-loading"
            >
              {t('replays.integrated.loading')}
            </p>
          )}
        </div>
      </div>
      {shownReason && (
        <div className="flex items-center gap-3">
          <p className="text-xs text-ink-muted" role="status" data-testid="replays-stage-reason">
            {t(shownReason.key, shownReason.params)}
          </p>
          {engineModeOffer && onPlayInEngineMode && (
            <Button size="sm" onClick={onPlayInEngineMode} data-testid="replays-stage-play-engine">
              {t('replays.integrated.playInEngineMode')}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
