import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { usePlaybackStore } from '../playback-store'
import { useStageReport } from '../useStageReport'
import { fitAspect, type FitRect } from '../stage-fit'

const STAGE_ASPECT = 4 / 3

export interface DemoStageProps {
  /** Overrides the store's `stageReason` (an i18n key). */
  reason?: { key: string } | null
}

/**
 * Story 170: the free area of the Demos view while a demo plays (or is about to) - a centred 4:3
 * picture box whose measured viewport rect is what the launcher hands `demo.play` as the stage.
 */
export function DemoStage({ reason }: DemoStageProps) {
  const { t } = useTranslation()
  const areaRef = useRef<HTMLDivElement>(null)
  const pictureRef = useRef<HTMLDivElement>(null)
  const [fit, setFit] = useState<FitRect>({ x: 0, y: 0, width: 0, height: 0 })
  const storeReason = usePlaybackStore((s) => s.stageReason)
  const shownReason = reason !== undefined ? reason : storeReason

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

  useStageReport(pictureRef)

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 p-5" data-testid="replays-stage">
      <div ref={areaRef} className="relative min-h-0 flex-1">
        <div
          ref={pictureRef}
          className="absolute flex items-center justify-center border border-line bg-panel text-sm text-ink-muted"
          style={{ left: fit.x, top: fit.y, width: fit.width, height: fit.height }}
          data-testid="replays-stage-picture"
        >
          {t('replays.stage.label')}
        </div>
      </div>
      {shownReason && (
        <p className="text-xs text-ink-muted" role="status" data-testid="replays-stage-reason">
          {t(shownReason.key)}
        </p>
      )}
    </div>
  )
}
