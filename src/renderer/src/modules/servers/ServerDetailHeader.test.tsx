// @vitest-environment jsdom
import { createElement } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { ServerDetail } from '@shared/modules/servers'
import { initI18n } from '../../i18n'

const { addFavouriteMock, removeFavouriteMock } = vi.hoisted(() => ({
  addFavouriteMock: vi.fn(async () => ({ ok: true as const, value: [] })),
  removeFavouriteMock: vi.fn(async () => ({ ok: true as const, value: [] })),
}))

vi.mock('./client', () => ({
  addFavourite: addFavouriteMock,
  removeFavourite: removeFavouriteMock,
}))

let ServerDetailHeader: typeof import('./ServerDetailHeader').ServerDetailHeader

// Story 125 D5: the header now renders `JoinServerButton`, which reads the real `useLauncher`
// store - `play()` calls through the preload bridge, so a minimal `window.q2` stub is needed here
// the same way `JoinServerButton.test.tsx` provides one, even though this file never presses Join.
beforeAll(async () => {
  ;(globalThis as unknown as { q2: unknown }).q2 = {
    invoke: () => Promise.resolve(undefined),
    on: () => () => {},
  }
  await initI18n('en')
  ;({ ServerDetailHeader } = await import('./ServerDetailHeader'))
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderHeader(detail: ServerDetail, onFavouriteChanged: () => void = () => {}) {
  render(
    createElement(ServerDetailHeader, {
      detail,
      onRefresh: () => {},
      refreshDisabled: false,
      refreshing: false,
      onFavouriteChanged,
    }),
  )
}

function favouriteDetail(favourite: boolean): ServerDetail {
  return {
    row: { address: '127.0.0.1:27910', origins: ['manual'], status: 'online', lastSeenAt: 'x', favourite },
    serverinfo: null,
  }
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

  it('renders the Join button (story 125 D5)', () => {
    const detail: ServerDetail = {
      row: {
        address: '127.0.0.1:27910',
        origins: ['manual'],
        status: 'online',
        lastSeenAt: 'x',
        favourite: false,
        name: 'Fixture Server A',
      },
      serverinfo: null,
    }
    renderHeader(detail)

    const wrapper = screen.getByTestId('servers-detail-join')
    expect(wrapper).toBeTruthy()
    expect(wrapper.querySelector('[data-testid="servers-join"]')).toBeTruthy()
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

  it('the favourite toggle adds a non-favourite and reports the change', async () => {
    const onFavouriteChanged = vi.fn()
    renderHeader(favouriteDetail(false), onFavouriteChanged)

    const toggle = screen.getByTestId('servers-detail-favourite')
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    await act(async () => {
      fireEvent.click(toggle)
    })

    expect(addFavouriteMock).toHaveBeenCalledWith('127.0.0.1:27910')
    expect(removeFavouriteMock).not.toHaveBeenCalled()
    expect(onFavouriteChanged).toHaveBeenCalledTimes(1)
  })

  it('the favourite toggle removes an existing favourite', async () => {
    renderHeader(favouriteDetail(true))

    const toggle = screen.getByTestId('servers-detail-favourite')
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    await act(async () => {
      fireEvent.click(toggle)
    })

    expect(removeFavouriteMock).toHaveBeenCalledWith('127.0.0.1:27910')
  })
})
