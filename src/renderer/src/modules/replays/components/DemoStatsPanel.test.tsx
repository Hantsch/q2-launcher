// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { DemoStats } from '@shared/demos/dm2-stats'
import { initI18n } from '../../../i18n'
import { DemoStatsPanel } from './DemoStatsPanel'

beforeAll(async () => {
  await initI18n('en')
})

afterEach(cleanup)

const STATS: DemoStats = {
  player: 'shad',
  items: [
    {
      item: 'Railgun',
      accuracy: 36,
      kills: 3,
      deaths: 11,
      dealt: 1000,
      received: 2000,
      pickups: 6,
      missed: 3,
    },
    {
      item: 'Grenade Launcher',
      accuracy: null,
      kills: 0,
      deaths: 0,
      dealt: 0,
      received: 0,
      pickups: 2,
      missed: 0,
    },
  ],
  total: {
    kills: 10,
    deaths: 27,
    suicides: 1,
    teamKills: 2,
    telefrags: 3,
    dealt: 3296,
    received: 4791,
    teamDealt: 40,
    teamReceived: 50,
  },
}

function renderPanel(stats: DemoStats = STATS) {
  render(createElement(DemoStatsPanel, { stats }))
}

function cellTexts(row: HTMLElement): (string | null)[] {
  return within(row)
    .getAllByRole('cell')
    .map((cell) => cell.textContent)
}

describe('DemoStatsPanel', () => {
  it('renders the eight columns and one row per item', () => {
    renderPanel()

    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      'Item',
      'Acc.',
      'Kills',
      'Deaths',
      'Dealt',
      'Recvd',
      'Pick',
      'Miss',
    ])
    const rows = screen.getAllByTestId('replays-detail-stats-row')
    expect(rows).toHaveLength(2)
    expect(cellTexts(rows[0]!)).toEqual(['36%', '3', '11', '1000', '2000', '6', '3'])
    expect(within(rows[0]!).getByRole('rowheader').textContent).toBe('Railgun')
  })

  it('a null cell shows a dash, not 0', () => {
    renderPanel()

    const cells = cellTexts(screen.getAllByTestId('replays-detail-stats-row')[1]!)
    expect(cells[0]).toBe('-')
    expect(cells[2]).toBe('0')
  })

  it('the title carries the player name', () => {
    renderPanel()

    expect(screen.getByTestId('replays-detail-stats-title').textContent).toBe('Stats for shad')
  })

  it('the total line lists all nine values', () => {
    renderPanel()

    const total = screen.getByTestId('replays-detail-stats-total')
    const pairs = Array.from(total.querySelectorAll('dt')).map(
      (dt) => `${dt.textContent} ${dt.nextElementSibling?.textContent}`,
    )
    expect(pairs).toEqual([
      'Kills 10',
      'Deaths 27',
      'Suicides 1',
      'Team kills 2',
      'Telefrags 3',
      'Dealt 3296',
      'Received 4791',
      'Team dealt 40',
      'Team received 50',
    ])
  })

  it('no total → no total list', () => {
    renderPanel({ ...STATS, total: null })

    expect(screen.queryByTestId('replays-detail-stats-total')).toBeNull()
    expect(screen.queryByText('Total')).toBeNull()
    expect(screen.getAllByTestId('replays-detail-stats-row')).toHaveLength(2)
  })
})
