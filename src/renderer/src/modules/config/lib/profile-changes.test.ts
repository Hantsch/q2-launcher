// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react'
import { cleanup, render, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { ConfigProfile } from '@shared/modules/config'
import { captureBaseline } from '@shared/config/profile-baseline'
import { diffProfileAgainstBaseline } from '@shared/config/profile-diff'
import { ProfileChangesProvider, useProfileChanges } from './profile-changes'

/**
 * Story 049 D4. `useProfileChanges`/`ProfileChangesProvider` only wire `diffProfileAgainstBaseline`
 * (tested on its own merits in `@shared/config/profile-diff.test.ts`) into React context, so these
 * tests cover the wiring - what the hook returns, when it recomputes, and what happens without a
 * provider - not the diff logic itself.
 */

function profile(overrides: Partial<ConfigProfile> = {}): ConfigProfile {
  return {
    id: 'p1',
    name: 'Profile One',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    cvars: {},
    binds: {},
    assignments: [],
    ...overrides,
  }
}

/** A profile that carries a baseline (so the diff has something to compare against) plus one
 * unsaved cvar edit on top of it. */
function dirtyProfile(): ConfigProfile {
  const saved = profile({ cvars: { sensitivity: '3' } })
  return profile({
    cvars: { sensitivity: '4.5' },
    baseline: captureBaseline(saved),
  })
}

function wrapper(currentProfile: ConfigProfile) {
  return ({ children }: { children: ReactNode }) =>
    createElement(ProfileChangesProvider, { profile: currentProfile, children })
}

afterEach(() => {
  cleanup()
})

describe('useProfileChanges', () => {
  it('returns the diff of the profile passed to the provider', () => {
    const current = dirtyProfile()
    const { result } = renderHook(() => useProfileChanges(), { wrapper: wrapper(current) })

    expect(result.current).toEqual(diffProfileAgainstBaseline(current))
    expect(result.current.count).toBe(1)
  })

  it('does not recompute when the same profile object is passed across re-renders', () => {
    const current = dirtyProfile()
    const { result, rerender } = renderHook(() => useProfileChanges(), {
      wrapper: wrapper(current),
    })

    const first = result.current
    rerender()
    expect(result.current).toBe(first)
  })

  it('recomputes for a different profile object, even if deeply equal', () => {
    const current = dirtyProfile()
    const equivalent: ConfigProfile = { ...current, cvars: { ...current.cvars } }
    expect(equivalent).toEqual(current)
    expect(equivalent).not.toBe(current)

    let providedProfile = current
    function Wrapper({ children }: { children: ReactNode }) {
      return createElement(ProfileChangesProvider, { profile: providedProfile, children })
    }
    const { result, rerender } = renderHook(() => useProfileChanges(), { wrapper: Wrapper })

    const first = result.current
    providedProfile = equivalent
    rerender()
    expect(result.current).not.toBe(first)
    expect(result.current).toEqual(first)
  })

  it('throws when called outside a ProfileChangesProvider', () => {
    // React logs an error to the console for a thrown-during-render hook; that noise is expected
    // here and not asserted on, only the thrown error itself.
    expect(() => render(createElement(TestConsumer))).toThrow(
      'useProfileChanges must be used within a ProfileChangesProvider',
    )
  })
})

function TestConsumer() {
  useProfileChanges()
  return null
}
