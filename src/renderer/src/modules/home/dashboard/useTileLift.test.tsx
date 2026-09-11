// @vitest-environment jsdom
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TilePlacement } from '@shared/modules/home'
import type { LayoutOperationResult } from './layout'
import { useTileLift, type UseTileLiftOptions } from './useTileLift'

/**
 * Story 086 D6. `useTileLift` is the keyboard lift's state machine and nothing else - the reducer
 * (`layout.ts`, covered by `layout.test.ts`) and persistence (`Dashboard.tsx` -> `setHomeLayout`)
 * reach it only as injected callbacks, so these tests are exactly about the transitions: what lifts,
 * what commits, what is announced, and - the one that matters most - which placement a cancel hands
 * back after the session has already committed a change (AC8).
 */

const PLAYTIME: TilePlacement = { moduleId: 'playtime', x: 1, y: 0, w: 4, h: 4 }

function keyDown(key: string, shiftKey = false) {
  const event = { key, shiftKey, preventDefault: vi.fn() }
  return event as unknown as ReactKeyboardEvent<HTMLElement> & {
    preventDefault: ReturnType<typeof vi.fn>
  }
}

function accepted(tile: TilePlacement): LayoutOperationResult {
  return { ok: true, layout: { tiles: [tile] } }
}

function options(overrides: Partial<UseTileLiftOptions> = {}): UseTileLiftOptions {
  return {
    tile: PLAYTIME,
    disabled: false,
    onKeyboardChange: vi.fn(async (_moduleId, _kind, candidate) => accepted(candidate)),
    onCancel: vi.fn(async () => undefined),
    onAnnounce: vi.fn(),
    liftedText: 'lifted!',
    droppedText: 'dropped!',
    ...overrides,
  }
}

/** Renders the hook and presses Space on it - the state every "while lifted" case below starts from. */
function renderLifted(initial: UseTileLiftOptions = options()) {
  const rendered = renderHook((props: UseTileLiftOptions) => useTileLift(props), {
    initialProps: initial,
  })
  act(() => {
    rendered.result.current.handleKeyDown(keyDown(' '))
  })
  return rendered
}

afterEach(() => {
  cleanup()
})

describe('useTileLift', () => {
  it('lifts on Space and announces it, without touching the layout', () => {
    const props = options()
    const { result } = renderLifted(props)

    expect(result.current.lifted).toBe(true)
    expect(props.onAnnounce).toHaveBeenCalledWith('lifted!')
    expect(props.onKeyboardChange).not.toHaveBeenCalled()
    expect(props.onCancel).not.toHaveBeenCalled()
  })

  it('ignores every key while disabled - a lift is impossible outside arrange mode', () => {
    const props = options({ disabled: true })
    const { result } = renderLifted(props)

    expect(result.current.lifted).toBe(false)
    expect(props.onAnnounce).not.toHaveBeenCalled()
  })

  it('does nothing on an arrow key before the tile has been lifted', () => {
    const props = options()
    const { result } = renderHook((p: UseTileLiftOptions) => useTileLift(p), {
      initialProps: props,
    })

    const event = keyDown('ArrowRight')
    act(() => {
      result.current.handleKeyDown(event)
    })

    expect(props.onKeyboardChange).not.toHaveBeenCalled()
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('moves one cell per arrow and resizes one cell per Shift+arrow, through the same callback', () => {
    const props = options()
    const { result } = renderLifted(props)

    act(() => {
      result.current.handleKeyDown(keyDown('ArrowRight'))
    })
    expect(props.onKeyboardChange).toHaveBeenLastCalledWith('playtime', 'move', {
      ...PLAYTIME,
      x: 2,
    })

    act(() => {
      result.current.handleKeyDown(keyDown('ArrowUp'))
    })
    expect(props.onKeyboardChange).toHaveBeenLastCalledWith('playtime', 'move', {
      ...PLAYTIME,
      y: -1,
    })

    act(() => {
      result.current.handleKeyDown(keyDown('ArrowDown', true))
    })
    expect(props.onKeyboardChange).toHaveBeenLastCalledWith('playtime', 'resize', {
      ...PLAYTIME,
      h: 5,
    })

    act(() => {
      result.current.handleKeyDown(keyDown('ArrowLeft', true))
    })
    expect(props.onKeyboardChange).toHaveBeenLastCalledWith('playtime', 'resize', {
      ...PLAYTIME,
      w: 3,
    })

    // Every keystroke went through the injected callback, and the session is still lifted.
    expect(result.current.lifted).toBe(true)
  })

  it('computes the next keystroke from the committed tile it is re-rendered with', () => {
    const props = options()
    const { result, rerender } = renderLifted(props)

    act(() => {
      result.current.handleKeyDown(keyDown('ArrowRight'))
    })
    // What `Dashboard.tsx` does after an accepted keystroke: commit, re-render with the new tile.
    const moved: TilePlacement = { ...PLAYTIME, x: 2 }
    rerender({ ...props, tile: moved })

    act(() => {
      result.current.handleKeyDown(keyDown('ArrowDown', true))
    })

    // The resize is derived from the MOVED placement, not from the stale pre-move one - which is
    // exactly why each accepted keystroke is committed immediately.
    expect(props.onKeyboardChange).toHaveBeenLastCalledWith('playtime', 'resize', {
      ...moved,
      h: 5,
    })
  })

  it('stays lifted after a refused keystroke, so the user can simply press another arrow', async () => {
    const onKeyboardChange = vi.fn(async (): Promise<LayoutOperationResult> => ({
      ok: false,
      reason: 'overlaps configProfiles',
      layout: { tiles: [PLAYTIME] },
    }))
    const props = options({ onKeyboardChange })
    const { result } = renderLifted(props)

    await act(async () => {
      result.current.handleKeyDown(keyDown('ArrowRight'))
    })

    expect(result.current.lifted).toBe(true)
    expect(props.onCancel).not.toHaveBeenCalled()
    // The refusal itself is announced by the caller (it owns the reason's translation), not here.
    expect(props.onAnnounce).toHaveBeenCalledTimes(1)
  })

  it('drops on Enter: announces the drop, reverts nothing, and ends the session', () => {
    const props = options()
    const { result } = renderLifted(props)

    act(() => {
      result.current.handleKeyDown(keyDown('Enter'))
    })

    expect(result.current.lifted).toBe(false)
    expect(props.onAnnounce).toHaveBeenLastCalledWith('dropped!')
    expect(props.onCancel).not.toHaveBeenCalled()

    // The session is over - a following blur must not cancel a lift that no longer exists.
    act(() => {
      result.current.handleBlur()
    })
    expect(props.onCancel).not.toHaveBeenCalled()
  })

  it('cancel restores the pre-lift placement', () => {
    const props = options()
    const { result, rerender } = renderLifted(props)

    act(() => {
      result.current.handleKeyDown(keyDown('ArrowRight'))
    })
    rerender({ ...props, tile: { ...PLAYTIME, x: 2 } })

    act(() => {
      result.current.handleKeyDown(keyDown('Escape'))
    })

    // The ORIGINAL placement, not the one the accepted move committed in between.
    expect(props.onCancel).toHaveBeenCalledTimes(1)
    expect(props.onCancel).toHaveBeenCalledWith('playtime', PLAYTIME)
    expect(result.current.lifted).toBe(false)
    // `onCancel` announces the cancel itself - announcing here too would overwrite it.
    expect(props.onAnnounce).toHaveBeenCalledTimes(1)
  })

  it('cancels on blur with the pre-lift placement too', () => {
    const props = options()
    const { result, rerender } = renderLifted(props)

    act(() => {
      result.current.handleKeyDown(keyDown('ArrowDown'))
    })
    rerender({ ...props, tile: { ...PLAYTIME, y: 1 } })

    act(() => {
      result.current.handleBlur()
    })

    expect(props.onCancel).toHaveBeenCalledWith('playtime', PLAYTIME)
    expect(result.current.lifted).toBe(false)
  })

  it('cancels on Tab without swallowing the focus move, and only once', () => {
    const props = options()
    const { result } = renderLifted(props)

    const tab = keyDown('Tab')
    act(() => {
      result.current.handleKeyDown(tab)
    })
    // Tab must still move focus - the lift is cancelled on the way out, not instead of it.
    expect(tab.preventDefault).not.toHaveBeenCalled()
    expect(props.onCancel).toHaveBeenCalledWith('playtime', PLAYTIME)

    // The blur that follows a real Tab finds the session already closed.
    act(() => {
      result.current.handleBlur()
    })
    expect(props.onCancel).toHaveBeenCalledTimes(1)
  })

  it('does nothing on a blur while no lift is in flight', () => {
    const props = options()
    const { result } = renderHook((p: UseTileLiftOptions) => useTileLift(p), {
      initialProps: props,
    })

    act(() => {
      result.current.handleBlur()
    })

    expect(props.onCancel).not.toHaveBeenCalled()
    expect(props.onAnnounce).not.toHaveBeenCalled()
  })
})
