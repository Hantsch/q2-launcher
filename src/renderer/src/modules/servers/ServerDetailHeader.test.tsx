// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { ServerDetail } from '@shared/modules/servers'
import { initI18n } from '../../i18n'

let ServerDetailHeader: typeof import('./ServerDetailHeader').ServerDetailHeader

beforeAll(async () => {
  await initI18n('en')
  ;({ ServerDetailHeader } = await import('./ServerDetailHeader'))
})

afterEach(() => {
  cleanup()
})

function renderHeader(detail: ServerDetail) {
  render(createElement(ServerDetailHeader, { detail }))
}

describe('ServerDetailHeader (story 122 D3)', () => {
  it('shows name, address, mod, map, gamemode, occupancy, ping, password, engine and protocol', () => {
    const detail: ServerDetail = {
      row: {
        address: '127.0.0.1:27910',
        origins: ['manual'],
        status: 'online',
        lastSeenAt: 'x',
        favourite: false,
        name: 'Fixture Server A',
        mod: 'baseq2',
        map: 'q2dm1',
        maxclients: 16,
        players: 3,
        rttMs: 12,
        needpass: true,
        gamemode: 'deathmatch',
      },
      serverinfo: { protocol: '35' },
    }
    renderHeader(detail)

    expect(screen.getByTestId('servers-detail-field-name').textContent).toBe('Fixture Server A')
    expect(screen.getByTestId('servers-detail-field-address').textContent).toBe(
      '127.0.0.1:27910',
    )
    expect(screen.getByTestId('servers-detail-field-mod').textContent).toBe('baseq2')
    expect(screen.getByTestId('servers-detail-field-map').textContent).toBe('q2dm1')
    expect(screen.getByTestId('servers-detail-field-gamemode').textContent).toBe('Deathmatch')
    expect(screen.getByTestId('servers-detail-field-occupancy').textContent).toBe('3/16')
    expect(screen.getByTestId('servers-detail-field-ping').textContent).toBe('12 ms')
    expect(screen.getByTestId('servers-detail-field-password').textContent).toContain('Password')
    expect(screen.getByTestId('servers-detail-field-engine').textContent).toBe('R1Q2')
    expect(screen.getByTestId('servers-detail-field-protocol').textContent).toBe('35')
  })

  it('one malformed field shows a dash and the rest still render', () => {
    const detail: ServerDetail = {
      row: {
        address: '127.0.0.1:27910',
        origins: ['manual'],
        status: 'online',
        lastSeenAt: 'x',
        favourite: false,
        map: 'q2dm1',
        rttMs: Number.NaN,
      },
      serverinfo: { protocol: 'abc' },
    }
    renderHeader(detail)

    // name absent -> address shown instead
    expect(screen.getByTestId('servers-detail-field-name').textContent).toBe('127.0.0.1:27910')
    expect(screen.getByTestId('servers-detail-field-map').textContent).toBe('q2dm1')
    // maxclients absent -> occupancy still renders with a dash on the unknown side
    expect(screen.getByTestId('servers-detail-field-occupancy').textContent).toBe('—/—')
    // rttMs: NaN -> dash, not "NaN ms"
    expect(screen.getByTestId('servers-detail-field-ping').textContent).toBe('—')
    // protocol: 'abc' -> dash for both protocol and engine
    expect(screen.getByTestId('servers-detail-field-protocol').textContent).toBe('—')
    expect(screen.getByTestId('servers-detail-field-engine').textContent).toBe('—')
  })
})
