// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useLauncher } from '../../store/useLauncher'
import { FeatureGate } from './FeatureGate'

/**
 * Story 130. Mirrors `ActionBar.test.tsx`'s conventions: the real Zustand store is seeded
 * directly via `useLauncher.setState`, and `window.q2` is stubbed at module scope (via
 * `vi.hoisted`) since `lib/bridge.ts` resolves it eagerly.
 */

vi.hoisted(() => {
  ;(globalThis as unknown as { q2: unknown }).q2 = {
    invoke: vi.fn(async () => ({ ok: true })),
    on: vi.fn(() => () => {}),
  }
})

beforeEach(() => {
  useLauncher.setState({ unlockedFeatures: [] })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  useLauncher.setState({ unlockedFeatures: [] })
})

function expectNothingGated(container: HTMLElement): void {
  expect(screen.queryByRole('tab')).toBeNull()
  expect(container.innerHTML).not.toContain('gated')
  expect(container.querySelector('[aria-disabled]')).toBeNull()
  expect(container.querySelector('[title]')).toBeNull()
}

describe('FeatureGate', () => {
  it('renders nothing before bootstrap resolves (initial store state)', () => {
    const { container } = render(
      <FeatureGate feature="test-only-feature">
        <button role="tab">gated</button>
      </FeatureGate>,
    )

    expectNothingGated(container)
  })

  it('renders nothing when the feature is locked', () => {
    useLauncher.setState({ unlockedFeatures: [] })

    const { container } = render(
      <FeatureGate feature="test-only-feature">
        <button role="tab">gated</button>
      </FeatureGate>,
    )

    expectNothingGated(container)
  })

  it('renders children when the feature is unlocked', () => {
    useLauncher.setState({ unlockedFeatures: ['test-only-feature'] })

    render(
      <FeatureGate feature="test-only-feature">
        <button role="tab">gated</button>
      </FeatureGate>,
    )

    const tab = screen.getByRole('tab')
    expect(tab.textContent).toBe('gated')
  })

  it('an unlocked gated surface carries the experimental badge', () => {
    useLauncher.setState({ unlockedFeatures: ['test-only-feature'] })

    render(
      <FeatureGate feature="test-only-feature">
        <button role="tab">gated</button>
      </FeatureGate>,
    )

    expect(screen.getByTestId('experimental-badge')).not.toBeNull()
    expect(screen.getByRole('tab')).not.toBeNull()
  })

  it('a locked gated surface renders no badge and nothing else', () => {
    useLauncher.setState({ unlockedFeatures: [] })

    const { container } = render(
      <FeatureGate feature="test-only-feature">
        <button role="tab">gated</button>
      </FeatureGate>,
    )

    expect(screen.queryByTestId('experimental-badge')).toBeNull()
    expectNothingGated(container)
  })
})
