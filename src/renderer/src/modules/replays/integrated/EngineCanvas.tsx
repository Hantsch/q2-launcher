import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { engineLoader, type EngineLoader } from './engine-loader'
import type { EngineHost } from './engine-module'

export interface EngineCanvasProps {
  loader?: EngineLoader
}

/**
 * Hosts the loader-owned engine canvas inside the stage. The canvas and its WebGL
 * context outlive this component: unmounting only pauses, disconnects and detaches, so a remount
 * re-attaches the same instance. The drawing buffer has one owner - this component - and is kept
 * at CSS size x devicePixelRatio. The canvas gets no tabindex: the engine receives no keys. (story 290)
 */
export function EngineCanvas({ loader = engineLoader }: EngineCanvasProps) {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const [problem, setProblem] = useState<'lost' | 'failed' | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return undefined
    // A load that resolves after unmount must never be attached or driven.
    const unmounted = new AbortController()
    let host: EngineHost | null = null
    let frame: number | null = null

    const stopFrames = (): void => {
      if (frame !== null) cancelAnimationFrame(frame)
      frame = null
    }

    const fitBuffer = (): void => {
      if (!host) return
      const canvas = host.canvas
      const rect = canvas.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      const width = Math.round(rect.width * dpr)
      const height = Math.round(rect.height * dpr)
      // A hidden stage measures 0x0; keeping the last buffer avoids a 0-sized GL viewport.
      if (width > 0 && height > 0 && (canvas.width !== width || canvas.height !== height)) {
        canvas.width = width
        canvas.height = height
        host.resize()
      }
      frame = requestAnimationFrame(fitBuffer)
    }

    // The GL context is gone for good: the instance is useless, but the stage and session stay.
    const onContextLost = (event: Event): void => {
      event.preventDefault()
      stopFrames()
      const old = host
      host = null
      if (old) {
        old.canvas.removeEventListener('webglcontextlost', onContextLost)
        old.pauseLoop()
      }
      loader.discard()
      setProblem('lost')
    }

    loader.load().then(
      (loaded) => {
        if (unmounted.signal.aborted) return
        host = loaded
        loaded.canvas.className = 'block h-full w-full'
        loaded.canvas.addEventListener('webglcontextlost', onContextLost)
        container.appendChild(loaded.canvas)
        loaded.resumeLoop()
        fitBuffer()
      },
      () => {
        if (!unmounted.signal.aborted) setProblem('failed')
      },
    )

    return () => {
      unmounted.abort()
      stopFrames()
      const old = host
      host = null
      if (!old) return
      old.canvas.removeEventListener('webglcontextlost', onContextLost)
      old.pauseLoop()
      old.disconnect()
      old.canvas.remove()
    }
  }, [loader])

  return (
    <div className="relative h-full w-full">
      <div
        ref={containerRef}
        className="h-full w-full"
        role="img"
        aria-label={t('replays.integrated.canvasLabel')}
        aria-hidden={problem !== null || undefined}
      />
      {problem && (
        <div
          className="absolute inset-0 flex items-center justify-center bg-panel p-4 text-center text-sm text-ink"
          role="status"
          data-testid="replays-engine-lost"
        >
          {problem === 'lost'
            ? t('replays.integrated.error.contextLost')
            : t('replays.integrated.error.loadFailed')}
        </div>
      )}
    </div>
  )
}
