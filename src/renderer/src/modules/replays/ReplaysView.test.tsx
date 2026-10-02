// @vitest-environment jsdom
import { createElement } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type {
  DemoRow as DemoRowData,
  ReplaysScanProgress,
  ReplaysSourceError,
} from '@shared/modules/replays'
import { EMPTY_DEMO_LIST_FILTER, type DemoListFilter } from '@shared/replays/list-filter'
import type { DemoListSort } from '@shared/replays/list-sort'
import en from '../../i18n/locales/en.json'
import { initI18n } from '../../i18n'

/**
 * Story 141 D4, extended by story 144 D4, and again by story 158/159 D4. Mirrors `ServersView.test
 * .tsx`'s convention: the module's own typed client (`./client`) is stubbed directly via
 * `vi.mock`, rather than going through `window.q2`'s `invoke`/`on` plumbing.
 *
 * Story 144 D4: the view reads the index (`indexRead`) instead of the one-shot `listDemos`, kicks
 * off a background scan (`scanStart`) on mount, and subscribes to its progress (`onScanProgress`)
 * for its lifetime - the mocks below cover all three.
 *
 * Story 158/159 D4: `indexRead` now resolves `DemoRow[]` (sidecar + effective values, composed in
 * main) rather than the bare `DiscoveredDemo[]` - every fixture below carries both, and the list is
 * rendered through `VirtualDemoList`/`DemoRow` rather than a plain `<ul>`.
 */
vi.hoisted(() => {
  const invoke = vi.fn(() => Promise.resolve(undefined))
  const on = vi.fn(() => () => {})
  ;(globalThis as unknown as { q2: unknown }).q2 = { invoke, on }
})

const {
  indexReadMock,
  scanStartMock,
  onScanProgressMock,
  getListSortMock,
  setListSortMock,
  getListFilterMock,
  setListFilterMock,
  readModWarningMock,
  trustModWarningModMock,
} = vi.hoisted(() => ({
  indexReadMock: vi.fn(),
  scanStartMock: vi.fn(async () => ({ ok: true as const, value: { started: true } })),
  onScanProgressMock: vi.fn((_listener: (progress: unknown) => void) => () => {}),
  // Story 152 D3: the persisted list-sort mocks - default to "no sort persisted" so every
  // pre-existing test in this file keeps seeing the default favourites-first order.
  getListSortMock: vi.fn(async (): Promise<{ ok: true; value: DemoListSort | null }> => ({
    ok: true,
    value: null,
  })),
  setListSortMock: vi.fn(async (sort: unknown) => ({ ok: true as const, value: sort })),
  // Story 153 D5: the persisted list-filter mocks - default to "nothing persisted" so every
  // pre-existing test in this file keeps seeing every row unfiltered.
  getListFilterMock: vi.fn(async () => ({ ok: true as const, value: EMPTY_DEMO_LIST_FILTER })),
  setListFilterMock: vi.fn(async (filter: DemoListFilter) => ({
    ok: true as const,
    value: filter,
  })),
  // Story 182 D2: the mod-warning state - defaults to "warning on, nothing trusted" (always ask).
  readModWarningMock: vi.fn(
    async (): Promise<{ ok: true; value: { enabled: boolean; trustedMods: string[] } }> => ({
      ok: true,
      value: { enabled: true, trustedMods: [] },
    }),
  ),
  trustModWarningModMock: vi.fn(async (gameDir: string) => ({
    ok: true as const,
    value: { enabled: true, trustedMods: [gameDir] },
  })),
}))

const sidecarReadMock = vi.fn(async () => ({
  ok: true as const,
  value: { state: { state: 'none' as const }, values: {} },
}))
const playDemoMock = vi.fn()

vi.mock('./client', () => ({
  indexRead: indexReadMock,
  scanStart: scanStartMock,
  onScanProgress: onScanProgressMock,
  getListSort: getListSortMock,
  setListSort: setListSortMock,
  getListFilter: getListFilterMock,
  setListFilter: setListFilterMock,
  readModWarning: readModWarningMock,
  trustModWarningMod: trustModWarningModMock,
  sidecarRead: sidecarReadMock,
  playDemo: (...args: unknown[]) => playDemoMock(...args),
  onPlaybackPosition: () => () => {},
  onPlaybackState: () => () => {},
  onPlaybackDisplay: () => () => {},
  playbackDisplayRead: () => new Promise(() => {}),
}))

// Story 193 D1: the mods client - the catalog read and the install start; defaults to "no catalog".
const { getCatalogMock, installModMock } = vi.hoisted(() => ({
  getCatalogMock: vi.fn(async (): Promise<unknown> => ({
    ok: true,
    value: { status: 'unavailable' },
  })),
  installModMock: vi.fn(async (..._args: unknown[]): Promise<unknown> => ({
    ok: true,
    value: { jobId: 'job-1' },
  })),
}))
vi.mock('../mods/client', () => ({
  getCatalog: getCatalogMock,
  installMod: installModMock,
  onInstallDecision: () => () => {},
}))

let ReplaysView: typeof import('./ReplaysView').ReplaysView

beforeAll(async () => {
  await initI18n('en')
  ;({ ReplaysView } = await import('./ReplaysView'))
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  onScanProgressMock.mockImplementation(() => () => {})
})

/** A row with nothing known beyond identity/source - mirrors `DemoRow.test.tsx`'s `BASE_ROW`, since
 * `ReplaysView` now renders every row through the same `DemoRow` component. */
const DEMO: DemoRowData = {
  id: '0123456789abcdef',
  fileName: 'ffa1_2026-01-02.dm2',
  format: 'dm2',
  gzip: false,
  source: {
    kind: 'installation',
    installationId: 'inst-1',
    installationName: 'My Install',
    gameDir: 'baseq2',
  },
  archiveEntry: null,
  map: null,
  unparsableReason: null,
  readable: true,
  unreadable: null,
  gameDir: null,
  pov: null,
  players: [],
  durationMs: null,
  fileTime: { birthtimeMs: 0, mtimeMs: 0 },
  nameFacts: null,
  sidecar: { state: 'none', values: {} },
  effective: {
    name: { value: 'ffa1_2026-01-02.dm2', source: 'name' },
    map: { value: null, source: null },
    mod: { value: null, source: null },
    gamemode: { value: null, source: null },
    sides: { value: null, source: null },
    date: { value: null, source: null },
    pov: { value: null, source: null },
    host: { value: null, source: null },
  },
}

/** Captures the listener `onScanProgress` was called with, so a test can push a progress payload
 * as if main had emitted `scan.progress`. */
function captureProgressListener(): { push: (progress: ReplaysScanProgress) => void } {
  let listener: ((progress: ReplaysScanProgress) => void) | undefined
  onScanProgressMock.mockImplementation((cb: (progress: ReplaysScanProgress) => void) => {
    listener = cb
    return () => {}
  })
  return {
    push: (progress) => {
      if (!listener) throw new Error('onScanProgress listener was never registered')
      act(() => {
        listener?.(progress)
      })
    },
  }
}

async function renderView(demos: DemoRowData[]): Promise<void> {
  indexReadMock.mockResolvedValue({ ok: true, value: demos })
  render(createElement(ReplaysView))
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

function stringAt(path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (acc, key) =>
        acc && typeof acc === 'object' && key in acc
          ? (acc as Record<string, unknown>)[key]
          : undefined,
      en,
    )
}

describe('ReplaysView (story 141 D4)', () => {
  it('each row shows the file name and its installation and game dir', async () => {
    await renderView([DEMO])

    const row = await screen.findByTestId('replays-demo-row')
    expect(row.getAttribute('data-demo-id')).toBe(DEMO.id)

    const name = screen.getByTestId('replays-demo-name')
    expect(name.textContent).toBe('ffa1_2026-01-02.dm2')

    const source = screen.getByTestId('replays-demo-source')
    expect(source.textContent).toBe('My Install · baseq2')
  })

  it('an extra-folder source renders as extra folder: <path>', async () => {
    const demo: DemoRowData = {
      ...DEMO,
      id: 'fedcba9876543210',
      source: { kind: 'extraFolder', path: 'C:\\Demos' },
    }
    await renderView([demo])

    const source = screen.getByTestId('replays-demo-source')
    expect(source.textContent).toBe('extra folder: C:\\Demos')
  })

  it('an empty discovery shows the empty line', async () => {
    // Story 151 D3: `scanning` starts `true` on mount, so the empty state only shows once the
    // mount's own scan has actually finished - push that here before asserting.
    const progress = captureProgressListener()
    await renderView([])
    progress.push({ running: false, sources: [], sourceErrors: [] })
    await act(async () => {
      await Promise.resolve()
    })

    const empty = await screen.findByTestId('replays-list-empty')
    expect(empty.textContent).toContain('No demos found.')
    expect(screen.queryByTestId('replays-demo-list')).toBeNull()
  })

  it('every new string comes from the replays block', async () => {
    await renderView([DEMO])

    const heading = await screen.findByRole('heading', { name: 'Demos' })
    expect(heading.textContent).toBe(stringAt('replays.view.title'))

    const source = screen.getByTestId('replays-demo-source')
    if (DEMO.source.kind !== 'installation') throw new Error('expected an installation source')
    expect(source.textContent).toBe(
      // The raw file name is data, not i18n - excluded here; only the source template's rendering
      // is checked against the shared block.
      (stringAt('replays.list.source') as string)
        .replace('{{installation}}', DEMO.source.installationName)
        .replace('{{gameDir}}', DEMO.source.gameDir),
    )

    // Every i18n key this view renders lives under the top-level `replays` block.
    for (const key of [
      'replays.view.title',
      'replays.list.label',
      'replays.list.loading',
      'replays.list.empty',
      'replays.list.source',
      'replays.list.refresh',
      'replays.list.refreshing',
    ]) {
      expect(key).toMatch(/^replays\./)
      expect(typeof stringAt(key)).toBe('string')
    }
  })
})

describe('ReplaysView - archive-entry rows (story 143 D4)', () => {
  it('a row from inside a zip carries data-archive-entry, the archive source line and the map', async () => {
    const demo: DemoRowData = {
      ...DEMO,
      id: '00112233445566aa',
      fileName: 'final.mvd2',
      archiveEntry: { archivePath: 'C:\\Demos\\pack.zip', entryPath: 'sub/final.mvd2' },
      map: 'q2dm1',
      effective: { ...DEMO.effective, map: { value: 'q2dm1', source: 'demo' } },
    }
    await renderView([demo])

    const row = await screen.findByTestId('replays-demo-row')
    expect(row.getAttribute('data-archive-entry')).toBe('true')

    const source = screen.getByTestId('replays-demo-source')
    expect(source.textContent).toBe('My Install · baseq2 › pack.zip › sub/final.mvd2')

    const map = screen.getByTestId('replays-demo-map')
    expect(map.textContent).toBe('q2dm1')
  })

  it('a loose row (archiveEntry null) has no data-archive-entry attribute and an unknown map cell', async () => {
    await renderView([DEMO])

    const row = await screen.findByTestId('replays-demo-row')
    expect(row.getAttribute('data-archive-entry')).toBeNull()
    // Story 158/159 D4: `DemoRow` always renders the map cell (a fixed grid column) - an unresolved
    // map shows as the accessible dash placeholder, never as a missing element.
    expect(screen.getByTestId('replays-demo-map').textContent).toContain('–')
  })
})

describe('ReplaysView - loading state (story 141 D4)', () => {
  it('shows the loading line before indexRead resolves', async () => {
    let resolve!: (value: { ok: true; value: DemoRowData[] }) => void
    indexReadMock.mockReturnValue(
      new Promise((r) => {
        resolve = r
      }),
    )

    render(createElement(ReplaysView))

    const loading = await screen.findByTestId('replays-list-loading')
    expect(loading.textContent).toBe('Looking for demos…')

    await act(async () => {
      resolve({ ok: true, value: [] })
      await Promise.resolve()
    })
  })
})

describe('ReplaysView - scan on open and refresh (story 144 D4)', () => {
  it('mounting the view reads the index and starts a scan', async () => {
    await renderView([])

    expect(indexReadMock).toHaveBeenCalledTimes(1)
    expect(scanStartMock).toHaveBeenCalledTimes(1)
  })

  it('the refresh button starts a scan and is disabled while one runs', async () => {
    const progress = captureProgressListener()
    await renderView([DEMO])

    // Story 151 D3: `scanning` starts `true` on mount - settle the mount's own scan first so the
    // button starts from its idle state before this test drives a second round itself.
    progress.push({ running: false, sources: [], sourceErrors: [] })
    await act(async () => {
      await Promise.resolve()
    })

    const button = screen.getByTestId('replays-refresh') as HTMLButtonElement
    expect(button.textContent).toBe('Refresh')
    expect(button.disabled).toBe(false)

    fireEvent.click(button)
    expect(scanStartMock).toHaveBeenCalledTimes(2)

    progress.push({ running: true, sources: [], sourceErrors: [] })
    expect(button.disabled).toBe(true)
    expect(button.textContent).toBe('Scanning…')

    progress.push({ running: false, sources: [], sourceErrors: [] })
    await act(async () => {
      await Promise.resolve()
    })
    expect(button.disabled).toBe(false)
    expect(button.textContent).toBe('Refresh')
  })

  it('cached rows render before the scan finishes and are replaced once when it finishes', async () => {
    const progress = captureProgressListener()
    const firstDemo = DEMO
    const secondDemo: DemoRowData = { ...DEMO, id: 'fedcba0123456789', fileName: 'second.dm2' }
    const thirdDemo: DemoRowData = { ...DEMO, id: '00ff00ff00ff00ff', fileName: 'third.dm2' }

    indexReadMock
      .mockResolvedValueOnce({ ok: true, value: [firstDemo, secondDemo] })
      .mockResolvedValueOnce({ ok: true, value: [firstDemo, secondDemo, thirdDemo] })

    render(createElement(ReplaysView))
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(screen.getAllByTestId('replays-demo-row')).toHaveLength(2)
    expect(indexReadMock).toHaveBeenCalledTimes(1)

    progress.push({ running: false, sources: [], sourceErrors: [] })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(screen.getAllByTestId('replays-demo-row')).toHaveLength(3)
    expect(indexReadMock).toHaveBeenCalledTimes(2)
  })
})

describe('ReplaysView - virtualised, selectable list with a detail shell (story 158/159 D4)', () => {
  it('3000 rows render at most one window of row elements', async () => {
    const demos: DemoRowData[] = Array.from({ length: 3000 }, (_, index) => ({
      ...DEMO,
      id: index.toString(16).padStart(16, '0'),
      fileName: `demo-${index}.dm2`,
    }))

    await renderView(demos)

    const rendered = screen.getAllByTestId('replays-demo-row')
    expect(rendered.length).toBeGreaterThan(0)
    expect(rendered.length).toBeLessThan(100)

    // The spacer still reserves the full scrollable height for all 3000 rows.
    const list = screen.getByTestId('replays-demo-list')
    expect(list.getAttribute('aria-label')).toBe(stringAt('replays.list.label'))
  })

  it('selecting a row opens its detail panel', async () => {
    const secondDemo: DemoRowData = {
      ...DEMO,
      id: 'fedcba0123456789',
      fileName: 'second.dm2',
      effective: { ...DEMO.effective, name: { value: 'second.dm2', source: 'name' } },
    }
    await renderView([DEMO, secondDemo])

    expect(screen.queryByTestId('replays-detail')).toBeNull()

    const [row] = screen.getAllByTestId('replays-demo-row')
    fireEvent.click(row)

    const detail = await screen.findByTestId('replays-detail')
    expect(detail).toBeTruthy()
    expect(detail.textContent).toContain('ffa1_2026-01-02.dm2')
  })

  it('closing the detail panel clears the selection', async () => {
    await renderView([DEMO])

    const row = screen.getByTestId('replays-demo-row')
    fireEvent.click(row)
    await screen.findByTestId('replays-detail')

    const closeButton = screen.getByTestId('replays-detail-close')
    fireEvent.click(closeButton)

    expect(screen.queryByTestId('replays-detail')).toBeNull()
  })
})

describe('ReplaysListStatus wiring (story 151 D3)', () => {
  it('an empty cache during a running scan shows loading, not empty', async () => {
    const progress = captureProgressListener()
    await renderView([])

    progress.push({
      running: true,
      sources: [{ sourceKey: 'a', scanned: 1, total: 5 }],
      sourceErrors: [],
    })

    expect(screen.getByTestId('replays-list-loading')).toBeTruthy()
    expect(screen.queryByTestId('replays-list-empty')).toBeNull()
  })

  it('a finished scan with source errors lists each error next to the remaining demos', async () => {
    const progress = captureProgressListener()
    await renderView([DEMO])

    const errors: ReplaysSourceError[] = [
      {
        source: {
          kind: 'installation',
          installationId: 'inst-1',
          installationName: 'My Install',
          gameDir: 'baseq2',
        },
        archiveName: null,
        reason: 'missing',
      },
      {
        source: { kind: 'extraFolder', path: 'C:\\Demos' },
        archiveName: 'pack.zip',
        reason: 'archive-unreadable',
      },
    ]

    progress.push({ running: false, sources: [], sourceErrors: errors })
    await act(async () => {
      await Promise.resolve()
    })

    const rows = screen.getAllByTestId('replays-list-source-error')
    expect(rows).toHaveLength(2)
    expect(rows[0].getAttribute('data-reason')).toBe('missing')
    expect(rows[1].getAttribute('data-reason')).toBe('archive-unreadable')

    expect(screen.getAllByTestId('replays-demo-row')).toHaveLength(1)
  })
})

describe('ReplaysView - filter (story 153 D5)', () => {
  it('filtering narrows the rows without changing the sort', async () => {
    const mapAscSort: DemoListSort = { column: 'map', direction: 'asc' }
    getListSortMock.mockResolvedValueOnce({ ok: true, value: mapAscSort })
    const demoA: DemoRowData = {
      ...DEMO,
      id: 'aaaaaaaaaaaaaaaa',
      fileName: 'keep-a.dm2',
      map: 'q2dm5',
      effective: { ...DEMO.effective, map: { value: 'q2dm5', source: 'demo' } },
    }
    const demoB: DemoRowData = {
      ...DEMO,
      id: 'bbbbbbbbbbbbbbbb',
      fileName: 'keep-b.dm2',
      map: 'q2dm1',
      effective: { ...DEMO.effective, map: { value: 'q2dm1', source: 'demo' } },
    }
    const demoC: DemoRowData = {
      ...DEMO,
      id: 'cccccccccccccccc',
      fileName: 'skip-c.dm2',
      map: 'q2dm9',
      effective: { ...DEMO.effective, map: { value: 'q2dm9', source: 'demo' } },
    }
    await renderView([demoA, demoB, demoC])

    expect(screen.getAllByTestId('replays-demo-row')).toHaveLength(3)

    const search = screen.getByTestId('replays-filter-search') as HTMLInputElement
    fireEvent.change(search, { target: { value: 'keep' } })

    const rows = screen.getAllByTestId('replays-demo-row')
    // Still sorted by map ascending (q2dm1 before q2dm5) - filtering only narrowed the set, the
    // sort control's own choice (and the order it produces) is untouched.
    expect(rows.map((row) => row.getAttribute('data-demo-id'))).toEqual([demoB.id, demoA.id])
  })

  it('a filter matching nothing shows the no-match state, not the empty state', async () => {
    await renderView([DEMO])

    const search = screen.getByTestId('replays-filter-search')
    fireEvent.change(search, { target: { value: 'nonexistent-term-xyz' } })

    expect(await screen.findByTestId('replays-filter-no-match')).toBeTruthy()
    expect(screen.queryByTestId('replays-list-empty')).toBeNull()
    expect(screen.queryByTestId('replays-demo-row')).toBeNull()

    fireEvent.click(screen.getByTestId('replays-filter-no-match-clear'))
    expect(await screen.findByTestId('replays-demo-row')).toBeTruthy()
  })

  it('the persisted filter is applied before the first rows render', async () => {
    getListFilterMock.mockResolvedValueOnce({
      ok: true,
      value: { ...EMPTY_DEMO_LIST_FILTER, search: 'keep' },
    })
    const demoKeep: DemoRowData = { ...DEMO, id: '1111111111111111', fileName: 'keep-this.dm2' }
    const demoDrop: DemoRowData = { ...DEMO, id: '2222222222222222', fileName: 'drop-this.dm2' }
    await renderView([demoKeep, demoDrop])

    const rows = screen.getAllByTestId('replays-demo-row')
    expect(rows).toHaveLength(1)
    expect(rows[0].getAttribute('data-demo-id')).toBe(demoKeep.id)
    expect((screen.getByTestId('replays-filter-search') as HTMLInputElement).value).toBe('keep')
  })
})

describe('ReplaysView - the action bar View plays the selected demo (story 180 D2)', () => {
  let usePrimaryActionStore: typeof import('../../lib/primary-action').usePrimaryActionStore
  let useLauncher: typeof import('../../store/useLauncher').useLauncher
  let useDemoEditorStore: typeof import('./demo-editor-store').useDemoEditorStore

  const SECOND: DemoRowData = {
    ...DEMO,
    id: 'fedcba0123456789',
    fileName: 'second.dm2',
    effective: { ...DEMO.effective, name: { value: 'second.dm2', source: 'name' } },
  }

  beforeAll(async () => {
    ;({ usePrimaryActionStore } = await import('../../lib/primary-action'))
    ;({ useLauncher } = await import('../../store/useLauncher'))
    ;({ useDemoEditorStore } = await import('./demo-editor-store'))
  })

  function playableSetup(): void {
    useDemoEditorStore.getState().close()
    usePrimaryActionStore.setState({ owner: null, action: null })
    useLauncher.setState({
      installations: [
        { id: 'inst-1', engineKind: 'q2pro', gameDirs: ['baseq2'], runner: undefined },
      ] as never,
      settings: { ...useLauncher.getState().settings, activeInstallationId: 'inst-1' },
      appInfo: { platform: 'win32' } as never,
      launch: { phase: 'idle' as never, installationId: null },
    })
  }

  function published() {
    const { owner, action } = usePrimaryActionStore.getState()
    expect(owner).toBe('/replays')
    if (action === null) throw new Error('nothing published')
    return action
  }

  it('no selection publishes a disabled View', async () => {
    playableSetup()
    await renderView([DEMO])
    const action = published()
    expect(action).toMatchObject({
      id: 'view',
      labelKey: 'installation.action.view',
      disabled: true,
    })
    expect(action.reason).toBeUndefined()
  })

  it('selecting a playable demo publishes an enabled View', async () => {
    playableSetup()
    await renderView([DEMO])
    fireEvent.click(screen.getByTestId('replays-demo-row'))
    await screen.findByTestId('replays-detail')
    const action = published()
    expect(action).toMatchObject({ id: 'view', disabled: false })
    expect(action.reason).toBeUndefined()
  })

  it('a selected demo that cannot play publishes a disabled View with its reason', async () => {
    playableSetup()
    useLauncher.setState({ launch: { phase: 'running' as never, installationId: 'inst-1' } })
    await renderView([DEMO])
    fireEvent.click(screen.getByTestId('replays-demo-row'))
    await screen.findByTestId('replays-detail')
    expect(published()).toMatchObject({
      disabled: true,
      reason: { key: 'replays.play.unavailable.gameRunning' },
    })
  })

  it('View plays the demo selected now, even through an action published for an earlier one', async () => {
    playableSetup()
    playDemoMock.mockResolvedValue({ ok: true, value: { ok: true, value: { stage: null } } })
    await renderView([DEMO, SECOND])
    const rowFor = (id: string) =>
      screen
        .getAllByTestId('replays-demo-row')
        .find((row) => row.getAttribute('data-demo-id') === id)!
    fireEvent.click(rowFor(DEMO.id))
    await screen.findByTestId('replays-detail')
    const earlier = published()
    fireEvent.click(rowFor(SECOND.id))
    await act(async () => {
      earlier.run()
      await Promise.resolve()
    })
    await vi.waitFor(() =>
      expect(playDemoMock).toHaveBeenCalledWith({ demoId: SECOND.id, installationId: 'inst-1' }),
    )
    expect(playDemoMock).toHaveBeenCalledTimes(1)
    const { usePlaybackStore } = await import('./playback-store')
    usePlaybackStore.getState().endSession()
  })

  describe('a mod-missing demo', () => {
    async function selectModMissing(): Promise<void> {
      playableSetup()
      playDemoMock.mockReset()
      playDemoMock.mockResolvedValue({ ok: true, value: { ok: true, value: { stage: null } } })
      await renderView([{ ...DEMO, gameDir: 'opentdm' } as DemoRowData])
      fireEvent.click(screen.getByTestId('replays-demo-row'))
      await screen.findByTestId('replays-detail')
    }

    it('keeps View enabled with no permanent warning, and View opens a confirmation naming the mod', async () => {
      await selectModMissing()
      expect(published().disabled).toBe(false)
      expect(published().reason).toBeUndefined()
      act(() => published().run())
      expect((await screen.findByTestId('replays-mod-missing-dialog')).textContent).toContain(
        'opentdm',
      )
      expect(playDemoMock).not.toHaveBeenCalled()
    })

    it('Cancel plays nothing', async () => {
      await selectModMissing()
      act(() => published().run())
      fireEvent.click(await screen.findByTestId('replays-mod-missing-cancel'))
      expect(screen.queryByTestId('replays-mod-missing-dialog')).toBeNull()
      expect(playDemoMock).not.toHaveBeenCalled()
    })

    it("Cancel with don't ask again ticked remembers nothing", async () => {
      await selectModMissing()
      act(() => published().run())
      fireEvent.click(await screen.findByTestId('replays-mod-warning-dont-ask'))
      fireEvent.click(await screen.findByTestId('replays-mod-missing-cancel'))
      expect(trustModWarningModMock).not.toHaveBeenCalled()
      expect(playDemoMock).not.toHaveBeenCalled()
      act(() => published().run())
      expect(await screen.findByTestId('replays-mod-missing-dialog')).toBeTruthy()
    })

    it("Play anyway with don't ask again ticked remembers the mod, then plays", async () => {
      await selectModMissing()
      act(() => published().run())
      fireEvent.click(await screen.findByTestId('replays-mod-warning-dont-ask'))
      fireEvent.click(await screen.findByTestId('replays-mod-missing-confirm'))
      await vi.waitFor(() =>
        expect(playDemoMock).toHaveBeenCalledWith({
          demoId: DEMO.id,
          installationId: 'inst-1',
          acknowledgeModMissing: true,
        }),
      )
      expect(trustModWarningModMock).toHaveBeenCalledWith('opentdm')
      const { usePlaybackStore } = await import('./playback-store')
      usePlaybackStore.getState().endSession()
    })

    it('Play anyway without the tick remembers nothing', async () => {
      await selectModMissing()
      act(() => published().run())
      fireEvent.click(await screen.findByTestId('replays-mod-missing-confirm'))
      await vi.waitFor(() => expect(playDemoMock).toHaveBeenCalledTimes(1))
      expect(trustModWarningModMock).not.toHaveBeenCalled()
      const { usePlaybackStore } = await import('./playback-store')
      usePlaybackStore.getState().endSession()
    })

    it('a trusted mod plays without asking', async () => {
      await selectModMissing()
      readModWarningMock.mockResolvedValueOnce({
        ok: true,
        value: { enabled: true, trustedMods: ['opentdm'] },
      })
      act(() => published().run())
      await vi.waitFor(() =>
        expect(playDemoMock).toHaveBeenCalledWith({
          demoId: DEMO.id,
          installationId: 'inst-1',
          acknowledgeModMissing: true,
        }),
      )
      expect(screen.queryByTestId('replays-mod-missing-dialog')).toBeNull()
      const { usePlaybackStore } = await import('./playback-store')
      usePlaybackStore.getState().endSession()
    })

    it('switched off, a missing mod plays without asking', async () => {
      await selectModMissing()
      readModWarningMock.mockResolvedValueOnce({
        ok: true,
        value: { enabled: false, trustedMods: [] },
      })
      act(() => published().run())
      await vi.waitFor(() =>
        expect(playDemoMock).toHaveBeenCalledWith({
          demoId: DEMO.id,
          installationId: 'inst-1',
          acknowledgeModMissing: true,
        }),
      )
      expect(screen.queryByTestId('replays-mod-missing-dialog')).toBeNull()
      const { usePlaybackStore } = await import('./playback-store')
      usePlaybackStore.getState().endSession()
    })

    it('an unreadable warning state falls back to asking', async () => {
      await selectModMissing()
      readModWarningMock.mockResolvedValueOnce({ ok: false, error: { key: 'x' } } as never)
      act(() => published().run())
      expect(await screen.findByTestId('replays-mod-missing-dialog')).toBeTruthy()
      expect(playDemoMock).not.toHaveBeenCalled()
    })

    const CATALOG_WITH_OPENTDM = {
      ok: true,
      value: {
        status: 'ok',
        entries: [{ id: 'opentdm', gamedir: 'opentdm', name: 'OpenTDM' }],
      },
    }

    it('a catalog mod is offered for install in the mod-missing dialog', async () => {
      await selectModMissing()
      getCatalogMock.mockResolvedValueOnce(CATALOG_WITH_OPENTDM)
      act(() => published().run())
      expect((await screen.findByTestId('replays-mod-missing-install')).textContent).toBe(
        'Install OpenTDM',
      )
      expect(screen.getByTestId('replays-mod-missing-confirm')).toBeTruthy()
    })

    it('without a catalog entry the dialog offers no install', async () => {
      await selectModMissing()
      getCatalogMock.mockResolvedValueOnce({
        ok: true,
        value: { status: 'ok', entries: [{ id: 'ctf', gamedir: 'ctf', name: 'CTF' }] },
      })
      act(() => published().run())
      await screen.findByTestId('replays-mod-missing-dialog')
      expect(screen.queryByTestId('replays-mod-missing-install')).toBeNull()
    })

    it('a failed catalog read still opens the dialog without install', async () => {
      await selectModMissing()
      getCatalogMock.mockRejectedValueOnce(new Error('boom'))
      act(() => published().run())
      await screen.findByTestId('replays-mod-missing-dialog')
      expect(screen.queryByTestId('replays-mod-missing-install')).toBeNull()
    })

    it('Install starts the install into the active installation and plays nothing', async () => {
      await selectModMissing()
      getCatalogMock.mockResolvedValueOnce(CATALOG_WITH_OPENTDM)
      act(() => published().run())
      fireEvent.click(await screen.findByTestId('replays-mod-missing-install'))
      await vi.waitFor(() => expect(installModMock).toHaveBeenCalledWith('inst-1', 'opentdm'))
      await vi.waitFor(() => expect(screen.queryByTestId('replays-mod-missing-dialog')).toBeNull())
      expect(playDemoMock).not.toHaveBeenCalled()
    })

    it("Install with don't ask again ticked does not trust the mod", async () => {
      await selectModMissing()
      getCatalogMock.mockResolvedValueOnce(CATALOG_WITH_OPENTDM)
      act(() => published().run())
      fireEvent.click(await screen.findByTestId('replays-mod-warning-dont-ask'))
      fireEvent.click(await screen.findByTestId('replays-mod-missing-install'))
      await vi.waitFor(() => expect(installModMock).toHaveBeenCalledTimes(1))
      await vi.waitFor(() => expect(screen.queryByTestId('replays-mod-missing-dialog')).toBeNull())
      expect(trustModWarningModMock).not.toHaveBeenCalled()
      expect(playDemoMock).not.toHaveBeenCalled()
    })

    it('a failed install start keeps the dialog open with the reason', async () => {
      await selectModMissing()
      getCatalogMock.mockResolvedValueOnce(CATALOG_WITH_OPENTDM)
      installModMock.mockResolvedValueOnce({ ok: false, error: { key: 'mods.error.noVariant' } })
      act(() => published().run())
      fireEvent.click(await screen.findByTestId('replays-mod-missing-install'))
      const error = await screen.findByTestId('replays-mod-missing-install-error')
      expect(error.textContent).toBe('This mod has no build for your engine.')
      expect(screen.getByTestId('replays-mod-missing-dialog')).toBeTruthy()
      expect(playDemoMock).not.toHaveBeenCalled()
    })

    it('a rejected install start keeps the dialog open with the generic failure text', async () => {
      await selectModMissing()
      getCatalogMock.mockResolvedValueOnce(CATALOG_WITH_OPENTDM)
      installModMock.mockRejectedValueOnce(new Error('ipc down'))
      act(() => published().run())
      fireEvent.click(await screen.findByTestId('replays-mod-missing-install'))
      const error = await screen.findByTestId('replays-mod-missing-install-error')
      expect(error.textContent).toBe('The install could not be started.')
      expect(screen.getByTestId('replays-mod-missing-dialog')).toBeTruthy()
      expect(playDemoMock).not.toHaveBeenCalled()
    })

    it('a second Install click while the start is pending starts only one install', async () => {
      await selectModMissing()
      getCatalogMock.mockResolvedValueOnce(CATALOG_WITH_OPENTDM)
      let release: (value: unknown) => void = () => {}
      installModMock.mockReturnValueOnce(new Promise((resolve) => (release = resolve)))
      act(() => published().run())
      const button = await screen.findByTestId('replays-mod-missing-install')
      fireEvent.click(button)
      fireEvent.click(button)
      expect(installModMock).toHaveBeenCalledTimes(1)
      await vi.waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(true))
      await act(async () => release({ ok: true }))
      await vi.waitFor(() => expect(screen.queryByTestId('replays-mod-missing-dialog')).toBeNull())
    })

    it('Play anyway plays with the acknowledgement', async () => {
      await selectModMissing()
      act(() => published().run())
      fireEvent.click(await screen.findByTestId('replays-mod-missing-confirm'))
      expect(screen.queryByTestId('replays-mod-missing-dialog')).toBeNull()
      await vi.waitFor(() =>
        expect(playDemoMock).toHaveBeenCalledWith({
          demoId: DEMO.id,
          installationId: 'inst-1',
          acknowledgeModMissing: true,
        }),
      )
      const { usePlaybackStore } = await import('./playback-store')
      usePlaybackStore.getState().endSession()
    })
  })

  it('leaving the view clears the contribution', async () => {
    playableSetup()
    await renderView([DEMO])
    published()
    cleanup()
    expect(usePrimaryActionStore.getState()).toMatchObject({ owner: null, action: null })
  })
})
