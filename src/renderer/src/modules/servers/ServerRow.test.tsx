// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { ServerListRow } from '@shared/modules/servers'
import { initI18n } from '../../i18n'

let ServerRow: typeof import('./ServerRow').ServerRow

beforeAll(async () => {
  await initI18n('en')
  ;({ ServerRow } = await import('./ServerRow'))
})

afterEach(() => {
  cleanup()
})

/** A row with nothing known yet - the shape a `'pending'` placeholder actually has (story 118 D3's
 * "field-less" case), used as the base every test overrides from. */
const BASE_ROW: ServerListRow = {
  address: '1.2.3.4:27910',
  origins: ['manual'],
  status: 'pending',
  lastSeenAt: null,
  favourite: false,
}

function renderRow(row: ServerListRow, selected = false) {
  render(createElement(ServerRow, { row, selected, onSelect: () => {} }))
}

describe('ServerRow (story 118 D3)', () => {
  it('shows name, mod, players/slots, map and ping when known (AC1)', () => {
    const row: ServerListRow = {
      ...BASE_ROW,
      status: 'online',
      name: 'Fixture Server B',
      mod: 'baseq2',
      maxclients: 8,
      players: 2,
      map: 'q2dm1',
      rttMs: 42,
    }
    renderRow(row)

    const button = screen.getByTestId(`servers-row-${row.address}`)
    expect(button.textContent).toContain('Fixture Server B')
    expect(button.textContent).toContain(row.address)
    expect(button.textContent).toContain('baseq2')
    expect(button.textContent).toContain('2/8')
    expect(button.textContent).toContain('q2dm1')
    expect(button.textContent).toContain('42 ms')
  })

  it('renders dashes, never 0 or blank, for every unknown field', () => {
    renderRow(BASE_ROW)

    const button = screen.getByTestId(`servers-row-${BASE_ROW.address}`)
    // name unknown -> address alone as the name, no separate address line
    expect(button.textContent).toContain(BASE_ROW.address)
    expect(button.textContent).toContain('—/—')
    expect(button.textContent).not.toContain('0/0')
  })

  it('shows the password marker exactly when needpass is true (AC2)', () => {
    renderRow({ ...BASE_ROW, status: 'online', needpass: true })
    expect(screen.getByTestId(`servers-row-password-${BASE_ROW.address}`)).toBeTruthy()
  })

  it('does not show the password marker when needpass is false', () => {
    renderRow({ ...BASE_ROW, status: 'online', needpass: false })
    expect(screen.queryByTestId(`servers-row-password-${BASE_ROW.address}`)).toBeNull()
  })

  it('does not show the password marker when needpass is undefined', () => {
    renderRow({ ...BASE_ROW, status: 'online' })
    expect(screen.queryByTestId(`servers-row-password-${BASE_ROW.address}`)).toBeNull()
  })

  it.each([
    ['ctf', 'CTF'],
    ['team', 'Team'],
    ['deathmatch', 'Deathmatch'],
    ['coop', 'Co-op'],
    ['single', 'Single player'],
  ] as const)('shows the %s gamemode marker with its label (AC3)', (mode, label) => {
    renderRow({ ...BASE_ROW, status: 'online', gamemode: mode })
    const badge = screen.getByTestId(`servers-row-gamemode-${BASE_ROW.address}`)
    expect(badge.textContent).toBe(label)
  })

  it('shows no gamemode marker when gamemode is undefined', () => {
    renderRow({ ...BASE_ROW, status: 'online' })
    expect(screen.queryByTestId(`servers-row-gamemode-${BASE_ROW.address}`)).toBeNull()
  })

  it('shows the favourite marker on a placeholder (pending) row (AC4)', () => {
    renderRow({ ...BASE_ROW, status: 'pending', favourite: true })
    expect(screen.getByTestId(`servers-row-favourite-${BASE_ROW.address}`)).toBeTruthy()
    expect(screen.getByTestId(`servers-row-pending-${BASE_ROW.address}`)).toBeTruthy()
  })

  it('shows no favourite marker when favourite is false', () => {
    renderRow({ ...BASE_ROW, status: 'online', favourite: false })
    expect(screen.queryByTestId(`servers-row-favourite-${BASE_ROW.address}`)).toBeNull()
  })

  it('a stale row keeps its last known values visible (AC5)', () => {
    const row: ServerListRow = {
      ...BASE_ROW,
      status: 'stale',
      name: 'Fixture Server D',
      mod: 'baseq2',
      maxclients: 8,
      players: 3,
      map: 'q2dm3',
      rttMs: 77,
    }
    renderRow(row)

    const button = screen.getByTestId(`servers-row-${row.address}`)
    expect(screen.getByTestId(`servers-row-stale-${row.address}`)).toBeTruthy()
    expect(button.textContent).toContain('Fixture Server D')
    expect(button.textContent).toContain('baseq2')
    expect(button.textContent).toContain('3/8')
    expect(button.textContent).toContain('q2dm3')
    expect(button.textContent).toContain('77 ms')
  })

  it('shows the waiting marker exactly with one known player (AC6)', () => {
    renderRow({ ...BASE_ROW, status: 'online', players: 1 })
    expect(screen.getByTestId(`servers-row-waiting-${BASE_ROW.address}`)).toBeTruthy()
  })

  it('shows no waiting marker with two known players', () => {
    renderRow({ ...BASE_ROW, status: 'online', players: 2 })
    expect(screen.queryByTestId(`servers-row-waiting-${BASE_ROW.address}`)).toBeNull()
  })

  it('shows no waiting marker with zero known players', () => {
    renderRow({ ...BASE_ROW, status: 'online', players: 0 })
    expect(screen.queryByTestId(`servers-row-waiting-${BASE_ROW.address}`)).toBeNull()
  })

  it('a field-less pending row renders the address, dashes and the pending marker (AC7)', () => {
    renderRow(BASE_ROW)

    const button = screen.getByTestId(`servers-row-${BASE_ROW.address}`)
    expect(button.textContent).toContain(BASE_ROW.address)
    expect(button.textContent).toContain('—/—')
    expect(button.textContent).toContain('—')
    expect(screen.getByTestId(`servers-row-pending-${BASE_ROW.address}`)).toBeTruthy()
  })

  it('toggles aria-pressed/data-selected and calls onSelect with the address on click', () => {
    let selectedAddress: string | undefined
    render(
      createElement(ServerRow, {
        row: BASE_ROW,
        selected: true,
        onSelect: (address: string) => {
          selectedAddress = address
        },
      }),
    )
    const button = screen.getByTestId(`servers-row-${BASE_ROW.address}`)
    expect(button.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(button)
    expect(selectedAddress).toBe(BASE_ROW.address)
  })
})
