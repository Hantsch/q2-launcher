import { describe, expect, it, vi } from 'vitest'
import { fail, ok, type Outcome } from '@shared/types'
import { NO_SESSION } from './playback-control'
import { createPlaybackVolume } from './playback-volume'

function setup(live = true) {
  const lines: string[] = []
  const settles: Array<() => void> = []
  const playback = {
    send: vi.fn((line: string): Outcome<void> => {
      if (!live) return fail(NO_SESSION)
      lines.push(line)
      return ok(undefined)
    }),
    settled: vi.fn(() => new Promise<void>((resolve) => settles.push(resolve))),
    setVolume: vi.fn(),
  }
  const volume = createPlaybackVolume({ playback })
  const settle = async (): Promise<void> => {
    settles.shift()?.()
    await Promise.resolve()
    await Promise.resolve()
  }
  return { volume, lines, playback, settle, inFlight: () => settles.length }
}

describe('playback volume', () => {
  it('sends s_volume as a fraction', () => {
    const t = setup()
    expect(t.volume.set({ percent: 70, muted: false })).toEqual(ok(undefined))
    expect(t.lines).toEqual(['s_volume 0.7'])
    expect(t.playback.setVolume).toHaveBeenCalledWith({ percent: 70, muted: false })
  })

  it('mute sends 0 and keeps the level', () => {
    const t = setup()
    t.volume.set({ percent: 40, muted: true })
    expect(t.lines).toEqual(['s_volume 0'])
    expect(t.playback.setVolume).toHaveBeenCalledWith({ percent: 40, muted: true })
  })

  it('a burst of changes keeps one line in flight and ends on the last value', async () => {
    const t = setup()
    for (const percent of [10, 20, 30, 40, 50]) {
      expect(t.volume.set({ percent, muted: false }).ok).toBe(true)
    }
    expect(t.lines).toEqual(['s_volume 0.1'])
    expect(t.inFlight()).toBe(1)
    await t.settle()
    expect(t.lines).toEqual(['s_volume 0.1', 's_volume 0.5'])
    expect(t.inFlight()).toBe(1)
    await t.settle()
    expect(t.lines).toHaveLength(2)
    t.volume.set({ percent: 60, muted: false })
    expect(t.lines.at(-1)).toBe('s_volume 0.6')
  })

  it('a rejected settle does not wedge later volume changes', async () => {
    const t = setup()
    t.playback.settled.mockReturnValueOnce(Promise.reject(new Error('closed')))
    t.volume.set({ percent: 10, muted: false })
    t.volume.set({ percent: 20, muted: false })
    await Promise.resolve()
    await Promise.resolve()
    expect(t.lines).toEqual(['s_volume 0.1'])
    t.volume.set({ percent: 30, muted: false })
    expect(t.lines).toEqual(['s_volume 0.1', 's_volume 0.3'])
  })

  it('no session is the no-session error', () => {
    const t = setup(false)
    expect(t.volume.set({ percent: 70, muted: false })).toEqual(fail(NO_SESSION))
    expect(t.playback.setVolume).not.toHaveBeenCalled()
  })
})
