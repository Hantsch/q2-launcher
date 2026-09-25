// @vitest-environment jsdom
import { createElement } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { ScanSnapshot, ServerListEntry, ServersScanState } from '@shared/modules/servers'
import { initI18n } from '../../i18n'

/**
 * Story 116 D5. Mirrors `DownloadsView.test.tsx`'s convention: the module's own typed client
 * (`./client`) is stubbed directly via `vi.mock`, rather than going through `window.q2`'s
 * `invoke`/`on` plumbing - simpler, and this view's logic is entirely about what it does with
 * `readScan()`'s resolved value and `onScanChanged()`'s pushes, not about the transport itself.
 */
const { readScanMock, startScanMock, setScanViewActiveMock, onScanChangedMock } = vi.hoisted(
  () => ({
    readScanMock: vi.fn(),
    startScanMock: vi.fn(async () => ({ ok: true as const, value: { ok: true as const } })),
    setScanViewActiveMock: vi.fn(async () => ({ ok: true as const, value: undefined })),
    onScanChangedMock: vi.fn(),
  }),
)

vi.mock('./client', () => ({
  readScan: readScanMock,
  startScan: startScanMock,
  setScanViewActive: setScanViewActiveMock,
  onScanChanged: onScanChangedMock,
}))

let ServersView: typeof import('./ServersView').ServersView

beforeAll(async () => {
  await initI18n('en')
  ;({ ServersView } = await import('./ServersView'))
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  onScanChangedMock.mockImplementation(() => () => {})
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
    entries: overrides.entries ?? [],
  }
}

async function renderView(initial: ScanSnapshot): Promise<void> {
  readScanMock.mockResolvedValue({ ok: true, value: initial })
  onScanChangedMock.mockImplementation(() => () => {})

  render(createElement(ServersView))

  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('ServersView - blocked banner (story 116 D5)', () => {
  it('renders the blocked reason as real text and disables the refresh control', async () => {
    await renderView(snapshot({ state: { blockedReason: 'game-running' } }))

    const banner = await screen.findByTestId('servers-scan-blocked')
    // Exact string, not a loose regex/truthy check - a raw unresolved i18n key
    // ("servers.scan.blocked.gameRunning") would also match `/game/i` and be truthy.
    expect(banner.textContent).toBe("Servers can't be scanned while the game is running.")

    const refresh = screen.getByTestId('servers-refresh') as HTMLButtonElement
    expect(refresh.disabled).toBe(true)
  })

  it('shows no banner and an enabled refresh control when nothing blocks the scan', async () => {
    await renderView(snapshot({ state: { blockedReason: null } }))

    expect(screen.queryByTestId('servers-scan-blocked')).toBeNull()

    const refresh = screen.getByTestId('servers-refresh') as HTMLButtonElement
    expect(refresh.disabled).toBe(false)
  })
})

describe('ServersView - stale row label (story 116 D5)', () => {
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

describe('ServersView - scoped refresh controls (story 117 D5)', () => {
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

    const row = await screen.findByTestId('servers-row-1.2.3.4:27910')
    fireEvent.click(row)
    expect(row.getAttribute('data-selected')).toBe('true')

    fireEvent.click(screen.getByTestId('servers-refresh-selected'))

    expect(startScanMock).toHaveBeenCalledWith({ kind: 'server', address: '1.2.3.4:27910' })
  })

  it('disables all three refresh controls and shows a visible reason while a scan is running', async () => {
    await renderView(snapshot({ state: { running: true, blockedReason: null } }))

    const busy = await screen.findByTestId('servers-scan-busy')
    // Exact string, not a loose check - reuses `servers.scan.error.already-running` verbatim
    // (story's own instruction: no new key for the same meaning).
    expect(busy.textContent).toBe('A scan is already running.')

    expect((screen.getByTestId('servers-refresh') as HTMLButtonElement).disabled).toBe(true)
    expect(
      (screen.getByTestId('servers-refresh-favourites') as HTMLButtonElement).disabled,
    ).toBe(true)
    expect(
      (screen.getByTestId('servers-refresh-selected') as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('disables all three refresh controls while blocked by the game running', async () => {
    await renderView(snapshot({ state: { blockedReason: 'game-running' } }))

    expect((screen.getByTestId('servers-refresh') as HTMLButtonElement).disabled).toBe(true)
    expect(
      (screen.getByTestId('servers-refresh-favourites') as HTMLButtonElement).disabled,
    ).toBe(true)
    expect(
      (screen.getByTestId('servers-refresh-selected') as HTMLButtonElement).disabled,
    ).toBe(true)
    // Blocked is the more specific/urgent reason - the busy banner does not also render.
    expect(screen.queryByTestId('servers-scan-busy')).toBeNull()
  })

  it('disables "Refresh this server" with a visible reason when nothing is selected, even idle and unblocked', async () => {
    await renderView(snapshot({}))

    const button = screen.getByTestId('servers-refresh-selected') as HTMLButtonElement
    expect(button.disabled).toBe(true)

    const hint = screen.getByTestId('servers-refresh-selected-hint')
    expect(hint.textContent).toBe('Select a server to refresh it.')
  })
})
