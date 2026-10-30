import type { EngineFactory, RawEngineModule } from './engine-module'

export interface FakeEngineCounters {
  instances: number
  resizes: number
  disconnects: number
  keyEvents: number
  loopRunning: boolean
  lastResize: { width: number; height: number } | null
  /** Every path written through FS, with its byte size. */
  files: Record<string, number>
  /** Args of every callMain. */
  mainArgs: string[][]
  cvars: Record<string, string>
  /** How long a demo plays before `q2l_demo_eof()` turns 1; the harness may change it. */
  demoPlayMs: number
}

// Bands are repainted every frame: a resize clears the drawing buffer, and the next frame must
// bring the pixels back. The middle band is never black so a centre-pixel read proves a paint.
const BANDS: readonly (readonly [number, number, number])[] = [
  [0.9, 0.2, 0.2],
  [0.2, 0.8, 0.3],
  [0.2, 0.4, 0.9],
]

// Distinct from BANDS so a flow can tell a loaded demo from the idle picture.
const DEMO_BANDS: readonly (readonly [number, number, number])[] = [
  [0.9, 0.9, 0.1],
  [0.1, 0.8, 0.8],
  [0.8, 0.1, 0.8],
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
    files: {},
    mainArgs: [],
    cvars: {},
    demoPlayMs: 1500,
  })
  counters.instances += 1

  const canvas = args.canvas
  const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true })
  canvas.addEventListener('keydown', () => {
    counters.keyEvents += 1
  })

  let frame: number | null = null
  let game = 'baseq2'
  let demoLoaded = false
  let demoEof = 0
  let demoTimer: ReturnType<typeof setTimeout> | null = null
  const dirs = new Set<string>()
  const say = (text: string): void => args.print?.(text)

  const clearDemo = (): void => {
    if (demoTimer !== null) clearTimeout(demoTimer)
    demoTimer = null
    demoLoaded = false
    demoEof = 0
  }

  const startDemo = (name: string): void => {
    if (!(`/q2/${game}/demos/${name}` in counters.files)) {
      say(`Couldn't open demos/${name}`)
      return
    }
    clearDemo()
    demoLoaded = true
    demoTimer = setTimeout(() => {
      demoEof = 1
    }, counters.demoPlayMs)
  }

  const setCvar = (name: string, value: string): void => {
    counters.cvars[name] = value
    if (name === 'game') game = value
  }

  // Q2PRO runs the line immediately, so a script's effects are visible as soon as ccall returns.
  const runCommand = (line: string): void => {
    const [word, ...rest] = line.split(/\s+/)
    switch (word) {
      case 'set':
        if (rest[0] !== undefined) setCvar(rest[0], rest[1] ?? '')
        break
      case 'exec':
        say(`Execing ${rest[0] ?? ''}`)
        break
      case 'demo':
        startDemo(rest[0] ?? '')
        break
      case 'disconnect':
        clearDemo()
        counters.disconnects += 1
        break
      case 'game':
        if (rest[0] !== undefined) game = rest[0]
        break
      default:
        say(`Unknown command "${word}"`)
    }
  }

  const runLines = (text: string): void => {
    for (const part of text.split(/[;\n]/)) {
      const line = part.trim()
      if (line) runCommand(line)
    }
  }

  // After the end the loop keeps painting the same bands: that is the last picture.
  const paint = (): void => {
    if (!gl) return
    const { width, height } = canvas
    gl.viewport(0, 0, width, height)
    gl.enable(gl.SCISSOR_TEST)
    const band = Math.ceil(height / BANDS.length)
    ;(demoLoaded ? DEMO_BANDS : BANDS).forEach(([r, gr, b], i) => {
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
    callMain: (mainArgs) => {
      counters.mainArgs.push([...mainArgs])
      for (let i = 0; i < mainArgs.length; i++) {
        if (mainArgs[i] === '+set' && i + 2 < mainArgs.length) {
          setCvar(mainArgs[i + 1], mainArgs[i + 2])
          i += 2
        } else if (mainArgs[i] === '+demo' && i + 1 < mainArgs.length) {
          startDemo(mainArgs[i + 1])
          i += 1
        }
      }
    },
    FS: {
      mkdirTree: (path) => {
        dirs.add(path)
      },
      writeFile: (path, data) => {
        counters.files[path] =
          typeof data === 'string' ? new TextEncoder().encode(data).length : data.length
      },
      unlink: (path) => {
        delete counters.files[path]
      },
      analyzePath: (path) => ({ exists: path in counters.files || dirs.has(path) }),
      stat: (path) => ({ size: counters.files[path] ?? 0 }),
    },
    _q2l_demo_eof: () => demoEof,
    pauseMainLoop: () => {
      if (frame !== null) cancelAnimationFrame(frame)
      frame = null
      counters.loopRunning = false
    },
    resumeMainLoop: () => {
      if (frame === null) frame = requestAnimationFrame(tick)
      counters.loopRunning = true
    },
    ccall: (name, _returnType, _argTypes, callArgs) => {
      if (name === 'q2l_console' && typeof callArgs[0] === 'string') runLines(callArgs[0])
      return undefined
    },
  }
  return Promise.resolve(module)
}

export default factory
