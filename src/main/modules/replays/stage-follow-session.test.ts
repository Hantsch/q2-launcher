import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ok } from '@shared/types'
import type {
  MainWindowEvent,
  MainWindowObserver,
  MainWindowSnapshot,
} from '../../main-window-observer'
import { geometryLine, STAGE_FOLLOW_QUIET_MS } from './stage-follow'
import {
  createStageFollowSessions,
  parkGeometryAt,
  virtualDesktopRightEdge,
} from './stage-follow-session'

const RECT = { x: 10, y: 20, width: 800, height: 600 }

function fakeWindow() {
  const listeners = new Set<(event: MainWindowEvent) => void>()
  let snap: MainWindowSnapshot | null = {
    contentBounds: { x: 0, y: 0, width: 1280, height: 800 },
    bounds: { x: 0, y: 0, width: 1280, height: 800 },
    zoomFactor: 1,
    displayId: 1,
    scaleFactor: 1,
    minimized: false,
    focused: true,
  }
  const observer: MainWindowObserver = {
    snapshot: () => (snap ? { ...snap, contentBounds: { ...snap.contentBounds } } : null),
    on(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  return {
    observer,
    listeners,
    set(over: Partial<MainWindowSnapshot> | null) {
      snap = over === null ? null : { ...snap!, ...over }
    },
    fire(event: MainWindowEvent) {
      for (const l of [...listeners]) l(event)
    },
  }
}

function setup() {
  const win = fakeWindow()
  const lines: string[] = []
  const sessions = createStageFollowSessions({
    window: win.observer,
    send: (line) => {
      lines.push(line)
      return ok(undefined)
    },
    computeGeometry: (r, w) =>
      `${r.width}x${r.height}+${w.contentBounds.x + r.x}+${w.contentBounds.y + r.y}`,
    parkGeometry: (g) => parkGeometryAt(g, 1920),
  })
  return { win, lines, sessions }
}

describe('parkGeometryAt / virtualDesktopRightEdge', () => {
  it('keeps size and Y, moves X 64 px beyond the right edge', () => {
    expect(parkGeometryAt('800x600+10+-20', 1920)).toBe('800x600+1984+-20')
    expect(parkGeometryAt('not a geometry', 1920)).toBe('not a geometry')
  })

  it('takes the rightmost display edge, in physical px', () => {
    const displays = [
      { bounds: { x: -1920, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 },
      { bounds: { x: 0, y: 0, width: 1280, height: 720 }, scaleFactor: 1.5 },
    ]
    expect(virtualDesktopRightEdge(displays)).toBe(1920)
    expect(virtualDesktopRightEdge(displays, (r) => ({ ...r, x: r.x + 5 }))).toBe(1285)
  })
})

describe('stage follow sessions', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('a suspended follower moves nothing (fullscreen demo) and re-places on resume', () => {
    const { win, lines, sessions } = setup()
    sessions.begin({ geometry: '800x600+10+20', rect: RECT })
    win.fire('move')
    vi.advanceTimersByTime(1000)
    lines.length = 0
    sessions.setSuspended(true)
    win.set({ contentBounds: { x: 100, y: 100, width: 1280, height: 800 } })
    win.fire('move')
    win.fire('resize')
    sessions.report({ ...RECT, x: 50 })
    vi.advanceTimersByTime(2000)
    expect(lines).toEqual([])
    sessions.setSuspended(false)
    // Resume re-feeds the follower (no timer needed to start it); it places the window where the moved
    // stage + main window now are, once the quiet period passes.
    vi.advanceTimersByTime(STAGE_FOLLOW_QUIET_MS)
    expect(lines.some((l) => l.includes('800x600+150+120'))).toBe(true)
  })

  it('without a session, window events and reports reach nothing', () => {
    const { win, lines, sessions } = setup()
    expect(win.listeners.size).toBe(0)
    expect(sessions.report(RECT)).toEqual({ ok: true, value: undefined })
    vi.advanceTimersByTime(1000)
    expect(lines).toEqual([])
  })

  it('a move parks once and places once; minimize parks, restore places; blur/focus toggle topmost', () => {
    const { win, lines, sessions } = setup()
    sessions.begin({ geometry: '800x600+10+20', rect: RECT })
    for (let i = 1; i <= 5; i++) {
      win.set({ contentBounds: { x: i * 10, y: 0, width: 1280, height: 800 } })
      win.fire('move')
      vi.advanceTimersByTime(20)
    }
    vi.advanceTimersByTime(300)
    expect(lines).toEqual([geometryLine('800x600+1984+20'), geometryLine('800x600+60+20')])

    lines.length = 0
    win.set({ minimized: true })
    win.fire('minimize')
    win.set({ minimized: false })
    win.fire('restore')
    vi.advanceTimersByTime(300)
    expect(lines).toEqual([geometryLine('800x600+1984+20'), geometryLine('800x600+60+20')])

    lines.length = 0
    win.set({ focused: false })
    win.fire('blur')
    win.set({ focused: true })
    win.fire('focus')
    vi.advanceTimersByTime(300)
    expect(lines).toEqual(['set win_alwaysontop 0', 'set win_alwaysontop 1'])
  })

  it('playback.stage moves the held rect; null parks', () => {
    const { lines, sessions } = setup()
    sessions.begin({ geometry: '800x600+10+20', rect: RECT })
    sessions.report({ ...RECT, x: 40 })
    vi.advanceTimersByTime(300)
    sessions.report(null)
    expect(lines).toEqual([geometryLine('800x600+40+20'), geometryLine('800x600+1984+20')])
  })

  it('the end unsubscribes and silences the follower, once, and only for its own session', () => {
    const { win, lines, sessions } = setup()
    const endFirst = sessions.begin({ geometry: '800x600+10+20', rect: RECT })
    const endSecond = sessions.begin({ geometry: '800x600+10+20', rect: RECT })
    expect(win.listeners.size).toBe(1)
    endFirst()
    expect(win.listeners.size).toBe(1)
    sessions.report({ ...RECT, x: 40 })
    endSecond()
    endSecond()
    expect(win.listeners.size).toBe(0)
    win.fire('blur')
    sessions.report(null)
    vi.advanceTimersByTime(1000)
    expect(lines).toEqual([])
  })

  it('a window that is gone feeds nothing', () => {
    const { win, lines, sessions } = setup()
    sessions.begin({ geometry: '800x600+10+20', rect: RECT })
    win.set(null)
    win.fire('move')
    sessions.report(null)
    vi.advanceTimersByTime(1000)
    expect(lines).toEqual([])
  })
})

describe('stage follow sessions dispose', () => {
  it('dispose ends the live follower and drops its window subscription', () => {
    const t = setup()
    const end = t.sessions.begin({ geometry: '800x600+10+20', rect: RECT })
    expect(t.win.listeners.size).toBe(1)

    t.sessions.dispose()

    expect(t.win.listeners.size).toBe(0)
    expect(t.sessions.hasFollower()).toBe(false)
    expect(t.sessions.pin('1920x1080+0+0')).toBe(false)
    // The session's own end afterwards is a no-op, not a second dispose.
    expect(() => end()).not.toThrow()
    expect(t.win.listeners.size).toBe(0)
  })
})
