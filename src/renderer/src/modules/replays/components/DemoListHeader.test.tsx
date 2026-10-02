// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { initI18n } from '../../../i18n'

/** Story 176 D2. The header carries the sort state itself: aria-pressed, an arrow and direction text. */
let DemoListHeader: typeof import('./DemoListHeader').DemoListHeader

beforeAll(async () => {
  await initI18n('en')
  ;({ DemoListHeader } = await import('./DemoListHeader'))
})

afterEach(cleanup)

describe('DemoListHeader', () => {
  it('the active column carries aria-pressed, an arrow and its direction as text', () => {
    const { rerender } = render(
      createElement(DemoListHeader, { sort: { column: 'map', direction: 'asc' }, onSort: vi.fn() }),
    )
    const button = screen.getByTestId('replays-sort-map')
    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect(within(button).getByTestId('replays-sort-direction').textContent).toBe('ascending')

    rerender(
      createElement(DemoListHeader, {
        sort: { column: 'map', direction: 'desc' },
        onSort: vi.fn(),
      }),
    )
    expect(
      within(screen.getByTestId('replays-sort-map')).getByTestId('replays-sort-direction')
        .textContent,
    ).toBe('descending')

    rerender(createElement(DemoListHeader, { sort: null, onSort: vi.fn() }))
    expect(screen.queryByTestId('replays-sort-direction')).toBeNull()
    for (const b of screen.getAllByRole('button'))
      expect(b.getAttribute('aria-pressed')).toBe('false')
  })
})
