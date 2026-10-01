// @vitest-environment jsdom
import { createElement, Fragment } from 'react'
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
import { DEFAULT_SETTINGS, type Installation } from '@shared/types'
import { initI18n } from '../../i18n'
import { usePrimaryActionStore } from '../../lib/primary-action'
import { useLauncher } from '../../store/useLauncher'
import { ActionBar } from '../../components/shell/ActionBar'

/**
 * Story 181 D2. The Servers tab publishes "Join" into the action bar; these tests render the real
 * view next to the real `ActionBar` and judge what the big button shows and does.
 */

vi.hoisted(() => {
  const invoke = vi.fn(() => Promise.resolve({ ok: true }))
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
} = vi.hoisted(() => ({
  readScanMock: vi.fn(),
  setScanViewActiveMock: vi.fn(async () => ({ ok: true as const, value: undefined })),
  onScanChangedMock: vi.fn(),
  onScanServerMock: vi.fn(),
  listMasterSourcesMock: vi.fn(async () => ({ ok: true as const, value: [] as MasterSource[] })),
  getListSortMock: vi.fn(async () => ({ ok: true as const, value: null as ServerListSort | null })),
  setListSortMock: vi.fn(async (sort: ServerListSort | null) => ({
    ok: true as const,
    value: sort,
  })),
  readServerDetailMock: vi.fn(async () => ({
    ok: true as const,
    value: null as ServerDetail | null,
  })),
  readWatchlistMock: vi.fn(async () => ({
    ok: true as const,
    value: { asOf: null, entries: [] } as WatchlistSnapshot,
  })),
  onWatchlistChangedMock: vi.fn(() => () => {}),
}))

vi.mock('./client', () => ({
  listQuickFilters: async () => ({ ok: true as const, value: [] }),
  readScan: readScanMock,
  startScan: vi.fn(async () => ({ ok: true as const, value: { ok: true as const } })),
  setScanViewActive: setScanViewActiveMock,
  setMode: async () => ({ ok: true as const, value: undefined }),
  onScanChanged: onScanChangedMock,
  onScanServer: onScanServerMock,
  listMasterSources: listMasterSourcesMock,
  getListSort: getListSortMock,
  setListSort: setListSortMock,
  readServerDetail: readServerDetailMock,
  readWatchlist: readWatchlistMock,
  onWatchlistChanged: onWatchlistChangedMock,
  addWatchlistEntry: vi.fn(),
  updateWatchlistEntry: vi.fn(),
  removeWatchlistEntry: vi.fn(),
  recheckWatchlistEntry: vi.fn(),
}))

let ServersView: typeof import('./ServersView').ServersView

beforeAll(async () => {
  await initI18n('en')
  ;({ ServersView } = await import('./ServersView'))
})

const playMock = vi.fn(async () => {})

function makeInstallation(): Installation {
  return {
    id: 'inst-1',
    name: 'Test Install',
    rootPath: 'C:\\Games\\Q2',
    engineKind: 'r1q2',
    launchArgs: [],
    activeGameDir: '',
    source: 'manual',
    status: 'ok',
    checks: [],
    gameDirs: [],
    favorite: false,
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    totalPlaytimeSeconds: 0,
  }
}

function seedLauncher(withInstallation: boolean, unlocked: string[] = []): void {
  useLauncher.setState({
    route: '/servers',
    unlockedFeatures: unlocked,
    play: playMock,
    launch: { phase: 'idle', installationId: null },
    jobs: [],
    installations: withInstallation ? [makeInstallation()] : [],
    settings: {
      ...DEFAULT_SETTINGS,
      activeInstallationId: withInstallation ? 'inst-1' : null,
    },
  })
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  usePrimaryActionStore.setState({ owner: null, action: null })
  onScanChangedMock.mockImplementation(() => () => {})
  onScanServerMock.mockImplementation(() => () => {})
  onWatchlistChangedMock.mockImplementation(() => () => {})
  readServerDetailMock.mockImplementation(async () => ({ ok: true as const, value: null }))
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
  mode: 'online',
}

const ROW_A = '1.2.3.4:27910'
const ROW_B = '5.6.7.8:27910'

function entry(address: string): ServerListEntry {
  return { address, origins: ['manual'], status: 'online', lastSeenAt: 'x' }
}

async function renderViewWithBar(entries: ServerListEntry[]): Promise<void> {
  const snapshot: ScanSnapshot = {
    state: BASE_STATE,
    entries: entries.map((e) => ({ ...e, favourite: false })),
    mode: 'online',
    lan: { lastFinishedAt: null, failureKey: null },
  }
  readScanMock.mockResolvedValue({ ok: true, value: snapshot })
  onScanChangedMock.mockImplementation(() => () => {})
  onScanServerMock.mockImplementation(() => () => {})
  render(createElement(Fragment, null, createElement(ServersView), createElement(ActionBar)))
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

const joinButton = (): HTMLElement => screen.getByTestId('actionbar-play')

describe('ServersView - Join in the action bar (story 181 D2)', () => {
  it('no selection contributes a disabled Join', async () => {
    seedLauncher(true)
    await renderViewWithBar([entry(ROW_A)])
    await screen.findByTestId(`servers-row-${ROW_A}`)

    expect(joinButton().textContent).toContain('Join')
    expect(joinButton().hasAttribute('disabled')).toBe(true)
    expect(screen.queryByTestId('actionbar-action-reason')).toBeNull()
  })

  it('a selected server contributes an enabled Join that starts the join flow for that row', async () => {
    seedLauncher(true)
    await renderViewWithBar([entry(ROW_A), entry(ROW_B)])
    fireEvent.click(await screen.findByTestId(`servers-row-${ROW_B}`))

    expect(joinButton().textContent).toContain('Join')
    expect(joinButton().hasAttribute('disabled')).toBe(false)
    fireEvent.click(joinButton())

    expect(playMock).toHaveBeenCalledTimes(1)
    expect(playMock).toHaveBeenCalledWith(undefined, expect.objectContaining({ connect: ROW_B }))
  })

  it("the watchlist tab contributes the detail pane's server, not the list selection", async () => {
    seedLauncher(true, ['watchlist'])
    readWatchlistMock.mockResolvedValue({
      ok: true,
      value: {
        asOf: 'x',
        entries: [
          {
            entry: { id: 'e1', name: 'Alice', mode: 'exact', tooSlow: false },
            state: 'found',
            recheck: null,
            matches: [{ address: ROW_B, playerName: 'Alice', score: 3, ping: 40, seenAt: 'x' }],
          },
        ],
      } as WatchlistSnapshot,
    })
    await renderViewWithBar([entry(ROW_A), entry(ROW_B)])

    // The list selection is A; on the watchlist tab with no detail open, there is no server.
    fireEvent.click(await screen.findByTestId(`servers-row-${ROW_A}`))
    expect(joinButton().hasAttribute('disabled')).toBe(false)
    fireEvent.click(screen.getByTestId('servers-tab-watchlist'))
    await screen.findByTestId(`servers-watchlist-match-e1-${ROW_B}`)
    expect(joinButton().textContent).toContain('Join')
    expect(joinButton().hasAttribute('disabled')).toBe(true)

    // Opening B's details makes B the server; the press joins B, never A.
    fireEvent.click(screen.getByTestId(`servers-watchlist-open-detail-${ROW_B}`))
    expect(joinButton().hasAttribute('disabled')).toBe(false)
    fireEvent.click(joinButton())
    expect(playMock).toHaveBeenCalledTimes(1)
    expect(playMock).toHaveBeenCalledWith(undefined, expect.objectContaining({ connect: ROW_B }))
  })

  it('no active installation contributes a disabled Join with the noInstallation reason', async () => {
    seedLauncher(false)
    await renderViewWithBar([entry(ROW_A)])
    fireEvent.click(await screen.findByTestId(`servers-row-${ROW_A}`))

    expect(joinButton().textContent).toContain('Join')
    expect(joinButton().hasAttribute('disabled')).toBe(true)
    const reason = screen.getByTestId('actionbar-action-reason')
    expect(reason.textContent).toBe('Choose an active installation to join a server.')
    expect(joinButton().getAttribute('aria-describedby')).toBe(reason.id)
    fireEvent.click(joinButton())
    expect(playMock).not.toHaveBeenCalled()
  })
})
