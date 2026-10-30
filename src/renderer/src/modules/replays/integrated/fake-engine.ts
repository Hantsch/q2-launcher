import type { EngineFactory, RawEngineModule } from './engine-module'

export interface FakeEngineCounters {
  instances: number
  resizes: number
  disconnects: number
  keyEvents: number
  loopRunning: boolean
  lastResize: { width: number; height: number } | null
}

// Bands are repainted every frame: a resize clears the drawing buffer, and the next frame must
// bring the pixels back. The middle band is never black so a centre-pixel read proves a paint.
const BANDS: readonly (readonly [number, number, number])[] = [
  [0.9, 0.2, 0.2],
  [0.2, 0.8, 0.3],
  [0.2, 0.4, 0.9],
]

// Standalone by design: this file is transpiled on its own into a fixture engine module, so it
// takes no runtime imports.
const factory: EngineFactory = (args) => {
  const g = globalThis as unknown as { __q2lFakeEngine?: FakeEngineCounters }
  const counters: FakeEngineCounters = (g.__q2lFakeEngine ??= {
    instances: 0,
    resizes: 0,
    disconnects: 0,
    keyEvents: 0,
    loopRunning: false,
    lastResize: null,
  })
  counters.instances += 1

  const canvas = args.canvas
  const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true })
  canvas.addEventListener('keydown', () => {
    counters.keyEvents += 1
  })

  let frame: number | null = null

  const paint = (): void => {
    if (!gl) return
    const { width, height } = canvas
    gl.viewport(0, 0, width, height)
    gl.enable(gl.SCISSOR_TEST)
    const band = Math.ceil(height / BANDS.length)
    BANDS.forEach(([r, gr, b], i) => {
      gl.scissor(0, i * band, width, band)
      gl.clearColor(r, gr, b, 1)
      gl.clear(gl.COLOR_BUFFER_BIT)
    })
    gl.disable(gl.SCISSOR_TEST)
  }

  const tick = (): void => {
    paint()
    frame = requestAnimationFrame(tick)
  }

  const module: RawEngineModule = {
    _q2l_resize: () => {
      counters.resizes += 1
      counters.lastResize = { width: canvas.width, height: canvas.height }
    },
    pauseMainLoop: () => {
      if (frame !== null) cancelAnimationFrame(frame)
      frame = null
      counters.loopRunning = false
    },
    resumeMainLoop: () => {
      if (frame === null) frame = requestAnimationFrame(tick)
      counters.loopRunning = true
    },
    ccall: (_name, _returnType, _argTypes, callArgs) => {
      if (typeof callArgs[0] === 'string' && callArgs[0].trim() === 'disconnect')
        counters.disconnects += 1
      return undefined
    },
  }
  return Promise.resolve(module)
}

export default factory
