// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { initI18n } from '../../../i18n'
import type { BulkOutcomeView } from '../useBulkActions'

let BulkActionBar: typeof import('./BulkActionBar').BulkActionBar

beforeAll(async () => {
  await initI18n('en')
  ;({ BulkActionBar } = await import('./BulkActionBar'))
})

afterEach(() => cleanup())

const outcome: BulkOutcomeView = {
  kind: 'delete',
  done: 1,
  failed: 1,
  skipped: 0,
  entries: [
    {
      demoId: 'b',
      name: 'b.dm2',
      status: 'failed',
      reasonKey: 'replays.bulk.reason.inUse',
    },
  ],
}

function renderBar(count: number, shown: BulkOutcomeView | null) {
  render(
    createElement(BulkActionBar, {
      count,
      zipCount: 0,
      busy: null,
      outcome: shown,
      onDelete: vi.fn(),
      onTag: vi.fn(),
      onMove: vi.fn(),
    }),
  )
}

describe('BulkActionBar', () => {
  it('names a failed demo with its reason text', () => {
    renderBar(1, outcome)
    const entry = screen.getByTestId('replays-bulk-entries')
    expect(entry.textContent).toContain('b.dm2')
    expect(entry.textContent).toContain('In use by another program.')
    expect(screen.getByTestId('replays-bulk-summary').textContent).toContain('1')
  })

  it('shows no count line when the outcome outlives an emptied selection', () => {
    renderBar(0, outcome)
    expect(screen.queryByTestId('replays-bulk-count')).toBeNull()
    expect(screen.getByTestId('replays-bulk-outcome')).toBeTruthy()
  })
})
