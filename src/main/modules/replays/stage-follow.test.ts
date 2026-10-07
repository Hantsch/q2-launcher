import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fail, ok } from '@shared/types'
import {
  createStageFollower,
  GEOMETRY_RESET_WAIT_FRAMES,
  geometryLine,
  type StageFollowWindow,
} from './stage-follow'

const LAUNCH = '800x600+10+20'
const win = (over: Partial<StageFollowWindow> = {}): StageFollowWindow => ({
  contentBounds: { x: 0, y: 0 },
  scaleFactor: 1,
  minimized: false,
  focused: true,
  ...over,
})
const rect = (x = 10, y = 20) => ({ x, y, width: 800, height: 600 })
const PARKED = geometryLine('800x600+3904+20')

function setup(results: Array<'ok' | 'busy'> = []) {
  const lines: string[] = []
  const send = vi.fn((line: string) => {
    lines.push(line)
    return results.shift() === 'busy' ? fail('busy') : ok(undefined)
  })
  const follower = createStageFollower({
    send,
    launchGeometry: LAUNCH,
    computeGeometry: (r) => `${r.width}x${r.height}+${r.x}+${r.y}`,
    parkGeometry: (g) => g.replace(/\+\d+\+/, '+3904+'),
  })
  return { lines, follower }
}

describe('geometryLine', () => {
  it('re-sets the geometry a few frames later, so a same-pass win_* change cannot undo it', () => {
    expect(geometryLine('3840x2160+0+0')).toBe(
      `set vid_geometry 3840x2160+0+0; wait ${GEOMETRY_RESET_WAIT_FRAMES}; set vid_geometry 3840x2160+0+0`,
    )
  })
})

describe('stage follower', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('nothing is sent before an input changes', () => {
    const { lines, follower } = setup()
    follower.update({ stageRect: rect(), window: win() })
    vi.advanceTimersByTime(2000)
    expect(lines).toEqual([])
  })

  it('a drag parks once and places once at the end', () => {
    vi.setSystemTime(1000)
    const { lines, follower } = setup()
    for (let i = 0; i < 5; i++) {
      follower.update({ stageRect: rect(10 + i * 30), window: win(), tick: true })
      vi.advanceTimersByTime(50)
    }
    expect(lines).toEqual([PARKED])
    vi.advanceTimersByTime(300)
    expect(lines).toEqual([PARKED, geometryLine('800x600+130+20')])
  })

  it('a diagonal drag parks once and places once at the end', () => {
    vi.setSystemTime(1000)
    const { lines, follower } = setup()
    for (let i = 0; i < 5; i++) {
      follower.update({ stageRect: rect(10 + i * 30, 20 + i * 15), window: win(), tick: true })
      vi.advanceTimersByTime(50)
    }
    expect(lines).toEqual([PARKED])
    vi.advanceTimersByTime(300)
    expect(lines).toEqual([PARKED, geometryLine('800x600+130+80')])
  })

  it('a stage-rect change alone places after quiet without parking', () => {
    const { lines, follower } = setup()
    follower.update({ stageRect: rect(50, 60), window: win() })
    vi.advanceTimersByTime(249)
    expect(lines).toEqual([])
    vi.advanceTimersByTime(1)
    expect(lines).toEqual([geometryLine('800x600+50+60')])
  })

  it('minimize parks, restore places', () => {
    const { lines, follower } = setup()
    follower.update({ stageRect: rect(), window: win({ minimized: true }) })
    expect(lines).toEqual([PARKED])
    follower.update({ stageRect: rect(), window: win() })
    expect(lines).toHaveLength(1)
    vi.advanceTimersByTime(250)
    expect(lines).toEqual([PARKED, geometryLine('800x600+10+20')])
  })

  it('blur drops topmost, focus restores it', () => {
    const { lines, follower } = setup()
    follower.update({ stageRect: rect(), window: win({ focused: false }) })
    follower.update({ stageRect: rect(), window: win({ focused: false }) })
    expect(lines).toEqual(['set win_alwaysontop 0'])
    follower.update({ stageRect: rect(), window: win({ focused: true }) })
    expect(lines).toEqual(['set win_alwaysontop 0', 'set win_alwaysontop 1'])
  })

  it('a busy send is retried', () => {
    const { lines, follower } = setup(['busy'])
    follower.update({ stageRect: rect(), window: win({ minimized: true }) })
    expect(lines).toEqual([PARKED])
    vi.advanceTimersByTime(250)
    expect(lines).toEqual([PARKED, PARKED])
    vi.advanceTimersByTime(1000)
    expect(lines).toHaveLength(2)
  })

  it('dispose sends nothing further', () => {
    const { lines, follower } = setup()
    follower.update({ stageRect: rect(50, 60), window: win() })
    follower.dispose()
    vi.advanceTimersByTime(1000)
    expect(lines).toEqual([])
  })

  it('a pinned follower sends the pin geometry and never win_alwaysontop', () => {
    const { lines, follower } = setup()
    follower.pin('1920x1080+0+0')
    follower.update({ stageRect: rect(50, 60), window: win({ focused: false }), tick: true })
    follower.update({ stageRect: rect(70, 60), window: win({ focused: true }) })
    vi.advanceTimersByTime(1000)
    expect(lines).toEqual([geometryLine('1920x1080+0+0')])
  })

  it('unpinning re-sends the stage geometry', () => {
    const { lines, follower } = setup()
    follower.update({ stageRect: rect(), window: win() })
    follower.pin('1920x1080+0+0')
    follower.pin(null)
    expect(lines).toEqual([geometryLine('1920x1080+0+0'), geometryLine('800x600+10+20')])
  })
})

describe('stage follower with a window-state owner', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  function withState() {
    const lines: string[] = []
    const tops: Array<0 | 1> = []
    const placed: string[] = []
    const follower = createStageFollower({
      send: (line) => {
        lines.push(line)
        return ok(undefined)
      },
      launchGeometry: LAUNCH,
      computeGeometry: (r) => `${r.width}x${r.height}+${r.x}+${r.y}`,
      parkGeometry: (g) => g.replace(/\+\d+\+/, '+3904+'),
      windowState: {
        setTop: (top) => {
          tops.push(top)
          return ok(undefined)
        },
        placed: (g) => placed.push(g),
      },
    })
    return { lines, tops, placed, follower }
  }

  it('reports the launch geometry once at creation', () => {
    expect(withState().placed).toEqual([LAUNCH])
  })

  it('forwards focus to setTop and sends no win_alwaysontop line', () => {
    const { lines, tops, follower } = withState()
    follower.update({ stageRect: rect(), window: win({ focused: false }) })
    follower.update({ stageRect: rect(), window: win({ focused: true }) })
    expect(tops).toEqual([0, 1])
    expect(lines.some((l) => l.includes('win_alwaysontop'))).toBe(false)
  })

  it('reports every geometry it sends', () => {
    const { placed, follower } = withState()
    follower.update({ stageRect: rect(30, 40), window: win(), tick: true })
    vi.advanceTimersByTime(300)
    expect(placed).toEqual([LAUNCH, '800x600+3904+40', '800x600+30+40'])
  })

  it('a pinned follower never calls setTop', () => {
    const { tops, follower } = withState()
    follower.pin('1920x1080+0+0')
    follower.update({ stageRect: rect(), window: win({ focused: false }) })
    expect(tops).toEqual([])
  })

  it('without it, win_alwaysontop is still sent as a console line', () => {
    const { lines, follower } = setup()
    follower.update({ stageRect: rect(), window: win({ focused: false }) })
    expect(lines).toContain('set win_alwaysontop 0')
  })
})
