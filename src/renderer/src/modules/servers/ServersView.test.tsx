// @vitest-environment jsdom
import { createElement } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type {
  MasterSource,
  ScanSnapshot,
  ServerDetail,
  ServerListEntry,
  ServersScanSettings,
  ServersScanState,
} from '@shared/modules/servers'
import { sortServerRows, type ServerListSort } from '@shared/servers/list-sort'
import { initI18n } from '../../i18n'
import { mockClient } from '../../test-support/mock-client'

/**
 * Story 116 D5. Mirrors `DownloadsView.test.tsx`'s convention: the module's own typed client
 * (`./client`) is stubbed directly via `vi.mock`, rather than going through `window.q2`'s
 * `invoke`/`on` plumbing - simpler, and this view's logic is entirely about what it does with
 * `readScan()`'s resolved value and `onScanChanged()`'s pushes, not about the transport itself.
 *
 * Story 121 D1: `ServersView` now also reads `useLauncher` (for `setRoute`/`ROUTE_SETTINGS`,
 * mirroring `UpdatePopover.tsx`'s `goToAbout`) - `window.q2` is resolved at *module* scope by
 * `lib/bridge.ts`, so the same bridge stub `UpdatePopover.test.tsx`/`useLauncher.update.test.ts`
 * use must exist before the store (and anything importing it, including `ServersView`) is
 * imported.
 */
vi.hoisted(() => {
  const invoke = vi.fn(() => Promise.resolve(undefined))
  const on = vi.fn(() => () => {})
  ;(globalThis as unknown as { q2: unknown }).q2 = { invoke, on }
})

const {
  readScanMock,
  startScanMock,
  setScanViewActiveMock,
  onScanChangedMock,
  onScanServerMock,
  listMasterSourcesMock,
  getListSortMock,
  setListSortMock,
  readServerDetailMock,
  setModeMock,
  getScanSettingsMock,
  startJoinMock,
} = vi.hoisted(() => ({
  getScanSettingsMock: vi.fn(async () => ({
    ok: true as const,
    value: { doubleClickJoins: true } as ServersScanSettings,
  })),
  startJoinMock: vi.fn(),
  readScanMock: vi.fn(),
  startScanMock: vi.fn(async () => ({ ok: true as const, value: { ok: true as const } })),
  setScanViewActiveMock: vi.fn(async () => ({ ok: true as const, value: undefined })),
  onScanChangedMock: vi.fn(),
  onScanServerMock: vi.fn(),
  listMasterSourcesMock: vi.fn(async () => ({ ok: true as const, value: [] as MasterSource[] })),
  getListSortMock: vi.fn(async () => ({ ok: true as const, value: null as ServerListSort | null })),
  setListSortMock: vi.fn(async (sort: ServerListSort | null) => ({
    ok: true as const,
    value: sort,
  })),
  setModeMock: vi.fn(async () => ({ ok: true as const, value: undefined })),
  readServerDetailMock: vi.fn(async () => ({
    ok: true as const,
    value: null as ServerDetail | null,
  })),
}))

vi.mock('./client', (importOriginal) =>
  mockClient<typeof import('./client')>(importOriginal, {
    listQuickFilters: async () => ({ ok: true as const, value: [] }),
    readScan: readScanMock,
    startScan: startScanMock,
    setScanViewActive: setScanViewActiveMock,
    onScanChanged: onScanChangedMock,
    onScanServer: onScanServerMock,
    listMasterSources: listMasterSourcesMock,
    getListSort: getListSortMock,
    setListSort: setListSortMock,
    readServerDetail: readServerDetailMock,
    setMode: setModeMock,
    getScanSettings: getScanSettingsMock,
  }),
)

vi.mock('./join/useJoinFlow', () => ({
  useJoinFlow: () => ({ start: startJoinMock, addressError: null, dialogs: null }),
}))

vi.mock('@shared/servers/list-sort', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shared/servers/list-sort')>()
  return { ...actual, sortServerRows: vi.fn(actual.sortServerRows) }
})

let ServersView: typeof import('./ServersView').ServersView

beforeAll(async () => {
  await initI18n('en')
  ;({ ServersView } = await import('./ServersView'))
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  onScanChangedMock.mockImplementation(() => () => {})
  onScanServerMock.mockImplementation(() => () => {})
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
  getScanSettingsMock.mockImplementation(async () => ({
    ok: true as const,
    value: { doubleClickJoins: true } as ServersScanSettings,
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
  mode: 'online',
}

function snapshot(overrides: {
  state?: Partial<ServersScanState>
  entries?: ServerListEntry[]
}): ScanSnapshot {
  return {
    state: { ...BASE_STATE, ...overrides.state },
    // `favourite` is not this test file's concern - always `false` here so the fixture entries
    // (still written as plain `ServerListEntry`s) satisfy `ScanSnapshot.entries`'s `ServerListRow[]`.
    entries: (overrides.entries ?? []).map((entry) => ({ ...entry, favourite: false })),
    mode: 'online',
    lan: { lastFinishedAt: null, failureKey: null },
  }
}

const SELECTED_ENTRY: ServerListEntry = {
  address: '1.2.3.4:27910',
  origins: ['manual'],
  status: 'online',
  lastSeenAt: 'x',
}

/** Opens the mod multi-select if closed, then toggles one option by name. */
function toggleMod(name: string): void {
  const trigger = screen.getByTestId('servers-filter-mod')
  if (trigger.getAttribute('aria-expanded') !== 'true') fireEvent.click(trigger)
  const option = screen
    .getAllByTestId('servers-filter-mod-option')
    .find((el) => el.textContent === name)
  if (!option) throw new Error(`no mod option ${name}`)
  fireEvent.click(option)
}

/** Waits until the settings query has really resolved, so the view no longer runs on its default. */
async function settingsLoaded(): Promise<void> {
  await waitFor(() => expect(getScanSettingsMock).toHaveBeenCalled())
  await act(async () => {
    await Promise.all(getScanSettingsMock.mock.results.map((result) => result.value))
  })
}

/** Renders the view over `entries` with (or without) an active installation, settings loaded. */
async function renderWithInstallation(
  entries: ServerListEntry[],
  { installed = true }: { installed?: boolean } = {},
): Promise<void> {
  const { useLauncher } = await import('../../store/useLauncher')
  useLauncher.setState((state) => ({
    settings: { ...state.settings, activeInstallationId: installed ? 'inst-1' : null },
    installations: installed ? [{ id: 'inst-1' } as never] : [],
  }))
  await renderView(snapshot({ entries }))
  await screen.findByTestId(`servers-row-${entries[0].address}`)
  await settingsLoaded()
}

async function renderView(initial: ScanSnapshot): Promise<void> {
  readScanMock.mockResolvedValue({ ok: true, value: initial })
  onScanChangedMock.mockImplementation(() => () => {})
  onScanServerMock.mockImplementation(() => () => {})

  render(createElement(ServersView))

  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('ServersView - game-running note', () => {
  it('renders the paused-auto-refresh note as real text and keeps the refresh control enabled', async () => {
    await renderView(snapshot({ state: { blockedReason: 'game-running' } }))

    const banner = await screen.findByTestId('servers-scan-blocked')
    // Exact string, not a loose regex/truthy check - a raw unresolved i18n key
    // ("servers.scan.blocked.gameRunning") would also match `/game/i` and be truthy.
    expect(banner.textContent).toBe('Automatic refresh is paused while the game is running.')

    const refresh = screen.getByTestId('servers-refresh') as HTMLButtonElement
    expect(refresh.disabled).toBe(false)
  })

  it('shows no banner and an enabled refresh control when nothing blocks the scan', async () => {
    await renderView(snapshot({ state: { blockedReason: null } }))

    expect(screen.queryByTestId('servers-scan-blocked')).toBeNull()

    const refresh = screen.getByTestId('servers-refresh') as HTMLButtonElement
    expect(refresh.disabled).toBe(false)
  })
})

describe('ServersView - stale row label', () => {
  it('flags a stale entry with a visible stale label', async () => {
    await renderView(
      snapshot({
        entries: [
          { address: '1.2.3.4:27910', origins: ['manual'], status: 'stale', lastSeenAt: 'x' },
        ],
      }),
    )

    const stale = await screen.findByTestId('servers-row-stale-1.2.3.4:27910')
    // Exact string, not a bare truthiness check - a raw unresolved i18n key ("servers.row.stale")
    // would also be truthy.
    expect(stale.textContent).toBe('Stale')
  })

  it('shows a player count when a stale entry carries a full status-reply roster', async () => {
    // Story 116 review fix: a server that answered stage 2's `status` reply has its numeric
    // `players` count replaced by a full `ServerPlayer[]` roster (`scan-service.ts`'s
    // `mergeSuccessfulReply`) - the stale row must still show a count in that case.
    await renderView(
      snapshot({
        entries: [
          {
            address: '9.9.9.9:27910',
            origins: ['manual'],
            status: 'stale',
            lastSeenAt: 'x',
            players: [
              { score: 1, ping: 20, name: 'Alice' },
              { score: 2, ping: 30, name: 'Bob' },
            ],
          },
        ],
      }),
    )

    const row = await screen.findByTestId('servers-row-9.9.9.9:27910')
    expect(row.textContent).toContain('2')
  })

  it('does not flag an online entry as stale', async () => {
    await renderView(
      snapshot({
        entries: [
          { address: '5.6.7.8:27910', origins: ['manual'], status: 'online', lastSeenAt: 'x' },
        ],
      }),
    )

    await screen.findByTestId('servers-row-5.6.7.8:27910')
    expect(screen.queryByTestId('servers-row-stale-5.6.7.8:27910')).toBeNull()
  })
})

describe('ServersView - scoped refresh controls', () => {
  it('calls startScan with the favourites scope, and only that scope, when "Refresh favourites" is clicked', async () => {
    await renderView(snapshot({}))

    fireEvent.click(screen.getByTestId('servers-refresh-favourites'))

    expect(startScanMock).toHaveBeenCalledWith({ kind: 'favourites' })
  })

  it('selecting a row then clicking "Refresh this server" calls startScan with that row\'s server scope', async () => {
    await renderView(
      snapshot({
        entries: [
          { address: '1.2.3.4:27910', origins: ['manual'], status: 'online', lastSeenAt: 'x' },
        ],
      }),
    )

    readServerDetailMock.mockImplementation(async () => ({
      ok: true as const,
      value: { row: { ...SELECTED_ENTRY, favourite: false }, serverinfo: null },
    }))

    const row = await screen.findByTestId('servers-row-1.2.3.4:27910')
    fireEvent.click(row)
    expect(row.getAttribute('data-selected')).toBe('true')

    // "Refresh this server" lives in the detail pane now, not the list toolbar.
    fireEvent.click(await screen.findByTestId('servers-refresh-selected'))

    expect(startScanMock).toHaveBeenCalledWith({ kind: 'server', address: '1.2.3.4:27910' })
  })

  it('disables the toolbar refresh controls and shows a visible reason while a scan is running', async () => {
    await renderView(snapshot({ state: { running: true, blockedReason: null } }))

    const busy = await screen.findByTestId('servers-scan-busy')
    // Exact string, not a loose check - reuses `servers.scan.error.already-running` verbatim
    // (story's own instruction: no new key for the same meaning).
    expect(busy.textContent).toBe('A scan is already running.')

    expect((screen.getByTestId('servers-refresh') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByTestId('servers-refresh-favourites') as HTMLButtonElement).disabled).toBe(
      true,
    )
  })

  it('keeps the toolbar refresh controls enabled while the game runs', async () => {
    await renderView(snapshot({ state: { blockedReason: 'game-running' } }))

    expect((screen.getByTestId('servers-refresh') as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByTestId('servers-refresh-favourites') as HTMLButtonElement).disabled).toBe(
      false,
    )
  })

  it('"Refresh this server" and the address-book action are not in the list toolbar', async () => {
    await renderView(snapshot({ entries: [SELECTED_ENTRY] }))

    expect(screen.queryByTestId('servers-refresh-selected')).toBeNull()
    expect(screen.queryByTestId('servers-address-book-open')).toBeNull()
  })

  it('the detail pane\'s "Refresh this server" is disabled while a scan is running', async () => {
    readServerDetailMock.mockImplementation(async () => ({
      ok: true as const,
      value: { row: { ...SELECTED_ENTRY, favourite: false }, serverinfo: null },
    }))
    await renderView(snapshot({ state: { running: true }, entries: [SELECTED_ENTRY] }))

    fireEvent.click(await screen.findByTestId('servers-row-1.2.3.4:27910'))

    const button = (await screen.findByTestId('servers-refresh-selected')) as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })
})

describe('ServersView - list sort', () => {
  it("renders rows in the engine's default order", async () => {
    await renderView(
      snapshot({
        entries: [
          { address: 'b:1', origins: ['manual'], status: 'online', lastSeenAt: 'x', players: 1 },
          { address: 'a:1', origins: ['manual'], status: 'online', lastSeenAt: 'x', players: 5 },
        ],
      }),
    )

    // `ServerRow` renders each row as a `<button data-testid="servers-row-<address>">` - `:role`
    // scopes this to the row buttons themselves, never the badge testids nested inside one
    // (`servers-row-favourite-<address>` etc.), which also start with `servers-row-`.
    const rows = await screen.findAllByRole('button', { name: /:1/ })
    // Default order (`sortServerRows` with no sort) is occupancy descending among non-favourites -
    // 'a:1' (5 players) before 'b:1' (1 player).
    const addresses = rows.map((row) => row.getAttribute('data-testid'))
    expect(addresses).toEqual(['servers-row-a:1', 'servers-row-b:1'])

    expect(screen.getByTestId('servers-sort-current').textContent).toBe(
      'Favourites first, then busiest',
    )
  })

  it('clicking a column header sorts by it and persists via setListSort', async () => {
    await renderView(
      snapshot({
        entries: [
          { address: 'b:1', name: 'Bravo', origins: ['manual'], status: 'online', lastSeenAt: 'x' },
          { address: 'a:1', name: 'Alpha', origins: ['manual'], status: 'online', lastSeenAt: 'x' },
        ],
      }),
    )

    fireEvent.click(screen.getByTestId('servers-sort-name'))

    const rows = await screen.findAllByRole('button', { name: /Alpha|Bravo/ })
    expect(rows.map((row) => row.getAttribute('data-testid'))).toEqual([
      'servers-row-a:1',
      'servers-row-b:1',
    ])

    expect(setListSortMock).toHaveBeenCalledWith({ column: 'name', direction: 'asc' })
    const button = screen.getByTestId('servers-sort-name')
    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('servers-sort-current').textContent).toBe('Sorted by Name, ascending')
  })

  it('restores the persisted sort on mount', async () => {
    getListSortMock.mockResolvedValueOnce({
      ok: true,
      value: { column: 'map', direction: 'desc' },
    })

    await renderView(snapshot({}))

    const button = await screen.findByTestId('servers-sort-map')
    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('servers-sort-current').textContent).toBe('Sorted by Map, descending')
  })
})

describe('ServersView - list filter', () => {
  it('filtering narrows the rendered rows without changing the sort control', async () => {
    await renderView(
      snapshot({
        entries: [
          {
            address: 'a:1',
            name: 'Alpha',
            origins: ['manual'],
            status: 'online',
            lastSeenAt: 'x',
            mod: 'ctf',
          },
          {
            address: 'b:1',
            name: 'Bravo',
            origins: ['manual'],
            status: 'online',
            lastSeenAt: 'x',
            mod: 'baseq2',
          },
        ],
      }),
    )

    fireEvent.click(screen.getByTestId('servers-sort-name'))
    await screen.findAllByRole('button', { name: /Alpha|Bravo/ })

    toggleMod('ctf')

    const rows = await screen.findAllByRole('button', { name: /Alpha|Bravo/ })
    expect(rows.map((row) => row.getAttribute('data-testid'))).toEqual(['servers-row-a:1'])

    // Sort control kept its state (asc-by-name) - filtering did not touch it.
    expect(screen.getByTestId('servers-sort-name').getAttribute('aria-pressed')).toBe('true')
  })

  it('a filtered-out selected row is deselected', async () => {
    await renderView(
      snapshot({
        entries: [
          {
            address: 'a:1',
            name: 'Alpha',
            origins: ['manual'],
            status: 'online',
            lastSeenAt: 'x',
            mod: 'ctf',
          },
          {
            address: 'b:1',
            name: 'Bravo',
            origins: ['manual'],
            status: 'online',
            lastSeenAt: 'x',
            mod: 'baseq2',
          },
        ],
      }),
    )

    const rowA = await screen.findByTestId('servers-row-a:1')
    fireEvent.click(rowA)
    expect(rowA.getAttribute('data-selected')).toBe('true')

    toggleMod('baseq2')

    await screen.findAllByRole('button', { name: /Bravo/ })
    expect(screen.queryByTestId('servers-row-a:1')).toBeNull()
    // Selection cleared - the pane is back to its empty state.
    expect(screen.getByTestId('servers-detail-empty')).toBeTruthy()
  })

  it('a filter that matches nothing shows the no-match line, not the empty state', async () => {
    await renderView(
      snapshot({
        entries: [
          {
            address: 'a:1',
            name: 'Alpha',
            origins: ['manual'],
            status: 'online',
            lastSeenAt: 'x',
            mod: 'ctf',
          },
        ],
      }),
    )

    fireEvent.change(screen.getByTestId('servers-filter-search'), {
      target: { value: 'nope-nothing-matches' },
    })

    const noMatch = await screen.findByTestId('servers-filter-no-match')
    expect(noMatch.textContent).toContain('No servers match your filters.')
    expect(screen.queryByTestId('servers-row-a:1')).toBeNull()
  })
})

describe('ServersView - detail pane', () => {
  const ADDRESS = '1.2.3.4:27910'

  async function renderWithOneServer(): Promise<void> {
    readServerDetailMock.mockResolvedValue({
      ok: true,
      value: {
        row: {
          address: ADDRESS,
          origins: ['manual'],
          status: 'online',
          lastSeenAt: 'x',
          favourite: false,
        },
        serverinfo: null,
      },
    })
    await renderView(
      snapshot({
        entries: [{ address: ADDRESS, origins: ['manual'], status: 'online', lastSeenAt: 'x' }],
      }),
    )
  }

  it('with no server selected the detail pane shows its empty state', async () => {
    await renderWithOneServer()
    await screen.findByTestId(`servers-row-${ADDRESS}`)

    expect(screen.getByTestId('servers-detail')).toBeTruthy()
    expect(screen.getByTestId('servers-detail-empty').textContent).toContain(
      "Select a server to see who's playing and join.",
    )
  })

  it('selecting a row shows its details in the pane', async () => {
    await renderWithOneServer()

    fireEvent.click(await screen.findByTestId(`servers-row-${ADDRESS}`))

    await waitFor(() => expect(readServerDetailMock).toHaveBeenCalledWith(ADDRESS))
    expect(screen.queryByTestId('servers-detail-empty')).toBeNull()
  })

  it('clicking the selected row again keeps it selected and its details shown', async () => {
    await renderWithOneServer()

    const row = await screen.findByTestId(`servers-row-${ADDRESS}`)
    fireEvent.click(row)
    await waitFor(() => expect(readServerDetailMock).toHaveBeenCalledWith(ADDRESS))
    fireEvent.click(row)

    expect(screen.getByTestId(`servers-row-${ADDRESS}`).getAttribute('data-selected')).toBe('true')
    expect(screen.queryByTestId('servers-detail-empty')).toBeNull()
  })

  it('the list grid keeps its classes whether or not a server is selected', async () => {
    await renderWithOneServer()

    const grid = (await screen.findByTestId('servers-list-column')).parentElement
    const before = grid?.className
    fireEvent.click(await screen.findByTestId(`servers-row-${ADDRESS}`))
    await waitFor(() => expect(readServerDetailMock).toHaveBeenCalledWith(ADDRESS))

    expect(before).toBeTruthy()
    expect(screen.getByTestId('servers-list-column').parentElement?.className).toBe(before)
  })
})

describe('ServersView - list status panel', () => {
  it('a source failure is shown beside the rows from the other sources', async () => {
    listMasterSourcesMock.mockResolvedValueOnce({
      ok: true,
      value: [
        { id: 'bad-source', type: 'udp-master', address: 'dead.example.com:27900', enabled: true },
      ],
    })

    await renderView(
      snapshot({
        state: {
          finishedAt: 'x',
          sourceFailures: [
            { sourceId: 'bad-source', reasonKey: 'servers.scan.error.already-running' },
          ],
        },
        entries: [
          { address: 'a:1', origins: ['manual'], status: 'online', lastSeenAt: 'x' },
          { address: 'b:1', origins: ['manual'], status: 'online', lastSeenAt: 'x' },
        ],
      }),
    )

    await screen.findByTestId('servers-row-a:1')
    await screen.findByTestId('servers-row-b:1')

    const failure = await screen.findByTestId('servers-list-source-failure-bad-source')
    expect(failure.textContent).toContain('dead.example.com:27900')
  })

  it('a scan.server push refreshes the rows while the scan runs', async () => {
    await renderView(snapshot({ state: { running: true } }))

    // `onScanServer` was subscribed once during mount (the effect's own subscription call) -
    // capture the listener it registered, whatever the mock's implementation was at call time.
    const pushListener = onScanServerMock.mock.calls[0]?.[0] as (() => void) | undefined

    readScanMock.mockClear()
    readScanMock.mockResolvedValue({
      ok: true,
      value: snapshot({
        state: { running: true },
        entries: [{ address: 'pushed:1', origins: ['manual'], status: 'online', lastSeenAt: 'x' }],
      }),
    })

    expect(pushListener).toBeDefined()
    await act(async () => {
      pushListener?.()
      pushListener?.()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    // Coalesced: two pushes while idle triggers a read, then at most one trailing read - never one
    // read per push.
    expect(readScanMock.mock.calls.length).toBeGreaterThanOrEqual(1)
    expect(readScanMock.mock.calls.length).toBeLessThanOrEqual(2)

    // The read's result must actually be applied to state, not just fetched - a broken
    // implementation that calls readScan() on each push but never calls setEntries(...) would
    // still pass the assertions above.
    await screen.findByTestId('servers-row-pushed:1')
  })
})

describe('ServersView - Online/LAN toggle', () => {
  it('the mode toggle opens on Online', async () => {
    await renderView(snapshot({}))
    expect(screen.getByTestId('servers-mode-online').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('servers-mode-lan').getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByTestId('servers-refresh-favourites').hasAttribute('disabled')).toBe(false)
  })

  it('resets main to Online before announcing the view active', async () => {
    setModeMock.mockClear()
    setScanViewActiveMock.mockClear()
    const lanSnapshot = snapshot({})
    lanSnapshot.mode = 'lan'
    await renderView(lanSnapshot)
    expect(setModeMock).toHaveBeenCalledWith('online')
    expect(setScanViewActiveMock).toHaveBeenCalledWith(true)
    expect(setModeMock.mock.invocationCallOrder[0]).toBeLessThan(
      setScanViewActiveMock.mock.invocationCallOrder[0],
    )
    expect(screen.getByTestId('servers-mode-online').getAttribute('aria-pressed')).toBe('true')
  })

  it('switching to LAN tells main, clears the selection and disables favourites with a visible reason', async () => {
    await renderView(snapshot({ entries: [SELECTED_ENTRY] }))
    fireEvent.click(screen.getByTestId('servers-mode-lan'))
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(setModeMock).toHaveBeenCalledWith('lan')
    expect(screen.getByTestId('servers-mode-lan').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('servers-refresh-favourites').hasAttribute('disabled')).toBe(true)
    expect(screen.getByTestId('servers-lan-favourites-reason').textContent).toContain(
      'Not available on the LAN',
    )
  })

  it('shows a LAN discovery failure as text and keeps the LAN button enabled', async () => {
    const withFailure = snapshot({})
    withFailure.lan = { lastFinishedAt: 'x', failureKey: 'servers.lan.error.noInterface' }
    await renderView(withFailure)
    fireEvent.click(screen.getByTestId('servers-mode-lan'))
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(screen.getByTestId('servers-lan-failure').textContent).toContain(
      'No local network connection found.',
    )
    expect(screen.getByTestId('servers-mode-lan').hasAttribute('disabled')).toBe(false)
  })
})

describe('ServersView - render cost', () => {
  it('an unrelated re-render does not re-sort the rows', async () => {
    await renderView(snapshot({ entries: [SELECTED_ENTRY] }))
    // Saving a quick filter needs a criterion; a filter change alone never re-sorts.
    fireEvent.click(screen.getByTestId('servers-filter-hide-bots'))
    const sorts = vi.mocked(sortServerRows).mock.calls.length
    expect(sorts).toBeGreaterThan(0)

    fireEvent.click(screen.getByTestId('servers-quickfilter-save'))
    await screen.findByTestId('servers-quickfilter-dialog')

    expect(vi.mocked(sortServerRows).mock.calls.length).toBe(sorts)
  })
})

describe('ServersView - refresh the shown servers', () => {
  const CTF: ServerListEntry = {
    address: 'a:1',
    name: 'Alpha',
    origins: ['manual'],
    status: 'online',
    lastSeenAt: 'x',
    mod: 'ctf',
  }
  const BASEQ2: ServerListEntry = { ...CTF, address: 'b:1', name: 'Bravo', mod: 'baseq2' }

  it('with a filter active the button reads Refresh N shown and starts the addresses scope with the visible rows', async () => {
    await renderView(snapshot({ entries: [CTF, BASEQ2] }))

    toggleMod('ctf')
    await screen.findByTestId('servers-row-a:1')

    const button = screen.getByTestId('servers-refresh')
    expect(button.textContent).toBe('Refresh 1 shown')
    fireEvent.click(button)

    expect(startScanMock).toHaveBeenCalledWith({ kind: 'addresses', addresses: ['a:1'] }, undefined)
    expect(startScanMock).toHaveBeenCalledTimes(1)
  })

  it('checking two mods shows the servers of either, unchecking all shows every row', async () => {
    const third: ServerListEntry = { ...CTF, address: 'c:1', name: 'Charlie', mod: 'opentdm' }
    await renderView(snapshot({ entries: [CTF, BASEQ2, third] }))

    toggleMod('ctf')
    toggleMod('opentdm')
    await screen.findByTestId('servers-row-c:1')
    expect(screen.getByTestId('servers-row-a:1')).toBeTruthy()
    expect(screen.queryByTestId('servers-row-b:1')).toBeNull()

    toggleMod('ctf')
    toggleMod('opentdm')
    await screen.findByTestId('servers-row-b:1')
    expect(screen.getByTestId('servers-row-a:1')).toBeTruthy()
    expect(screen.getByTestId('servers-row-c:1')).toBeTruthy()
    expect(screen.getByTestId('servers-filter-mod').textContent).toBe('Any')
  })

  it('with no filter the button reads Scan now, has no options menu and starts the all scope', async () => {
    await renderView(snapshot({ entries: [CTF, BASEQ2] }))

    const button = screen.getByTestId('servers-refresh')
    expect(button.textContent).toBe('Scan now')
    expect(screen.queryByTestId('servers-refresh-options')).toBeNull()
    fireEvent.click(button)

    expect(startScanMock).toHaveBeenCalledWith({ kind: 'all' }, undefined)
  })

  it('Scan all in the options menu starts the all scope while a filter is active', async () => {
    await renderView(snapshot({ entries: [CTF, BASEQ2] }))
    toggleMod('ctf')
    await screen.findByTestId('servers-row-a:1')

    const options = screen.getByTestId('servers-refresh-options')
    expect(options.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(options)
    expect(options.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Scan all' }))

    expect(startScanMock).toHaveBeenCalledWith({ kind: 'all' }, undefined)
    expect(startScanMock).toHaveBeenCalledTimes(1)
  })

  it('a row that stops matching the filter after a scan.server push leaves the list', async () => {
    await renderView(snapshot({ entries: [CTF, BASEQ2] }))
    toggleMod('ctf')
    await screen.findByTestId('servers-row-a:1')

    readScanMock.mockResolvedValue({
      ok: true,
      value: snapshot({ entries: [{ ...CTF, mod: 'baseq2' }, BASEQ2] }),
    })
    const pushed = onScanServerMock.mock.calls[0]?.[0] as () => void
    await act(async () => {
      pushed()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(screen.queryByTestId('servers-row-a:1')).toBeNull()
    expect(screen.getByTestId('servers-refresh').textContent).toBe('Refresh 0 shown')
  })

  it('shows why the button is disabled when the filter leaves no servers', async () => {
    await renderView(snapshot({ entries: [CTF] }))
    fireEvent.change(screen.getByTestId('servers-filter-search'), { target: { value: 'nope' } })

    expect((await screen.findByTestId('servers-refresh-none')).textContent).toBe(
      'No servers shown — use Scan all or clear the filter.',
    )
    expect((screen.getByTestId('servers-refresh') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByTestId('servers-refresh-options') as HTMLButtonElement).disabled).toBe(
      false,
    )
  })

  it('the refresh-shown button and the options menu are disabled while a scan runs', async () => {
    await renderView(snapshot({ state: { running: true }, entries: [CTF, BASEQ2] }))
    toggleMod('ctf')
    await screen.findByTestId('servers-row-a:1')

    expect((screen.getByTestId('servers-refresh') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByTestId('servers-refresh-options') as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('ServersView - double-click on a row', () => {
  const ADDRESS = '1.2.3.4:27910'
  const ENTRY: ServerListEntry = {
    address: ADDRESS,
    origins: ['manual'],
    status: 'online',
    lastSeenAt: 'x',
  }

  it('double-click joins when the setting is on', async () => {
    await renderWithInstallation([ENTRY])

    fireEvent.doubleClick(screen.getByTestId(`servers-row-${ADDRESS}`))

    expect(startJoinMock).toHaveBeenCalledTimes(1)
    expect(startJoinMock).toHaveBeenCalledWith(expect.objectContaining({ address: ADDRESS }))
  })

  it('double-click only selects when the setting is off', async () => {
    getScanSettingsMock.mockResolvedValue({
      ok: true,
      value: { doubleClickJoins: false } as ServersScanSettings,
    })
    await renderWithInstallation([ENTRY])
    const row = screen.getByTestId(`servers-row-${ADDRESS}`)

    fireEvent.click(row)
    fireEvent.doubleClick(row)
    fireEvent.click(row)

    expect(startJoinMock).not.toHaveBeenCalled()
    expect(row.getAttribute('data-selected')).toBe('true')
  })

  it.each([
    ['there is no active installation', ENTRY, false],
    ['the address is invalid', { ...ENTRY, address: 'not-an-address' }, true],
  ])('double-click and Enter only select when %s', async (_reason, entry, installed) => {
    await renderWithInstallation([entry], { installed })
    const row = screen.getByTestId(`servers-row-${entry.address}`)

    fireEvent.click(row)
    fireEvent.doubleClick(row)
    fireEvent.keyDown(row, { key: 'Enter' })

    expect(startJoinMock).not.toHaveBeenCalled()
    expect(row.getAttribute('data-selected')).toBe('true')
  })
})

describe('ServersView - keyboard navigation', () => {
  const ADDRESSES = ['1.2.3.4:27910', '1.2.3.5:27910', '1.2.3.6:27910']
  const entries: ServerListEntry[] = ADDRESSES.map((address) => ({
    address,
    origins: ['manual'],
    status: 'online',
    lastSeenAt: 'x',
  }))
  const rowOf = (address: string) => screen.getByTestId(`servers-row-${address}`)
  const selectedAddresses = () =>
    ADDRESSES.filter((address) => rowOf(address).getAttribute('data-selected') === 'true')

  it('ArrowDown selects the next visible row and shows its details', async () => {
    await renderWithInstallation(entries)
    fireEvent.click(rowOf(ADDRESSES[0]))

    fireEvent.keyDown(rowOf(ADDRESSES[0]), { key: 'ArrowDown' })

    expect(selectedAddresses()).toEqual([ADDRESSES[1]])
    await waitFor(() => expect(readServerDetailMock).toHaveBeenCalledWith(ADDRESSES[1]))
    expect(screen.queryByTestId('servers-detail-empty')).toBeNull()
    expect(document.activeElement).toBe(rowOf(ADDRESSES[1]))
  })

  it('arrow keys skip rows hidden by the filter', async () => {
    const [first, middle, last] = ADDRESSES.map((address, index): ServerListEntry => ({
      ...entries[index],
      address,
      name: `Server ${index}`,
      mod: index === 1 ? 'baseq2' : 'ctf',
    }))
    await renderWithInstallation([first, middle, last])
    toggleMod('ctf')
    await waitFor(() => expect(screen.queryByTestId(`servers-row-${middle.address}`)).toBeNull())
    fireEvent.click(rowOf(first.address))

    fireEvent.keyDown(rowOf(first.address), { key: 'ArrowDown' })
    expect(rowOf(last.address).getAttribute('data-selected')).toBe('true')

    fireEvent.keyDown(rowOf(last.address), { key: 'ArrowUp' })
    expect(rowOf(first.address).getAttribute('data-selected')).toBe('true')
  })

  it('arrow keys stop at the first and last row', async () => {
    await renderWithInstallation(entries)
    fireEvent.click(rowOf(ADDRESSES[0]))

    fireEvent.keyDown(rowOf(ADDRESSES[0]), { key: 'ArrowUp' })
    expect(selectedAddresses()).toEqual([ADDRESSES[0]])

    fireEvent.click(rowOf(ADDRESSES[2]))
    fireEvent.keyDown(rowOf(ADDRESSES[2]), { key: 'ArrowDown' })
    expect(selectedAddresses()).toEqual([ADDRESSES[2]])
  })

  it('Enter on the selected row joins even with double-click joining off', async () => {
    getScanSettingsMock.mockResolvedValue({
      ok: true,
      value: { doubleClickJoins: false } as ServersScanSettings,
    })
    await renderWithInstallation(entries)
    fireEvent.click(rowOf(ADDRESSES[0]))

    // The setting is really off: a double-click does not join, Enter still does.
    fireEvent.doubleClick(rowOf(ADDRESSES[0]))
    expect(startJoinMock).not.toHaveBeenCalled()
    fireEvent.keyDown(rowOf(ADDRESSES[0]), { key: 'Enter' })

    expect(startJoinMock).toHaveBeenCalledTimes(1)
    expect(startJoinMock).toHaveBeenCalledWith(expect.objectContaining({ address: ADDRESSES[0] }))
  })

  it('Enter in the search field does not join', async () => {
    await renderWithInstallation(entries)
    fireEvent.click(rowOf(ADDRESSES[0]))

    const search = screen.getByTestId('servers-filter-search')
    fireEvent.keyDown(search, { key: 'Enter' })
    fireEvent.keyDown(search, { key: 'ArrowDown' })

    expect(startJoinMock).not.toHaveBeenCalled()
    expect(selectedAddresses()).toEqual([ADDRESSES[0]])
  })
})

describe('ServersView - tab-panel labelling', () => {
  it('with the watchlist locked the servers body carries no tab-panel labelling', async () => {
    await renderView(snapshot({}))
    await screen.findByTestId('servers-refresh')

    expect(document.querySelector('[role="tabpanel"]')).toBeNull()
    expect(document.querySelector('[aria-labelledby^="servers-tab-"]')).toBeNull()
  })
})
