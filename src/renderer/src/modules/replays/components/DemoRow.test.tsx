// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { DemoRow as DemoRowData } from '@shared/modules/replays'
import { initI18n } from '../../../i18n'

let DemoRow: typeof import('./DemoRow').DemoRow

beforeAll(async () => {
  await initI18n('en')
  ;({ DemoRow } = await import('./DemoRow'))
})

afterEach(() => {
  cleanup()
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
      source: { kind: 'installation', installationId: 'i1', installationName: 'Main', gameDir: 'baseq2' },
      durationMs: 65_000,
      effective: {
        ...BASE_ROW.effective,
        name: { value: 'Grand final', source: 'sidecar' },
        map: { value: 'q2dm1', source: 'demo' },
        mod: { value: 'baseq2', source: 'demo' },
        gamemode: { value: 'ctf', source: 'sidecar' },
        sides: { value: [{ team: 'Red', players: ['Alice'] }, { team: 'Blue', players: ['Bob'] }], source: 'sidecar' },
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

  it('a guessed gamemode is marked guessed', () => {
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
    expect(gamemode.textContent).toContain('guessed')
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

  it('Enter selects the row', () => {
    let selectedId: string | undefined
    renderRow(BASE_ROW, false, (id) => {
      selectedId = id
    })
    fireEvent.keyDown(screen.getByTestId('replays-demo-row'), { key: 'Enter' })
    expect(selectedId).toBe(BASE_ROW.id)
  })
})
