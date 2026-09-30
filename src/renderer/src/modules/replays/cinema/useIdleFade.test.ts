// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useIdleFade } from './useIdleFade'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('useIdleFade (story 187 D7)', () => {
  it('controls hide after 3 s idle and stay while hovered or paused', () => {
    const { result, rerender } = renderHook(({ hold }) => useIdleFade(3000, hold), { initialProps: { hold: false } })
    expect(result.current.visible).toBe(true)
    act(() => void vi.advanceTimersByTime(2900))
    expect(result.current.visible).toBe(true)
    act(() => void vi.advanceTimersByTime(200))
    expect(result.current.visible).toBe(false)

    // Input brings them back and restarts the idle period.
    act(() => result.current.show())
    expect(result.current.visible).toBe(true)
    act(() => void vi.advanceTimersByTime(2900))
    act(() => result.current.show())
    act(() => void vi.advanceTimersByTime(2900))
    expect(result.current.visible).toBe(true)
    act(() => void vi.advanceTimersByTime(200))
    expect(result.current.visible).toBe(false)

    // Hovered or paused: shown and stays however long it is idle.
    rerender({ hold: true })
    expect(result.current.visible).toBe(true)
    act(() => void vi.advanceTimersByTime(30_000))
    expect(result.current.visible).toBe(true)

    // Releasing the hold starts a fresh idle period.
    rerender({ hold: false })
    act(() => void vi.advanceTimersByTime(2900))
    expect(result.current.visible).toBe(true)
    act(() => void vi.advanceTimersByTime(200))
    expect(result.current.visible).toBe(false)
  })
})
