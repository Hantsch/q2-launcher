/**
 * Pure state machine for the home screen's news carousel (story 083 D1). No React, no DOM -
 * this is consumed by a React hook in D3, but is fully testable standalone.
 *
 * `isRunning` is derived, never stored directly: the timer may only advance the carousel when
 * nothing is holding it back. Hover and focus are transient booleans that come and go with the
 * pointer/keyboard; `latched` is the explicit pause control's own state and is never touched by
 * hover/focus transitions - that is what lets the latch survive a hover leaving.
 */

export interface CarouselState {
  index: number
  count: number
  latched: boolean
  hovered: boolean
  focused: boolean
  reducedMotion: boolean
}

export type CarouselAction =
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'goto'; index: number }
  | { type: 'tick' }
  | { type: 'hoverEnter' }
  | { type: 'hoverLeave' }
  | { type: 'focusEnter' }
  | { type: 'focusLeave' }
  | { type: 'toggleLatch' }
  | { type: 'setCount'; count: number }
  | { type: 'setReducedMotion'; reducedMotion: boolean }

export function createCarouselState(count: number, reducedMotion = false): CarouselState {
  return { index: 0, count, latched: false, hovered: false, focused: false, reducedMotion }
}

/** True only when nothing is holding the rotation back and there is more than one slide. */
export function isRunning(state: CarouselState): boolean {
  return (
    !state.hovered &&
    !state.focused &&
    !state.latched &&
    !state.reducedMotion &&
    state.count > 1
  )
}

function wrap(index: number, count: number): number {
  if (count <= 0) return 0
  return ((index % count) + count) % count
}

function clamp(index: number, count: number): number {
  if (count <= 0) return 0
  return Math.min(Math.max(index, 0), count - 1)
}

export function carouselReducer(state: CarouselState, action: CarouselAction): CarouselState {
  switch (action.type) {
    case 'next':
      return { ...state, index: wrap(state.index + 1, state.count) }
    case 'prev':
      return { ...state, index: wrap(state.index - 1, state.count) }
    case 'goto':
      return { ...state, index: clamp(action.index, state.count) }
    case 'tick':
      return isRunning(state) ? { ...state, index: wrap(state.index + 1, state.count) } : state
    case 'hoverEnter':
      return { ...state, hovered: true }
    case 'hoverLeave':
      return { ...state, hovered: false }
    case 'focusEnter':
      return { ...state, focused: true }
    case 'focusLeave':
      return { ...state, focused: false }
    case 'toggleLatch':
      return { ...state, latched: !state.latched }
    case 'setCount':
      return { ...state, count: action.count, index: clamp(state.index, action.count) }
    case 'setReducedMotion':
      return { ...state, reducedMotion: action.reducedMotion }
    default:
      return state
  }
}
