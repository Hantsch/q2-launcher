import { describe, expect, it } from 'vitest'
import { CINEMA_IDLE_MS, cinemaKeyAction } from './cinema'
import { timelineActionSchema } from './timeline'

const press = (code: string, key = code, shiftKey = false) => ({ code, key, shiftKey })

describe('cinema keys', () => {
  it('every overlay key maps to its timeline action', () => {
    expect(CINEMA_IDLE_MS).toBe(3000)
    expect(cinemaKeyAction(press('Space', ' '), 1)).toEqual({ kind: 'togglePause' })
    expect(cinemaKeyAction(press('KeyK', 'k'), 1)).toEqual({ kind: 'togglePause' })
    expect(cinemaKeyAction(press('ArrowLeft'), 1)).toEqual({ kind: 'jump', deltaS: -10 })
    expect(cinemaKeyAction(press('ArrowRight'), 1)).toEqual({ kind: 'jump', deltaS: 10 })
    expect(cinemaKeyAction(press('ArrowLeft', 'ArrowLeft', true), 1)).toEqual({
      kind: 'jump',
      deltaS: -60,
    })
    expect(cinemaKeyAction(press('ArrowRight', 'ArrowRight', true), 1)).toEqual({
      kind: 'jump',
      deltaS: 60,
    })
    expect(cinemaKeyAction(press('Comma', ','), 1)).toEqual({ kind: 'speed', value: 0.5 })
    expect(cinemaKeyAction(press('Period', '.'), 1)).toEqual({ kind: 'speed', value: 2 })
    expect(cinemaKeyAction(press('KeyF', 'f'), 1)).toEqual({ kind: 'fullscreen' })
    expect(cinemaKeyAction(press('Escape'), 1)).toEqual({ kind: 'leave' })
  })

  it('emits only actions the timeline accepts', () => {
    for (const code of ['Space', 'ArrowLeft', 'ArrowRight', 'Comma', 'Period', 'KeyF']) {
      const action = cinemaKeyAction(press(code), 1)
      expect(timelineActionSchema.safeParse(action).success).toBe(true)
    }
  })

  it('speed steps clamp at 0.25 and 4', () => {
    expect(cinemaKeyAction(press('Comma', ','), 0.25)).toEqual({ kind: 'speed', value: 0.25 })
    expect(cinemaKeyAction(press('Period', '.'), 4)).toEqual({ kind: 'speed', value: 4 })
    expect(cinemaKeyAction(press('Comma', ','), 0.5)).toEqual({ kind: 'speed', value: 0.25 })
    expect(cinemaKeyAction(press('Period', '.'), 2)).toEqual({ kind: 'speed', value: 4 })
  })

  it('unmapped keys map to nothing', () => {
    for (const code of ['KeyA', 'Enter', 'ArrowUp', 'Tab', 'Digit1']) {
      expect(cinemaKeyAction(press(code), 1)).toBeNull()
    }
  })
})
