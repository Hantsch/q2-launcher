import { adaptEngineModule, type EngineFactory, type EngineHost } from './engine-module'

const ENGINE_BASE = '/engine/'

export interface EngineLoader {
  load(): Promise<EngineHost>
  discard(): void
}

function teardown(host: EngineHost): void {
  host.pauseLoop()
  host.disconnect()
  host.canvas.remove()
}

/** The loader owns the canvas: a WebGL context is bound to its element, so consumers only attach and detach it. */
export function createEngineLoader(importFactory: () => Promise<EngineFactory>): EngineLoader {
  let pending: Promise<EngineHost> | null = null
  let instance: EngineHost | null = null

  const load = (): Promise<EngineHost> => {
    if (pending) return pending
    const canvas = document.createElement('canvas')
    canvas.id = 'q2l-engine-canvas'
    canvas.setAttribute('data-testid', 'replays-engine-canvas')
    const mine: Promise<EngineHost> = importFactory()
      .then((factory) =>
        factory({ canvas, noInitialRun: true, locateFile: (p) => `${ENGINE_BASE}${p}` }),
      )
      .then((raw) => {
        const host = adaptEngineModule(raw, canvas)
        if (pending === mine) {
          instance = host
        } else {
          // A discard while loading dropped `pending`: the late instance would be orphaned.
          teardown(host)
        }
        return host
      })
    mine.catch(() => {
      if (pending === mine) pending = null
    })
    pending = mine
    return mine
  }

  const discard = (): void => {
    const old = instance
    instance = null
    pending = null
    if (old) teardown(old)
  }

  window.addEventListener('pagehide', discard)
  return { load, discard }
}

const engineUrl = `${ENGINE_BASE}q2pro.js`

export const engineLoader = createEngineLoader(
  async () => ((await import(/* @vite-ignore */ engineUrl)) as { default: EngineFactory }).default,
)
