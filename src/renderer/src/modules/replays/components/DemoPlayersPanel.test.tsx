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
  it('no score or ping column', () => {
    renderPanel(TWO_TEAMS)

    expect(screen.queryAllByRole('columnheader')).toHaveLength(0)
    expect(screen.getAllByTestId('replays-detail-player-row')).toHaveLength(2)
    expect(document.body.textContent).not.toMatch(/score|ping/i)
  })

  it('a demo without teams shows one list without headings', () => {
    renderPanel({
      groups: [{ heading: null, players: [{ name: 'maq', pov: false }] }],
      spectators: [],
    })

    expect(screen.queryByTestId('replays-detail-team')).toBeNull()
    expect(screen.getByTestId('replays-detail-teams').dataset.layout).toBe('single')
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

  it('two teams sit side by side, left side 1 and right side 2', () => {
    renderPanel(TWO_TEAMS)

    const wrapper = screen.getByTestId('replays-detail-teams')
    expect(wrapper.dataset.layout).toBe('split')
    const blocks = Array.from(wrapper.querySelectorAll('table'))
    expect(blocks.map((block) => block.dataset.side)).toEqual(['1', '2'])
    // Exactly two team blocks sit directly in the wrapper: the two columns.
    expect(Array.from(wrapper.children)).toEqual(blocks)
    expect(blocks.every((block) => block.querySelectorAll('tbody').length === 1)).toBe(true)
    const headings = blocks.map((block) => block.querySelector('th'))
    expect(headings[0]?.className).toContain('text-side-1')
    expect(headings[0]?.className).not.toContain('text-side-2')
    expect(headings[1]?.className).toContain('text-side-2')
    expect(headings[1]?.className).not.toContain('text-side-1')
  })

  it('a single named team stacks with the side 1 colour', () => {
    renderPanel({
      groups: [{ heading: { team: 'Home', index: 1 }, players: [{ name: 'maq', pov: false }] }],
      spectators: [],
    })

    const wrapper = screen.getByTestId('replays-detail-teams')
    expect(wrapper.dataset.layout).toBe('stacked')
    const block = wrapper.querySelector('table')
    expect(block?.dataset.side).toBe('1')
    expect(block?.querySelector('th')?.className).toContain('text-side-1')
  })

  it('the heading shows the team name and its result', () => {
    renderPanel({
      groups: [
        { heading: { team: 'Home', result: 'Won', index: 1 }, players: [] },
        { heading: { team: 'Away', index: 2 }, players: [] },
        { heading: { index: 3 }, players: [{ name: 'maq', pov: false }] },
      ],
      spectators: [],
    })

    expect(screen.getAllByTestId('replays-detail-team').map((row) => row.textContent)).toEqual([
      'Home · Won',
      'Away',
      'Side 3',
    ])
  })

  it('more than two teams stack, each heading highlighted', () => {
    renderPanel({
      groups: [1, 2, 3].map((index) => ({
        heading: { team: `Team ${index}`, index },
        players: [{ name: `p${index}`, pov: false }],
      })),
      spectators: [],
    })

    const wrapper = screen.getByTestId('replays-detail-teams')
    expect(wrapper.dataset.layout).toBe('stacked')
    const blocks = Array.from(wrapper.querySelectorAll('table'))
    expect(blocks.map((block) => block.dataset.side)).toEqual(['1', '2', '1'])
    const headings = screen.getAllByTestId('replays-detail-team')
    expect(headings).toHaveLength(blocks.length)
    headings.forEach((heading, position) => {
      const classes = (heading.querySelector('th')?.className ?? '').split(/\s+/)
      expect(classes).toContain(`text-side-${blocks[position].dataset.side}`)
      expect(classes.filter((name) => name.startsWith('text-side-'))).toHaveLength(1)
    })
  })

  it('spectators sit in a closed disclosure that names their count', () => {
    renderPanel(TWO_TEAMS)

    const details = screen.getByTestId('replays-detail-spectators') as HTMLDetailsElement
    expect(details.open).toBe(false)
    expect(details.querySelector('summary')?.textContent).toBe('Spectators (1)')
    expect(details.textContent).toContain('HIMMO')
  })
})
