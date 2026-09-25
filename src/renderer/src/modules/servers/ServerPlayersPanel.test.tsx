// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { ServerListRow } from '@shared/modules/servers'
import enJson from '../../i18n/locales/en.json'
import { initI18n } from '../../i18n'

let ServerPlayersPanel: typeof import('./ServerPlayersPanel').ServerPlayersPanel

beforeAll(async () => {
  await initI18n('en')
  ;({ ServerPlayersPanel } = await import('./ServerPlayersPanel'))
})

afterEach(() => {
  cleanup()
})

function baseRow(overrides: Partial<ServerListRow>): ServerListRow {
  return {
    address: '127.0.0.1:27910',
    origins: ['manual'],
    status: 'online',
    lastSeenAt: 'x',
    favourite: false,
    ...overrides,
  } as ServerListRow
}

function renderPanel(row: ServerListRow) {
  render(createElement(ServerPlayersPanel, { row }))
}

function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') {
    out.push(value)
  } else if (value && typeof value === 'object') {
    for (const child of Object.values(value)) collectStrings(child, out)
  }
  return out
}

describe('ServerPlayersPanel (story 122 D4)', () => {
  it('lists name, score and ping for each player', () => {
    renderPanel(
      baseRow({
        players: [
          { name: 'Alpha1', score: 12, ping: 5 },
          { name: 'Alpha2', score: 0, ping: 0 },
          { name: 'Alpha3', score: 5, ping: 8 },
        ],
      }),
    )

    const rows = screen.getAllByTestId('servers-detail-player-row')
    expect(rows).toHaveLength(3)
    // default sort: score desc -> 12, 5, 0
    expect(rows[0]?.textContent).toContain('Alpha1')
    expect(rows[1]?.textContent).toContain('Alpha3')
    expect(rows[2]?.textContent).toContain('Alpha2')
  })

  it('clicking a column header sorts by it and flips aria-sort', () => {
    renderPanel(
      baseRow({
        players: [
          { name: 'Alpha1', score: 12, ping: 5 },
          { name: 'Alpha2', score: 0, ping: 0 },
          { name: 'Alpha3', score: 5, ping: 8 },
        ],
      }),
    )

    const pingSort = screen.getByTestId('servers-detail-players-sort-ping')
    fireEvent.click(pingSort)

    let rows = screen.getAllByTestId('servers-detail-player-row')
    expect(rows[0]?.textContent).toContain('Alpha2') // ping 0, asc (natural for ping)
    expect(pingSort.closest('th')?.getAttribute('aria-sort')).toBe('ascending')

    fireEvent.click(pingSort)
    rows = screen.getAllByTestId('servers-detail-player-row')
    expect(rows[0]?.textContent).toContain('Alpha3') // ping 8, desc
    expect(pingSort.closest('th')?.getAttribute('aria-sort')).toBe('descending')
  })

  it('a known zero shows the empty state; an unknown count does not', () => {
    renderPanel(baseRow({ players: 0 }))
    expect(screen.getByTestId('servers-detail-players-empty')).toBeTruthy()
    cleanup()

    renderPanel(baseRow({ players: [] }))
    expect(screen.getByTestId('servers-detail-players-empty')).toBeTruthy()
    cleanup()

    renderPanel(baseRow({ players: 4 }))
    expect(screen.queryByTestId('servers-detail-players-empty')).toBeNull()
    expect(screen.getByTestId('servers-detail-players').textContent).toContain('4')
    cleanup()

    renderPanel(baseRow({ players: undefined }))
    expect(screen.queryByTestId('servers-detail-players-empty')).toBeNull()
  })

  it('a malformed player cell shows a dash and the other rows render', () => {
    renderPanel(
      baseRow({
        players: [
          { name: '', score: 3, ping: Number.NaN },
          { name: 'Bravo', score: 1, ping: 20 },
        ],
      }),
    )

    const rows = screen.getAllByTestId('servers-detail-player-row')
    expect(rows).toHaveLength(2)
    const malformedRow = rows.find((row) => row.textContent?.includes('Bravo') === false)
    expect(malformedRow?.textContent).toContain('—')
    expect(rows.some((row) => row.textContent?.includes('Bravo'))).toBe(true)
  })

  it('makes no spectator claim', () => {
    renderPanel(
      baseRow({
        players: [
          { name: 'Scorer', score: 10, ping: 20 },
          { name: 'Zeroed', score: 0, ping: 0 },
        ],
      }),
    )

    const panel = screen.getByTestId('servers-detail-players')
    expect(panel.textContent).not.toMatch(/spectat/i)

    const rows = screen.getAllByTestId('servers-detail-player-row')
    const scoringRow = rows.find((row) => row.textContent?.includes('Scorer'))
    const zeroRow = rows.find((row) => row.textContent?.includes('Zeroed'))
    expect(scoringRow).toBeTruthy()
    expect(zeroRow).toBeTruthy()
    expect(zeroRow?.className).toBe(scoringRow?.className)

    const attrNames = (el: Element) => Array.from(el.attributes).map((a) => a.name).sort()
    expect(attrNames(zeroRow as Element)).toEqual(attrNames(scoringRow as Element))

    const strings = collectStrings((enJson as { servers: { detail: unknown } }).servers.detail)
    expect(strings.some((s) => /spectat/i.test(s))).toBe(false)
  })
})
