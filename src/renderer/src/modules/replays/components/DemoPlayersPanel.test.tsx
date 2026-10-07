// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { DemoDetail } from '@shared/replays/demo-detail'
import { initI18n } from '../../../i18n'

let DemoPlayersPanel: typeof import('./DemoPlayersPanel').DemoPlayersPanel

beforeAll(async () => {
  await initI18n('en')
  ;({ DemoPlayersPanel } = await import('./DemoPlayersPanel'))
})

afterEach(() => {
  cleanup()
})

type Groups = DemoDetail['playerGroups']

function renderPanel(groups: Groups) {
  render(createElement(DemoPlayersPanel, { groups }))
}

const TWO_TEAMS: Groups = {
  groups: [
    { heading: { team: 'Home', index: 1 }, players: [{ name: 'maq', pov: false }] },
    { heading: { index: 2 }, players: [{ name: 'shad', pov: true }] },
  ],
  spectators: [{ name: 'HIMMO', pov: false }],
}

describe('DemoPlayersPanel', () => {
  it('renders a name-only player table without score or ping columns', () => {
    renderPanel(TWO_TEAMS)

    expect(screen.getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Name'])
    expect(screen.getAllByTestId('replays-detail-player-row')).toHaveLength(2)
    expect(document.body.textContent).not.toMatch(/score|ping/i)
  })

  it('a single unnamed side renders as one ungrouped list', () => {
    renderPanel({
      groups: [{ heading: null, players: [{ name: 'maq', pov: false }] }],
      spectators: [],
    })

    expect(screen.queryByTestId('replays-detail-team')).toBeNull()
    expect(screen.getAllByTestId('replays-detail-player-row')).toHaveLength(1)
    expect(document.querySelectorAll('tbody')).toHaveLength(1)
  })

  it('the POV row shows an icon and the text POV', () => {
    renderPanel(TWO_TEAMS)

    const rows = screen.getAllByTestId('replays-detail-player-row')
    expect(within(rows[0]).queryByTestId('replays-detail-player-pov')).toBeNull()
    const pov = within(rows[1]).getByTestId('replays-detail-player-pov')
    expect(pov.textContent).toBe('POV')
    expect(pov.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
  })

  it('groups players under team headings, falling back to the side number', () => {
    renderPanel(TWO_TEAMS)

    expect(screen.getAllByTestId('replays-detail-team').map((row) => row.textContent)).toEqual([
      'Home',
      'Side 2',
    ])
    expect(document.querySelectorAll('tbody')).toHaveLength(2)
  })

  it('spectators sit in a closed disclosure that names their count', () => {
    renderPanel(TWO_TEAMS)

    const details = screen.getByTestId('replays-detail-spectators') as HTMLDetailsElement
    expect(details.open).toBe(false)
    expect(details.querySelector('summary')?.textContent).toBe('Spectators (1)')
    expect(details.textContent).toContain('HIMMO')
  })
})
