/** The slice of the Emscripten module the host drives. */
export interface RawEngineModule {
  _q2l_resize: () => void
  pauseMainLoop: () => void
  resumeMainLoop: () => void
  ccall: (name: string, returnType: null, argTypes: string[], args: unknown[]) => unknown
  /** Starts the engine; the build has INVOKE_RUN=0, so nothing runs until the host calls this. */
  callMain: (args: string[]) => void
  FS: EngineFs
  _q2l_demo_eof: () => number
}

export interface EngineFs {
  mkdirTree: (path: string) => void
  writeFile: (path: string, data: Uint8Array | string) => void
  unlink: (path: string) => void
  analyzePath: (path: string) => { exists: boolean }
  stat: (path: string) => { size: number }
}

/** Runs console text in the engine, synchronously. */
export function runConsole(raw: RawEngineModule, text: string): void {
  raw.ccall('q2l_console', null, ['string'], [text])
}

export type EngineFactory = (args: {
  canvas: HTMLCanvasElement
  noInitialRun: true
  locateFile(p: string): string
  print?: (text: string) => void
  printErr?: (text: string) => void
}) => Promise<RawEngineModule>

export interface EngineHost {
  canvas: HTMLCanvasElement
  /** The session drives MEMFS, callMain and the console on the same instance the canvas shows. */
  module: RawEngineModule
  resize(): void
  pauseLoop(): void
  resumeLoop(): void
  disconnect(): void
}

export function adaptEngineModule(raw: RawEngineModule, canvas: HTMLCanvasElement): EngineHost {
  return {
    canvas,
    module: raw,
    resize: () => raw._q2l_resize(),
    pauseLoop: () => raw.pauseMainLoop(),
    resumeLoop: () => raw.resumeMainLoop(),
    disconnect: () => {
      raw.ccall('q2l_console', null, ['string'], ['disconnect\n'])
    },
  }
}
