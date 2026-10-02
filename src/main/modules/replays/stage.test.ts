import { describe, expect, it } from 'vitest'
import {
  REPLAYS_HANDLERS,
  REPLAYS_HANDLER_SCHEMAS,
  replaysDemoPlaySchema,
  replaysPlaybackStageSchema,
  replaysStageRectSchema,
} from '@shared/modules/replays'
import { normalWindowArgs, stageAvailability, stageGeometry, stageLaunchArgs } from './stage'

const WAYLAND = { available: false, reason: { key: 'replays.stage.unavailable.wayland' } }

describe('stageAvailability', () => {
  it('Wayland is detected by either env var, only on linux', () => {
    expect(stageAvailability('linux', { XDG_SESSION_TYPE: 'wayland' })).toEqual(WAYLAND)
    expect(stageAvailability('linux', { WAYLAND_DISPLAY: 'wayland-0' })).toEqual(WAYLAND)
    expect(stageAvailability('linux', { XDG_SESSION_TYPE: 'x11' })).toEqual({ available: true })
    expect(stageAvailability('linux', { WAYLAND_DISPLAY: '' })).toEqual({ available: true })
    expect(
      stageAvailability('win32', { XDG_SESSION_TYPE: 'wayland', WAYLAND_DISPLAY: 'w' }),
    ).toEqual({
      available: true,
    })
    expect(stageAvailability('darwin', { WAYLAND_DISPLAY: 'w' })).toEqual({ available: true })
  })

  it('the harness lever is honoured only with Q2L_UI_HARNESS', () => {
    expect(
      stageAvailability('win32', {}, { Q2L_UI_HARNESS: '1', Q2L_UI_SESSION_TYPE: 'wayland' }),
    ).toEqual(WAYLAND)
    expect(stageAvailability('win32', {}, { Q2L_UI_SESSION_TYPE: 'wayland' })).toEqual({
      available: true,
    })
    expect(
      stageAvailability('win32', {}, { Q2L_UI_HARNESS: '1', Q2L_UI_SESSION_TYPE: 'x11' }),
    ).toEqual({
      available: true,
    })
  })

  it('the unavailable reason is an i18n key', () => {
    const result = stageAvailability('linux', { XDG_SESSION_TYPE: 'wayland' })
    expect(result.available).toBe(false)
    if (!result.available)
      expect(result.reason.key).toMatch(/^replays\.stage\.unavailable\.[a-z]+$/)
  })
})

describe('stageGeometry', () => {
  const identity = <T>(rect: T): T => rect

  it('geometry is physical at 150 % and on an offset display', () => {
    // dipToScreen at 150 % scale on a display whose origin is at DIP 1920: x/y/size all multiply.
    const at150 = (r: { x: number; y: number; width: number; height: number }) => ({
      x: r.x * 1.5,
      y: r.y * 1.5,
      width: r.width * 1.5,
      height: r.height * 1.5,
    })
    expect(
      stageGeometry(
        { x: 100, y: 50, width: 640, height: 480 },
        { contentBounds: { x: 1920, y: 30 }, zoomFactor: 1 },
        at150,
      ),
    ).toBe('960x720+3030+120')
    // scale 1, zoom != 1: CSS px are multiplied by the zoom factor before conversion.
    expect(
      stageGeometry(
        { x: 10, y: 20, width: 100, height: 50 },
        { contentBounds: { x: 5, y: 7 }, zoomFactor: 1.25 },
        identity,
      ),
    ).toBe('125x63+18+32')
    // negative display origin (a monitor left of the primary) stays signed in the geometry
    expect(
      stageGeometry(
        { x: 0, y: 0, width: 200, height: 100 },
        { contentBounds: { x: -1920, y: 0 }, zoomFactor: 1 },
        identity,
      ),
    ).toBe('200x100+-1920+0')
  })

  it('passes the exact DIP rect to dipToScreen and rounds only its result', () => {
    const seen: unknown[] = []
    const stub = (r: { x: number; y: number; width: number; height: number }) => {
      seen.push(r)
      return { x: 1000.4, y: 2000.6, width: 800.5, height: 600.49 }
    }
    expect(
      stageGeometry(
        { x: 10.5, y: 20.25, width: 100.5, height: 50.5 },
        { contentBounds: { x: 5, y: 7 }, zoomFactor: 1 },
        stub,
      ),
    ).toBe('801x600+1000+2001')
    expect(seen).toEqual([{ x: 15.5, y: 27.25, width: 100.5, height: 50.5 }])
  })
})

describe('stage args', () => {
  it('stage args in exact order', () => {
    expect(stageLaunchArgs('640x480+10+20')).toEqual([
      '+set',
      'vid_fullscreen',
      '0',
      '+set',
      'win_noborder',
      '1',
      '+set',
      'win_notitle',
      '1',
      '+set',
      'win_alwaysontop',
      '1',
      '+set',
      'win_noresize',
      '1',
      '+set',
      's_driver',
      'wave',
      '+set',
      'vid_geometry',
      '640x480+10+20',
    ])
    expect(normalWindowArgs()).toEqual(['+set', 'vid_fullscreen', '0'])
  })
})

describe('stage rect schema', () => {
  const ok = { x: 0, y: 0, width: 640, height: 480 }
  it('accepts a whole-pixel rect and is registered for playback.stage', () => {
    expect(replaysStageRectSchema.safeParse(ok).success).toBe(true)
    expect(REPLAYS_HANDLER_SCHEMAS[REPLAYS_HANDLERS.playbackStage]).toBe(replaysPlaybackStageSchema)
    expect(
      replaysDemoPlaySchema.safeParse({ demoId: 'a', installationId: 'b', stage: ok }).success,
    ).toBe(true)
  })

  it('rejects negative, fractional, zero-size, oversize or extra-key rects', () => {
    for (const bad of [
      { ...ok, x: -1 },
      { ...ok, y: -1 },
      { ...ok, width: 640.5 },
      { ...ok, x: 0.5 },
      { ...ok, width: 0 },
      { ...ok, height: 0 },
      { ...ok, width: 16385 },
      { ...ok, extra: 1 },
    ]) {
      expect(replaysStageRectSchema.safeParse(bad).success).toBe(false)
      expect(
        replaysDemoPlaySchema.safeParse({ demoId: 'a', installationId: 'b', stage: bad }).success,
      ).toBe(false)
      expect(replaysPlaybackStageSchema.safeParse({ rect: bad }).success).toBe(false)
    }
  })

  it('playback.stage carries a rect or null, nothing else (story 171 D2)', () => {
    expect(replaysPlaybackStageSchema.safeParse({ rect: ok }).success).toBe(true)
    expect(replaysPlaybackStageSchema.safeParse({ rect: null }).success).toBe(true)
    for (const bad of [
      ok,
      {},
      { rect: undefined },
      { rect: ok, extra: 1 },
      { rect: { ...ok, x: Number.NaN } },
      { rect: { ...ok, width: Number.POSITIVE_INFINITY } },
    ]) {
      expect(replaysPlaybackStageSchema.safeParse(bad).success).toBe(false)
    }
  })
})
