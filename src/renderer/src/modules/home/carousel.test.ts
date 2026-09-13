import { describe, expect, it } from 'vitest'
import { carouselReducer, createCarouselState, isRunning } from './carousel'

/**
 * Story 083 D1. Pure reducer, no React/DOM - plain vitest, no jsdom environment needed.
 */
describe('carousel', () => {
  describe('next/prev/goto wrap and clamp', () => {
    it('next wraps from the last slide to the first', () => {
      const state = { ...createCarouselState(3), index: 2 }

      const next = carouselReducer(state, { type: 'next' })

      expect(next.index).toBe(0)
    })

    it('prev wraps from the first slide to the last', () => {
      const state = createCarouselState(3)

      const prev = carouselReducer(state, { type: 'prev' })

      expect(prev.index).toBe(2)
    })

    it('goto clamps below range to the first slide', () => {
      const state = createCarouselState(3)

      const result = carouselReducer(state, { type: 'goto', index: -5 })

      expect(result.index).toBe(0)
    })

    it('goto clamps above range to the last slide', () => {
      const state = createCarouselState(3)

      const result = carouselReducer(state, { type: 'goto', index: 99 })

      expect(result.index).toBe(2)
    })

    it('goto within range sets the index exactly', () => {
      const state = createCarouselState(3)

      const result = carouselReducer(state, { type: 'goto', index: 1 })

      expect(result.index).toBe(1)
    })
  })

  describe('tick advances only while running', () => {
    it('advances the index when running', () => {
      const state = createCarouselState(3)

      const ticked = carouselReducer(state, { type: 'tick' })

      expect(ticked.index).toBe(1)
    })

    it('wraps on tick past the last slide', () => {
      const state = { ...createCarouselState(3), index: 2 }

      const ticked = carouselReducer(state, { type: 'tick' })

      expect(ticked.index).toBe(0)
    })

    it('is a no-op when not running (e.g. latched)', () => {
      const state = { ...createCarouselState(3), latched: true }

      const ticked = carouselReducer(state, { type: 'tick' })

      expect(ticked).toEqual(state)
    })
  })

  describe('isRunning is false while hovered, while focused, while latched, and under reduced motion', () => {
    it('is false while hovered', () => {
      const state = { ...createCarouselState(3), hovered: true }

      expect(isRunning(state)).toBe(false)
    })

    it('is false while focus is inside', () => {
      const state = { ...createCarouselState(3), focused: true }

      expect(isRunning(state)).toBe(false)
    })

    it('is false while latched by the pause control', () => {
      const state = { ...createCarouselState(3), latched: true }

      expect(isRunning(state)).toBe(false)
    })

    it('is false under reduced motion', () => {
      const state = createCarouselState(3, true)

      expect(isRunning(state)).toBe(false)
    })

    it('is false when there is only one slide, even if nothing else pauses it', () => {
      const state = createCarouselState(1)

      expect(isRunning(state)).toBe(false)
    })

    it('is true when nothing pauses it and there is more than one slide', () => {
      const state = createCarouselState(3)

      expect(isRunning(state)).toBe(true)
    })
  })

  it('hover and focus pause the rotation and the pause control latches until pressed again', () => {
    let state = createCarouselState(3)
    expect(isRunning(state)).toBe(true)

    state = carouselReducer(state, { type: 'hoverEnter' })
    expect(isRunning(state)).toBe(false)

    state = carouselReducer(state, { type: 'hoverLeave' })
    expect(isRunning(state)).toBe(true)

    state = carouselReducer(state, { type: 'focusEnter' })
    expect(isRunning(state)).toBe(false)

    state = carouselReducer(state, { type: 'focusLeave' })
    expect(isRunning(state)).toBe(true)

    // Pressing the pause control latches it - independent of hover/focus.
    state = carouselReducer(state, { type: 'toggleLatch' })
    expect(state.latched).toBe(true)
    expect(isRunning(state)).toBe(false)

    // The latch survives a hover entering and leaving.
    state = carouselReducer(state, { type: 'hoverEnter' })
    expect(isRunning(state)).toBe(false)
    state = carouselReducer(state, { type: 'hoverLeave' })
    expect(state.latched).toBe(true)
    expect(isRunning(state)).toBe(false)

    // Pressing the pause control again releases the latch.
    state = carouselReducer(state, { type: 'toggleLatch' })
    expect(state.latched).toBe(false)
    expect(isRunning(state)).toBe(true)
  })

  it('reduced motion never runs the timer', () => {
    let state = createCarouselState(3, true)
    expect(isRunning(state)).toBe(false)

    const ticked = carouselReducer(state, { type: 'tick' })
    expect(ticked.index).toBe(0)

    // Even with no hover, no focus and no latch, reduced motion alone keeps it paused.
    state = carouselReducer(state, { type: 'hoverLeave' })
    state = carouselReducer(state, { type: 'focusLeave' })
    expect(isRunning(state)).toBe(false)
    expect(carouselReducer(state, { type: 'tick' }).index).toBe(0)
  })
})
