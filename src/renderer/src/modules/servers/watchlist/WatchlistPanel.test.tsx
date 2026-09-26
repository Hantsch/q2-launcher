// @vitest-environment jsdom
import { createElement } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { SERVERS_WATCHLIST_HANDLERS, type WatchlistSnapshot } from '@shared/modules/servers'
import { initI18n } from '../../../i18n'
import type { WatchlistPanel as WatchlistPanelType } from './WatchlistPanel'

/**
 * Story 132 D2. Same module-scope `window.q2` stubbing idiom as `ServersSettingsSection.test.tsx`
 * (and `useWatchlist.test.tsx`): the panel imports `useWatchlist`, which imports `client.ts`, which
 * reaches `window.q2` at import time.
 */
const invokeMock = vi.fn()
type Listener = (payload: unknown) => void
let listeners: Listener[] = []
const onMock = vi.fn((_channel: string, listener: Listener) => {
  listeners.push(listener)
  return () => {
    listeners = listeners.filter((l) => l !== listener)
  }
})

;(globalThis as unknown as { q2: unknown }).q2 = { invoke: invokeMock, on: onMock }

let WatchlistPanel: typeof WatchlistPanelType

beforeAll(async () => {
  await initI18n('en')
  ;({ WatchlistPanel } = await import('./WatchlistPanel'))
})

beforeEach(() => {
  invokeMock.mockReset()
  onMock.mockClear()
  listeners = []
})

afterEach(() => {
  cleanup()
})

function emit(snapshot: WatchlistSnapshot): void {
  for (const listener of listeners) {
    listener({ moduleId: 'servers', type: 'watchlist.changed', payload: snapshot })
  }
}

function mockRead(snapshot: WatchlistSnapshot): void {
  invokeMock.mockImplementation((_channel: string, args: { type: string }) => {
    if (args?.type === SERVERS_WATCHLIST_HANDLERS.read) {
      return Promise.resolve({ ok: true, value: snapshot })
    }
    return Promise.resolve({ ok: true, value: snapshot })
  })
}

async function renderPanel(snapshot: WatchlistSnapshot): Promise<void> {
  mockRead(snapshot)
  render(createElement(WatchlistPanel))
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('WatchlistPanel (story 132 D2)', () => {
  it('each row shows its name and offline or every match with score and ping', async () => {
    const snapshot: WatchlistSnapshot = {
      asOf: '2026-01-01T00:00:00.000Z',
      entries: [
        { entry: { id: '1', name: 'Alice', mode: 'exact', tooSlow: false }, state: 'offline', recheck: null },
        {
          entry: { id: '2', name: 'Bob', mode: 'substring', tooSlow: false },
          state: 'found',
          recheck: null,
          matches: [
            {
              address: '1.2.3.4:27910',
              serverName: 'Some Server',
              playerName: 'Bob the Builder',
              score: 12,
              ping: 45,
              seenAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        },
      ],
    }

    await renderPanel(snapshot)

    const row1 = screen.getByTestId('servers-watchlist-row-1')
    expect(row1.textContent).toContain('Alice')
    expect(row1.getAttribute('data-state')).toBe('offline')

    const row2 = screen.getByTestId('servers-watchlist-row-2')
    expect(row2.textContent).toContain('Bob')
    const match = screen.getByTestId('servers-watchlist-match-2-1.2.3.4:27910')
    expect(match.textContent).toContain('Bob the Builder')
    expect(match.textContent).toContain('12')
    expect(match.textContent).toContain('45')
  })

  it('each state states when its data is from', async () => {
    const snapshot: WatchlistSnapshot = {
      asOf: '2026-01-01T00:00:00.000Z',
      entries: [
        { entry: { id: '1', name: 'Alice', mode: 'exact', tooSlow: false }, state: 'offline', recheck: null },
        {
          entry: { id: '2', name: 'Carl', mode: 'exact', tooSlow: false },
          state: 'left',
          address: '5.6.7.8:27910',
          checkedAt: '2026-01-01T00:10:00.000Z',
          reasonKey: 'servers.watchlist.left.needsFullScan',
          recheck: null,
        },
      ],
    }

    await renderPanel(snapshot)

    const row1 = screen.getByTestId('servers-watchlist-row-1')
    expect(row1.textContent).toMatch(/ago|now/)

    const row2 = screen.getByTestId('servers-watchlist-row-2')
    expect(row2.textContent).toContain('run a full scan')
    expect(row2.textContent).toMatch(/checked/i)
  })

  it('a score-0 ping-0 match renders like any other and nothing in a row mentions spectating', async () => {
    const snapshot: WatchlistSnapshot = {
      asOf: '2026-01-01T00:00:00.000Z',
      entries: [
        {
          entry: { id: '3', name: 'Dana', mode: 'exact', tooSlow: false },
          state: 'found',
          recheck: null,
          matches: [
            {
              address: '9.9.9.9:27910',
              playerName: 'Dana',
              score: 0,
              ping: 0,
              seenAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        },
      ],
    }

    await renderPanel(snapshot)

    const row = screen.getByTestId('servers-watchlist-row-3')
    const match = screen.getByTestId('servers-watchlist-match-3-9.9.9.9:27910')
    expect(match.textContent).toContain('Dana')

    expect(row.outerHTML).not.toMatch(/spectat/i)
  })

  it('re-check shows pending, then the updated match or the left-the-server reason', async () => {
    const found: WatchlistSnapshot = {
      asOf: '2026-01-01T00:00:00.000Z',
      entries: [
        {
          entry: { id: '4', name: 'Eve', mode: 'exact', tooSlow: false },
          state: 'found',
          recheck: 'pending',
          matches: [
            {
              address: '1.1.1.1:27910',
              playerName: 'Eve',
              score: 3,
              ping: 20,
              seenAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        },
      ],
    }

    await renderPanel(found)

    const row = screen.getByTestId('servers-watchlist-row-4')
    expect(row.textContent).toMatch(/checking/i)
    // recheck button disabled while pending
    expect((screen.getByTestId('servers-watchlist-recheck-4') as HTMLButtonElement).disabled).toBe(true)

    const left: WatchlistSnapshot = {
      asOf: '2026-01-01T00:15:00.000Z',
      entries: [
        {
          entry: { id: '4', name: 'Eve', mode: 'exact', tooSlow: false },
          state: 'left',
          address: '1.1.1.1:27910',
          checkedAt: '2026-01-01T00:15:00.000Z',
          reasonKey: 'servers.watchlist.left.needsFullScan',
          recheck: null,
        },
      ],
    }

    act(() => {
      emit(left)
    })

    const updatedRow = screen.getByTestId('servers-watchlist-row-4')
    expect(updatedRow.getAttribute('data-state')).toBe('left')
    expect(updatedRow.textContent).toContain('run a full scan')
  })

  it('a refused pattern shows its reason at the input and a too-slow entry says so on its row', async () => {
    const snapshot: WatchlistSnapshot = {
      asOf: null,
      entries: [
        {
          entry: { id: '5', name: 'Frank(', mode: 'regex', tooSlow: true },
          state: 'too-slow',
          recheck: null,
        },
      ],
    }

    await renderPanel(snapshot)

    const row = screen.getByTestId('servers-watchlist-row-5')
    expect(row.textContent).toMatch(/too slow/i)

    // no server data yet, since asOf is null and there's no offline row here - verify add refusal instead
    invokeMock.mockImplementation((_channel: string, args: { type: string }) => {
      if (args?.type === SERVERS_WATCHLIST_HANDLERS.add) {
        return Promise.resolve({ ok: true, value: { ok: false, reasonKey: 'servers.watchlist.error.empty' } })
      }
      if (args?.type === SERVERS_WATCHLIST_HANDLERS.read) {
        return Promise.resolve({ ok: true, value: snapshot })
      }
      return Promise.resolve({ ok: true, value: snapshot })
    })

    fireEvent.change(screen.getByTestId('servers-watchlist-add-name'), { target: { value: 'x' } })
    fireEvent.click(screen.getByTestId('servers-watchlist-add-submit'))

    await waitFor(() => expect(screen.getByTestId('servers-watchlist-add-error')).toBeTruthy())
    expect(screen.getByTestId('servers-watchlist-add-error').textContent).toContain('cannot be empty')
  })

  it('edit and remove call the watchlist handlers', async () => {
    const snapshot: WatchlistSnapshot = {
      asOf: null,
      entries: [
        { entry: { id: '6', name: 'Gina', mode: 'exact', tooSlow: false }, state: 'offline', recheck: null },
      ],
    }

    await renderPanel(snapshot)

    fireEvent.click(screen.getByTestId('servers-watchlist-remove-6'))
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith('module:invoke', {
        moduleId: 'servers',
        type: SERVERS_WATCHLIST_HANDLERS.remove,
        payload: { id: '6' },
      }),
    )

    fireEvent.click(screen.getByTestId('servers-watchlist-edit-6'))
    fireEvent.change(screen.getByTestId('servers-watchlist-edit-name-6'), {
      target: { value: 'Gina2' },
    })
    fireEvent.click(screen.getByTestId('servers-watchlist-edit-save-6'))

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith('module:invoke', {
        moduleId: 'servers',
        type: SERVERS_WATCHLIST_HANDLERS.update,
        payload: { id: '6', name: 'Gina2', mode: 'exact' },
      }),
    )
  })
})
