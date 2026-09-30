import { describe, expect, it } from 'vitest'
import { cinemaAvailability, displayGeometry, resolveOnPrimary } from './cinema'

const WAYLAND = { available: false, reason: { key: 'replays.stage.unavailable.wayland' } } as const

describe('cinema', () => {
  it('availability prefers the stage reason, then the display', () => {
    expect(cinemaAvailability({ stageReason: WAYLAND, onPrimary: false })).toEqual({
      available: false,
      reason: { key: 'replays.stage.unavailable.wayland' },
    })
    expect(cinemaAvailability({ stageReason: { available: true }, onPrimary: false })).toEqual({
      available: false,
      reason: { key: 'replays.cinema.unavailable.notPrimaryDisplay' },
    })
    expect(cinemaAvailability({ stageReason: { available: true }, onPrimary: true })).toEqual({ available: true })
  })

  it('the harness knob only applies under Q2L_UI_HARNESS', () => {
    expect(resolveOnPrimary(true, { Q2L_UI_CINEMA_DISPLAY: 'secondary' })).toBe(true)
    expect(resolveOnPrimary(true, { Q2L_UI_HARNESS: '1', Q2L_UI_CINEMA_DISPLAY: 'secondary' })).toBe(false)
    expect(resolveOnPrimary(false, { Q2L_UI_HARNESS: '1', Q2L_UI_CINEMA_DISPLAY: 'primary' })).toBe(true)
    expect(resolveOnPrimary(false, { Q2L_UI_HARNESS: '1' })).toBe(false)
  })

  it('displayGeometry formats WxH+X+Y', () => {
    expect(displayGeometry({ x: -1920, y: 0, width: 1920.4, height: 1080 })).toBe('1920x1080+-1920+0')
  })
})
