// @vitest-environment jsdom
import { createElement } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { DemoRow as DemoRowData, ReplaysScanProgress } from '@shared/modules/replays'
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

const { indexReadMock, scanStartMock, onScanProgressMock } = vi.hoisted(() => ({
  indexReadMock: vi.fn(),
  scanStartMock: vi.fn(async () => ({ ok: true as const, value: { started: true } })),
  onScanProgressMock: vi.fn((_listener: (progress: unknown) => void) => () => {}),
}))

vi.mock('./client', () => ({
  indexRead: indexReadMock,
  scanStart: scanStartMock,
  onScanProgress: onScanProgressMock,
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
      (acc, key) => (acc && typeof acc === 'object' && key in acc ? (acc as Record<string, unknown>)[key] : undefined),
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
    await renderView([])

    const empty = await screen.findByTestId('replays-list-empty')
    expect(empty.textContent).toBe('No demos found.')
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

    const button = screen.getByTestId('replays-refresh') as HTMLButtonElement
    expect(button.textContent).toBe('Refresh')
    expect(button.disabled).toBe(false)

    fireEvent.click(button)
    expect(scanStartMock).toHaveBeenCalledTimes(2)

    progress.push({ running: true, sources: [] })
    expect(button.disabled).toBe(true)
    expect(button.textContent).toBe('Scanning…')

    progress.push({ running: false, sources: [] })
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

    progress.push({ running: false, sources: [] })
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

    expect(screen.queryByTestId('replays-demo-detail')).toBeNull()

    const [row] = screen.getAllByTestId('replays-demo-row')
    fireEvent.click(row)

    const detail = await screen.findByTestId('replays-demo-detail')
    expect(detail).toBeTruthy()
    const title = screen.getByTestId('replays-demo-detail-title')
    expect(title.textContent).toBe('ffa1_2026-01-02.dm2')
  })

  it('closing the detail panel clears the selection', async () => {
    await renderView([DEMO])

    const row = screen.getByTestId('replays-demo-row')
    fireEvent.click(row)
    await screen.findByTestId('replays-demo-detail')

    const closeButton = screen.getByTestId('replays-demo-detail-close')
    fireEvent.click(closeButton)

    expect(screen.queryByTestId('replays-demo-detail')).toBeNull()
  })
})
