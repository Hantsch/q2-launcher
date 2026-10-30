// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { adaptEngineModule, type RawEngineModule } from './engine-module'

describe('engine module adapter', () => {
  it("the host maps resize, loop and disconnect onto the engine's exports", () => {
    const raw: RawEngineModule = {
      _q2l_resize: vi.fn(),
      pauseMainLoop: vi.fn(),
      resumeMainLoop: vi.fn(),
      ccall: vi.fn(),
    }
    const canvas = document.createElement('canvas')
    const host = adaptEngineModule(raw, canvas)
    host.resize()
    host.pauseLoop()
    host.resumeLoop()
    host.disconnect()
    expect(host.canvas).toBe(canvas)
    expect(raw._q2l_resize).toHaveBeenCalledOnce()
    expect(raw.pauseMainLoop).toHaveBeenCalledOnce()
    expect(raw.resumeMainLoop).toHaveBeenCalledOnce()
    expect(raw.ccall).toHaveBeenCalledWith('q2l_console', null, ['string'], ['disconnect\n'])
  })
})
