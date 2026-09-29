import { useLayoutEffect, type RefObject } from 'react'
import { useOverlayRegistry } from '../../lib/overlay-registry'
import { sendStageRect } from './client'
import { usePlaybackStore, type StageRect } from './playback-store'

/**
 * Story 171 D3: keeps the main-side follower told where the stage is. The element's viewport rect is
 * read once per animation frame (a resize is not the only way the box moves - rows around it reflow),
 * so at most one `playback.stage` call leaves per frame, and only when the rounded rect changed.
 * - Before a session is live, measurements only record the baseline (the launch carries the rect).
 * - Mounting while a session is live (the user came back to the Demos view) reports the first real rect.
 * - Unmounting while a session is live (the user left the view) reports `null`: no stage, park the game.
 * - An overlay open over the stage (`overlay-registry`) reports `null` too, and the rect again once it closes.
 * The session ending needs no `null`: main ends its follower with the session.
 */
export function useStageReport(ref: RefObject<HTMLElement | null>): void {
  const setStageRect = usePlaybackStore((s) => s.setStageRect)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return undefined
    let last: StageRect | null = null
    let occluded = false
    let frame = 0
    const liveAtMount = usePlaybackStore.getState().session !== null
    const measure = (): void => {
      const r = el.getBoundingClientRect()
      const rect = {
        x: Math.round(r.x),
        y: Math.round(r.y),
        width: Math.round(r.width),
        height: Math.round(r.height),
      }
      const prev = last
      const nowOccluded = useOverlayRegistry.getState().occludes(rect)
      const moved =
        prev === null || prev.x !== rect.x || prev.y !== rect.y || prev.width !== rect.width || prev.height !== rect.height
      if (moved) {
        last = rect
        setStageRect(rect)
      }
      if (moved || nowOccluded !== occluded) {
        const wasOccluded = occluded
        occluded = nowOccluded
        const live = usePlaybackStore.getState().session !== null
        if (live && rect.width > 0 && (prev !== null || liveAtMount)) {
          if (nowOccluded) {
            if (!wasOccluded) void sendStageRect(null)
          } else void sendStageRect(rect)
        }
      }
      frame = requestAnimationFrame(measure)
    }
    measure()
    return () => {
      cancelAnimationFrame(frame)
      if (usePlaybackStore.getState().session !== null && !occluded) void sendStageRect(null)
    }
  }, [ref, setStageRect])
}
