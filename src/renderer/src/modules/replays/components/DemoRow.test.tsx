// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { mockClient } from '../../../test-support/mock-client'
import type { DemoRow as DemoRowData } from '@shared/modules/replays'
import { initI18n } from '../../../i18n'

// Story 155 D6: DemoRow's quick favourite/rating controls call the editor store, which calls
// through `../client` - mirrors `DemoNotesEditor.test.tsx`'s stubbed-client idiom.
const sidecarRead = vi.fn()
const sidecarWrite = vi.fn()

vi.mock('../client', (importOriginal) =>
  mockClient<typeof import('../client')>(importOriginal, {
    sidecarRead: (...args: unknown[]) => sidecarRead(...args),
    sidecarWrite: (...args: unknown[]) => sidecarWrite(...args),
  }),
)

let DemoRow: typeof import('./DemoRow').DemoRow

beforeAll(async () => {
  await initI18n('en')
  ;({ DemoRow } = await import('./DemoRow'))
})

afterEach(() => {
  cleanup()
  sidecarRead.mockReset()
  sidecarWrite.mockReset()
})

/** A row with nothing known yet - every effective field unresolved, no sidecar, readable, not
 * archived. The base every test overrides from. */
const BASE_ROW: DemoRowData = {
  id: '0123456789abcdef',
  fileName: 'demo1.dm2',
  format: 'dm2',
  gzip: false,
  source: { kind: 'extraFolder', path: '/demos' },
  archiveEntry: null,
  map: null,
  unparsableReason: null,
  readable: true,
  unreadable: null,
  gameDir: null,
  pov: null,
  players: [],
  durationMs: null,
  roster: null,
  fileTime: { birthtimeMs: 0, mtimeMs: 0 },
  nameFacts: null,
  sidecar: { state: 'none', values: {} },
  effective: {
    name: { value: null, source: null },
    map: { value: null, source: null },
    mod: { value: null, source: null },
    gamemode: { value: null, source: null },
    sides: { value: null, source: null },
    date: { value: null, source: null },
    pov: { value: null, source: null },
    host: { value: null, source: null },
  },
}

function renderRow(row: DemoRowData, selected = false, onSelect: (id: string) => void = () => {}) {
  render(createElement(DemoRow, { row, selected, onSelect }))
}

describe('DemoRow', () => {
  it('shows every known value', () => {
    const row: DemoRowData = {
      ...BASE_ROW,
      format: 'mvd2',
      gzip: true,
      source: {
        kind: 'installation',
        installationId: 'i1',
        installationName: 'Main',
        gameDir: 'baseq2',
      },
      durationMs: 65_000,
      effective: {
        ...BASE_ROW.effective,
        name: { value: 'Grand final', source: 'sidecar' },
        map: { value: 'q2dm1', source: 'demo' },
        mod: { value: 'baseq2', source: 'demo' },
        gamemode: { value: 'ctf', source: 'sidecar' },
        sides: {
          value: [
            { team: 'Red', players: ['Alice'] },
            { team: 'Blue', players: ['Bob'] },
          ],
          source: 'sidecar',
        },
        date: { value: Date.UTC(2024, 0, 1, 12, 0, 0), source: 'sidecar' },
      },
    }
    renderRow(row)

    const rowEl = screen.getByTestId('replays-demo-row')
    expect(rowEl.textContent).toContain('Grand final')
    expect(screen.getByTestId('replays-demo-gamemode').textContent).toContain('CTF')
    expect(screen.getByTestId('replays-demo-format').textContent).toContain('MVD2')
    expect(screen.getByTestId('replays-demo-map').textContent).toContain('q2dm1')
    expect(screen.getByTestId('replays-demo-mod').textContent).toContain('baseq2')
    expect(screen.getByTestId('replays-demo-sides').textContent).toBe('Red vs Blue')
    expect(screen.getByTestId('replays-demo-duration').textContent).toBe('1:05')
    expect(screen.getByTestId('replays-demo-date').textContent).not.toBe('')
    expect(screen.getByTestId('replays-demo-source').textContent).toContain('Main')
  })

  it('a guessed gamemode carries no guessed marker', () => {
    const row: DemoRowData = {
      ...BASE_ROW,
      effective: {
        ...BASE_ROW.effective,
        gamemode: { value: 'duel', source: 'guessed' },
      },
    }
    renderRow(row)
    const gamemode = screen.getByTestId('replays-demo-gamemode')
    expect(gamemode.textContent).toContain('Duel')
    expect(gamemode.textContent).toBe('Duel')
    expect(gamemode.textContent).not.toContain('guessed')
  })

  it('favourite and rating show only when the sidecar sets them', () => {
    renderRow({ ...BASE_ROW, sidecar: { state: 'ok', values: { favourite: true, rating: 7 } } })
    expect(screen.getByTestId('replays-demo-favourite')).toBeTruthy()
    expect(screen.getByTestId('replays-demo-rating').textContent).toBe('7/10')

    cleanup()

    renderRow({ ...BASE_ROW, sidecar: { state: 'ok', values: {} } })
    expect(screen.queryByTestId('replays-demo-favourite')).toBeNull()
    expect(screen.queryByTestId('replays-demo-rating')).toBeNull()
  })

  it('each marker appears exactly when it applies', () => {
    renderRow({
      ...BASE_ROW,
      readable: false,
      unreadable: { reason: 'truncated' },
      archiveEntry: { archivePath: '/demos/pack.zip', entryPath: 'demo1.dm2' },
      sidecar: { state: 'error', values: {} },
    })
    expect(screen.getByTestId('replays-marker-sidecar')).toBeTruthy()
    expect(screen.getByTestId('replays-marker-sidecar-error')).toBeTruthy()
    expect(screen.getByTestId('replays-marker-archive')).toBeTruthy()
    expect(screen.getByTestId('replays-marker-unreadable')).toBeTruthy()

    cleanup()

    renderRow(BASE_ROW)
    expect(screen.queryByTestId('replays-marker-sidecar')).toBeNull()
    expect(screen.queryByTestId('replays-marker-sidecar-error')).toBeNull()
    expect(screen.queryByTestId('replays-marker-archive')).toBeNull()
    expect(screen.queryByTestId('replays-marker-unreadable')).toBeNull()
  })

  it('an all-unknown row renders placeholders and never throws', () => {
    expect(() => renderRow(BASE_ROW)).not.toThrow()
    expect(screen.getByTestId('replays-demo-row')).toBeTruthy()
    expect(screen.getAllByText('–').length).toBeGreaterThan(0)
  })

  it('the quick favourite/rating controls are disabled for an archive entry, with a reason', () => {
    renderRow({
      ...BASE_ROW,
      archiveEntry: { archivePath: '/demos/pack.zip', entryPath: 'demo1.dm2' },
    })
    const favourite = screen.getByTestId('replays-row-favourite') as HTMLButtonElement
    const rating = screen.getByTestId('replays-row-rating') as HTMLSelectElement
    expect(favourite.disabled).toBe(true)
    expect(rating.disabled).toBe(true)
    const reason = screen.getByTestId('replays-archive-readonly-row')
    expect(reason.textContent).toBe('Read-only (in an archive)')
    expect(favourite.getAttribute('aria-describedby')).toBe(reason.id)
    expect(rating.getAttribute('aria-describedby')).toBe(reason.id)
  })

  it('a loose (non-archive) row has neither the read-only notice nor disabled controls', () => {
    renderRow(BASE_ROW)
    const favourite = screen.getByTestId('replays-row-favourite') as HTMLButtonElement
    const rating = screen.getByTestId('replays-row-rating') as HTMLSelectElement
    expect(favourite.disabled).toBe(false)
    expect(rating.disabled).toBe(false)
    expect(screen.queryByTestId('replays-archive-readonly-row')).toBeNull()
  })

  it('clicking the quick favourite/rating controls never selects the row', () => {
    sidecarRead.mockResolvedValue({ ok: true, value: { state: { state: 'ok' }, values: {} } })
    sidecarWrite.mockResolvedValue({ ok: true, value: { status: 'saved', state: 'written' } })
    let selectedId: string | undefined
    renderRow(BASE_ROW, false, (id) => {
      selectedId = id
    })
    fireEvent.click(screen.getByTestId('replays-row-favourite'))
    fireEvent.change(screen.getByTestId('replays-row-rating'), { target: { value: '7' } })
    expect(selectedId).toBeUndefined()
  })

  it('Enter selects the row', () => {
    let selectedId: string | undefined
    renderRow(BASE_ROW, false, (id) => {
      selectedId = id
    })
    // `role="button"`/`tabIndex`/`onKeyDown` live on the inner selectable subgrid, not the
    // `replays-demo-row`-testid element (which is the outer div - see DemoRow.tsx's comment on
    // why the two are split), so this must query the explicit `role="button"` element directly
    // rather than by testid (the quick-favourite IconButton is also a native <button>, so a plain
    // `getByRole('button')` would be ambiguous).
    const rowContainer = screen.getByTestId('replays-demo-row')
    const selectableRow = rowContainer.querySelector('[role="button"]') as HTMLElement
    fireEvent.keyDown(selectableRow, { key: 'Enter' })
    expect(selectedId).toBe(BASE_ROW.id)
  })

  it('data-demo-id and data-archive-entry live on the replays-demo-row element, aria-pressed on the inner role=button', () => {
    renderRow({
      ...BASE_ROW,
      archiveEntry: { archivePath: '/demos/pack.zip', entryPath: 'demo1.dm2' },
    })
    const rowEl = screen.getByTestId('replays-demo-row')
    expect(rowEl.getAttribute('data-demo-id')).toBe(BASE_ROW.id)
    expect(rowEl.getAttribute('data-archive-entry')).toBe('true')
    expect(rowEl.getAttribute('role')).toBeNull()
    const innerButton = rowEl.querySelector('[role="button"]') as HTMLElement
    expect(innerButton).toBeTruthy()
    expect(innerButton.getAttribute('aria-pressed')).toBe('false')
    expect(rowEl.contains(innerButton)).toBe(true)
  })
})
