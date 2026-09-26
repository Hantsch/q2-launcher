// @vitest-environment jsdom
import { createElement } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type {
  MasterSource,
  ScanSnapshot,
  ServerDetail,
  ServerListEntry,
  ServersScanState,
  WatchlistSnapshot,
} from '@shared/modules/servers'
import type { ServerListSort } from '@shared/servers/list-sort'
import { initI18n } from '../../i18n'
import { useLauncher } from '../../store/useLauncher'

/**
 * Story 132 D3. Mirrors `ServersView.test.tsx`'s own conventions (module-scoped `window.q2` stub,
 * `./client` stubbed directly) plus `FeatureGate.test.tsx`'s convention of seeding the real
 * Zustand store's `unlockedFeatures` rather than mocking `useFeatureUnlocked` itself.
 * `JoinServerButton` is stubbed so this file only asserts *that* it's called with the right
 * props, never re-testing 125's own join flow.
 */

vi.hoisted(() => {
  const invoke = vi.fn(() => Promise.resolve(undefined))
  const on = vi.fn(() => () => {})
  ;(globalThis as unknown as { q2: unknown }).q2 = { invoke, on }
})

const {
  readScanMock,
  setScanViewActiveMock,
  onScanChangedMock,
  onScanServerMock,
  listMasterSourcesMock,
  getListSortMock,
  setListSortMock,
  readServerDetailMock,
  readWatchlistMock,
  onWatchlistChangedMock,
  addWatchlistEntryMock,
  updateWatchlistEntryMock,
  removeWatchlistEntryMock,
  recheckWatchlistEntryMock,
} = vi.hoisted(() => ({
  readScanMock: vi.fn(),
  setScanViewActiveMock: vi.fn(async () => ({ ok: true as const, value: undefined })),
  onScanChangedMock: vi.fn(),
  onScanServerMock: vi.fn(),
  listMasterSourcesMock: vi.fn(async () => ({ ok: true as const, value: [] as MasterSource[] })),
  getListSortMock: vi.fn(async () => ({ ok: true as const, value: null as ServerListSort | null })),
  setListSortMock: vi.fn(async (sort: ServerListSort | null) => ({ ok: true as const, value: sort })),
  readServerDetailMock: vi.fn(async () => ({ ok: true as const, value: null as ServerDetail | null })),
  readWatchlistMock: vi.fn(async () => ({
    ok: true as const,
    value: { asOf: null, entries: [] } as WatchlistSnapshot,
  })),
  onWatchlistChangedMock: vi.fn(() => () => {}),
  addWatchlistEntryMock: vi.fn(),
  updateWatchlistEntryMock: vi.fn(),
  removeWatchlistEntryMock: vi.fn(),
  recheckWatchlistEntryMock: vi.fn(),
}))

vi.mock('./client', () => ({
  readScan: readScanMock,
  startScan: vi.fn(async () => ({ ok: true as const, value: { ok: true as const } })),
  setScanViewActive: setScanViewActiveMock,
  onScanChanged: onScanChangedMock,
  onScanServer: onScanServerMock,
  listMasterSources: listMasterSourcesMock,
  getListSort: getListSortMock,
  setListSort: setListSortMock,
  readServerDetail: readServerDetailMock,
  readWatchlist: readWatchlistMock,
  onWatchlistChanged: onWatchlistChangedMock,
  addWatchlistEntry: addWatchlistEntryMock,
  updateWatchlistEntry: updateWatchlistEntryMock,
  removeWatchlistEntry: removeWatchlistEntryMock,
  recheckWatchlistEntry: recheckWatchlistEntryMock,
}))

const joinServerButtonMock = vi.fn((_props: { row: unknown }) =>
  createElement('div', { 'data-testid': 'stub-join' }),
)

vi.mock('./join/JoinServerButton', () => ({
  JoinServerButton: (props: { row: unknown }) => joinServerButtonMock(props),
}))

let ServersView: typeof import('./ServersView').ServersView

beforeAll(async () => {
  await initI18n('en')
  ;({ ServersView } = await import('./ServersView'))
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  useLauncher.setState({ unlockedFeatures: [] })
  onScanChangedMock.mockImplementation(() => () => {})
  onScanServerMock.mockImplementation(() => () => {})
  onWatchlistChangedMock.mockImplementation(() => () => {})
  listMasterSourcesMock.mockImplementation(async () => ({
    ok: true as const,
    value: [] as MasterSource[],
  }))
  getListSortMock.mockImplementation(async () => ({
    ok: true as const,
    value: null as ServerListSort | null,
  }))
  setListSortMock.mockImplementation(async (sort: ServerListSort | null) => ({
    ok: true as const,
    value: sort,
  }))
  readServerDetailMock.mockImplementation(async () => ({ ok: true as const, value: null }))
  readWatchlistMock.mockImplementation(async () => ({
    ok: true as const,
    value: { asOf: null, entries: [] } as WatchlistSnapshot,
  }))
})

const BASE_STATE: ServersScanState = {
  running: false,
  phase: 'idle',
  stage1Done: 0,
  stage1Total: 0,
  stage2Done: 0,
  stage2Total: 0,
  sourceFailures: [],
  startedAt: null,
  finishedAt: null,
  blockedReason: null,
  scope: null,
}

function snapshot(overrides: {
  state?: Partial<ServersScanState>
  entries?: ServerListEntry[]
}): ScanSnapshot {
  return {
    state: { ...BASE_STATE, ...overrides.state },
    entries: (overrides.entries ?? []).map((entry) => ({ ...entry, favourite: false })),
  }
}

async function renderView(initial: ScanSnapshot): Promise<void> {
  readScanMock.mockResolvedValue({ ok: true, value: initial })
  onScanChangedMock.mockImplementation(() => () => {})
  onScanServerMock.mockImplementation(() => () => {})
  onWatchlistChangedMock.mockImplementation(() => () => {})

  render(createElement(ServersView))

  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('ServersView - watchlist tab, locked (story 132 D3)', () => {
  it('has no tab strip and no watchlist text, and renders its pre-story list content', async () => {
    useLauncher.setState({ unlockedFeatures: [] })

    await renderView(
      snapshot({
        entries: [{ address: '1.2.3.4:27910', origins: ['manual'], status: 'online', lastSeenAt: 'x' }],
      }),
    )

    expect(screen.queryByTestId('servers-tab-strip')).toBeNull()
    expect(screen.queryByTestId('servers-tab-list')).toBeNull()
    expect(screen.queryByTestId('servers-tab-watchlist')).toBeNull()
    expect(screen.queryByText('Watchlist')).toBeNull()

    await screen.findByTestId('servers-row-1.2.3.4:27910')
  })
})

describe('ServersView - watchlist tab, unlocked (story 132 D3)', () => {
  it('carries the experimental badge on the watchlist tab', async () => {
    useLauncher.setState({ unlockedFeatures: ['watchlist'] })

    await renderView(snapshot({}))

    await screen.findByTestId('servers-tab-strip')
    fireEvent.click(screen.getByTestId('servers-tab-watchlist'))

    expect(screen.getAllByTestId('experimental-badge')).toHaveLength(1)
    await screen.findByTestId('servers-watchlist')
  })

  it("a match's Join is 125's JoinServerButton for that server's row", async () => {
    useLauncher.setState({ unlockedFeatures: ['watchlist'] })

    const row: ServerListEntry = {
      address: '5.6.7.8:27910',
      origins: ['manual'],
      status: 'online',
      lastSeenAt: 'x',
    }

    readWatchlistMock.mockResolvedValue({
      ok: true,
      value: {
        asOf: 'x',
        entries: [
          {
            entry: { id: 'e1', name: 'Alice', mode: 'exact', tooSlow: false },
            state: 'found',
            recheck: null,
            matches: [
              {
                address: '5.6.7.8:27910',
                playerName: 'Alice',
                score: 3,
                ping: 40,
                seenAt: 'x',
              },
            ],
          },
        ],
      } as WatchlistSnapshot,
    })

    await renderView(snapshot({ entries: [row] }))

    fireEvent.click(screen.getByTestId('servers-tab-watchlist'))
    await screen.findByTestId('servers-watchlist-match-e1-5.6.7.8:27910')

    expect(joinServerButtonMock).toHaveBeenCalledWith(
      expect.objectContaining({ row: expect.objectContaining({ address: '5.6.7.8:27910' }) }),
    )
  })

  it("open-detail opens that server's detail beside the watchlist, and toggles it closed", async () => {
    useLauncher.setState({ unlockedFeatures: ['watchlist'] })

    const row: ServerListEntry = {
      address: '9.9.9.9:27910',
      origins: ['manual'],
      status: 'online',
      lastSeenAt: 'x',
    }

    readWatchlistMock.mockResolvedValue({
      ok: true,
      value: {
        asOf: 'x',
        entries: [
          {
            entry: { id: 'e2', name: 'Bob', mode: 'exact', tooSlow: false },
            state: 'found',
            recheck: null,
            matches: [
              {
                address: '9.9.9.9:27910',
                playerName: 'Bob',
                score: 1,
                ping: 20,
                seenAt: 'x',
              },
            ],
          },
        ],
      } as WatchlistSnapshot,
    })

    readServerDetailMock.mockResolvedValue({
      ok: true,
      value: {
        row: { ...row, favourite: false },
        serverinfo: null,
      },
    })

    await renderView(snapshot({ entries: [row] }))

    fireEvent.click(screen.getByTestId('servers-tab-watchlist'))
    const openDetail = await screen.findByTestId('servers-watchlist-open-detail-9.9.9.9:27910')

    await act(async () => {
      fireEvent.click(openDetail)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(screen.getByTestId('servers-watchlist')).toBeTruthy()
    expect(screen.getByTestId('servers-tab-watchlist').className).toContain('bg-flame-900/30')
    await screen.findByTestId('servers-detail')
    expect(readServerDetailMock).toHaveBeenCalledWith('9.9.9.9:27910')
    expect(openDetail.getAttribute('aria-pressed')).toBe('true')
    expect(
      screen.getByTestId('servers-watchlist-match-e2-9.9.9.9:27910').getAttribute('data-selected'),
    ).toBe('true')

    fireEvent.click(openDetail)
    expect(screen.queryByTestId('servers-detail')).toBeNull()
  })
})
