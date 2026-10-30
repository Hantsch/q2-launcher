/** The slice of the Emscripten module the host drives. */
export interface RawEngineModule {
  _q2l_resize: () => void
  pauseMainLoop: () => void
  resumeMainLoop: () => void
  ccall: (name: string, returnType: null, argTypes: string[], args: unknown[]) => unknown
}

export type EngineFactory = (args: {
  canvas: HTMLCanvasElement
  noInitialRun: true
  locateFile(p: string): string
}) => Promise<RawEngineModule>

export interface EngineHost {
  canvas: HTMLCanvasElement
  resize(): void
  pauseLoop(): void
  resumeLoop(): void
  disconnect(): void
}

export function adaptEngineModule(raw: RawEngineModule, canvas: HTMLCanvasElement): EngineHost {
  return {
    canvas,
    resize: () => raw._q2l_resize(),
    pauseLoop: () => raw.pauseMainLoop(),
    resumeLoop: () => raw.resumeMainLoop(),
    disconnect: () => {
      raw.ccall('q2l_console', null, ['string'], ['disconnect\n'])
    },
  }
}
