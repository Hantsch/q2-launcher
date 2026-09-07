// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { EngineKind } from '@shared/types/engine'
import { initI18n } from '../../i18n'
import { EngineBadge } from './EngineBadge'

/**
 * Story 065 D1: `EngineBadge` centralises the tone-per-engine rule that used
 * to be duplicated at every badge call site (rail card, hero panel). Covers
 * AC1 (r1q2 renders `R1Q2` with the flame tone), AC2 (the tone lives in one
 * place - every non-r1q2 `EngineKind` gets the neutral tone), AC3 (`unknown`
 * still gets a labelled badge, not blank), and AC5 (no image asset).
 */

const ALL_ENGINE_KINDS: EngineKind[] = [
  'r1q2',
  'q2pro',
  'yquake2',
  'kmquake2',
  'vkquake2',
  'q2rtx',
  'vanilla',
  'remaster',
  'custom',
  'unknown',
]

beforeAll(async () => {
  await initI18n('en')
})

afterEach(() => {
  cleanup()
})

describe('EngineBadge', () => {
  it('renders R1Q2 with the flame tone classes for r1q2', () => {
    render(createElement(EngineBadge, { engineKind: 'r1q2' }))
    const badge = screen.getByTestId('engine-badge')
    expect(badge.textContent).toBe('R1Q2')
    const classes = badge.className.split(/\s+/)
    expect(classes).toContain('border-flame-700')
    expect(classes).toContain('bg-flame-900/50')
    expect(classes).toContain('text-flame-300')
  })

  it('keeps the engine tone in one place: flame only for r1q2, neutral for every other kind', () => {
    for (const kind of ALL_ENGINE_KINDS) {
      const { unmount } = render(createElement(EngineBadge, { engineKind: kind }))
      const badge = screen.getByTestId('engine-badge')
      const classes = badge.className.split(/\s+/)
      if (kind === 'r1q2') {
        expect(classes).toContain('border-flame-700')
      } else {
        expect(classes).toContain('border-line-strong')
        expect(classes).toContain('bg-hover')
        expect(classes).toContain('text-ink-dim')
        expect(classes).not.toContain('border-flame-700')
      }
      unmount()
    }
  })

  it('gives an unknown engine a labelled badge, not blank or omitted', () => {
    render(createElement(EngineBadge, { engineKind: 'unknown' }))
    expect(screen.getByTestId('engine-badge').textContent).toBe('Unknown engine')
  })

  it('renders no image asset - no img element, no inline background-image', () => {
    render(createElement(EngineBadge, { engineKind: 'r1q2' }))
    const badge = screen.getByTestId('engine-badge')
    expect(badge.querySelectorAll('img').length).toBe(0)
    expect(badge.style.backgroundImage).toBe('')
  })
})
