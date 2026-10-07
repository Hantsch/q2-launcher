// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useSubmitting } from './useSubmitting'

describe('useSubmitting', () => {
  it('a second run while one is in flight is ignored', async () => {
    const { result } = renderHook(() => useSubmitting())
    let release: (value: string) => void = () => undefined
    let calls = 0
    const slow = (): Promise<string> => {
      calls += 1
      return new Promise((resolve) => (release = resolve))
    }

    let first: Promise<string | undefined> = Promise.resolve(undefined)
    let second: Promise<string | undefined> = Promise.resolve(undefined)
    act(() => {
      first = result.current.run(slow)
      second = result.current.run(slow)
    })
    expect(calls).toBe(1)
    expect(result.current.submitting).toBe(true)

    await act(async () => {
      release('done')
      await first
    })
    expect(await second).toBeUndefined()
    expect(await first).toBe('done')
    expect(result.current.submitting).toBe(false)
  })
})
