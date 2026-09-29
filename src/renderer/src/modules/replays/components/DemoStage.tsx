import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { sendStageRect } from '../client'
import { usePlaybackStore, type StageRect } from '../playback-store'
import { fitAspect, type FitRect } from '../stage-fit'

const STAGE_ASPECT = 4 / 3

export interface DemoStageProps {
  /** Overrides the store's `stageReason` (an i18n key). */
  reason?: { key: string } | null
}

/**
 * Story 170 D4: the free area of the Demos view while a demo plays (or is about to) - a centred 4:3
 * picture box whose measured viewport rect is what the launcher hands `demo.play` as the stage.
 */
export function DemoStage({ reason }: DemoStageProps) {
  const { t } = useTranslation()
  const areaRef = useRef<HTMLDivElement>(null)
  const pictureRef = useRef<HTMLDivElement>(null)
  const lastRect = useRef<StageRect | null>(null)
  const [fit, setFit] = useState<FitRect>({ x: 0, y: 0, width: 0, height: 0 })
  const setStageRect = usePlaybackStore((s) => s.setStageRect)
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

  // The picture's viewport rect is re-read every frame (one `getBoundingClientRect`): a size change
  // is caught by the observer above, but the box also moves when the rows around it reflow, and the
  // game window has to follow both. Rounded values are compared, so an unchanged box costs nothing.
  useLayoutEffect(() => {
    const el = pictureRef.current
    if (!el) return undefined
    let frame = 0
    const measure = (): void => {
      const r = el.getBoundingClientRect()
      const rect = {
        x: Math.round(r.x),
        y: Math.round(r.y),
        width: Math.round(r.width),
        height: Math.round(r.height),
      }
      const prev = lastRect.current
      if (prev === null || prev.x !== rect.x || prev.y !== rect.y || prev.width !== rect.width || prev.height !== rect.height) {
        lastRect.current = rect
        setStageRect(rect)
        // Story 170 D5: while a session is live a changed box re-places the game window. Measurements
        // before that (incl. the one the launch used) only record the baseline and are never sent.
        if (prev !== null && rect.width > 0 && usePlaybackStore.getState().session !== null) void sendStageRect(rect)
      }
      frame = requestAnimationFrame(measure)
    }
    measure()
    return () => cancelAnimationFrame(frame)
  }, [setStageRect])

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
