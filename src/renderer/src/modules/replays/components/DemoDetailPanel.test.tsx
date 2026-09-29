// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { DemoRow } from '@shared/modules/replays'
import type { Outcome } from '@shared/types'
import { initI18n } from '../../../i18n'

/**
 * Story 155 D1. Mirrors `NameTemplatesList.test.tsx`'s stubbed-client idiom
 * (`vi.mock('../client', ...)`) rather than a raw `window.q2` stub, since the panel calls
 * `sidecarRead` itself on mount. Story 156 D2 mounts `DemoFileActions` inside this panel, which
 * reads `useLauncher` (for `pushToast`) - that resolves `window.q2` at module scope via
 * `lib/bridge.ts` (same reasoning as `ServerRow.test.tsx`), so the stub must exist before the
 * store, and anything importing it, is imported.
 */
const invokeMock = vi.hoisted(() => vi.fn(async () => ({ ok: true as const, value: null })))
vi.hoisted(() => {
  ;(globalThis as unknown as { q2: unknown }).q2 = { invoke: invokeMock, on: vi.fn(() => () => {}) }
})

const sidecarRead = vi.fn()

vi.mock('../client', () => ({
  sidecarRead: (demoId: string) => sidecarRead(demoId),
  revealDemo: vi.fn(async () => ({ ok: true, value: { ok: true } })),
  copyDemoPath: vi.fn(async () => ({ ok: true, value: { ok: true } })),
  renameDemo: vi.fn(async () => ({ ok: true, value: { ok: true } })),
}))

let DemoDetailPanel: typeof import('./DemoDetailPanel').DemoDetailPanel

beforeAll(async () => {
  await initI18n('en')
  ;({ DemoDetailPanel } = await import('./DemoDetailPanel'))
})

afterEach(() => {
  cleanup()
  sidecarRead.mockReset()
})

const BASE_ROW: DemoRow = {
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
  durationMs: 65_000,
  fileTime: { birthtimeMs: 0, mtimeMs: 0 },
  nameFacts: null,
  sidecar: { state: 'ok', values: { favourite: true, rating: 7 } },
  effective: {
    name: { value: 'Grand final', source: 'sidecar' },
    map: { value: 'q2dm1', source: 'demo' },
    mod: { value: 'baseq2', source: 'demo' },
    gamemode: { value: 'ctf', source: 'sidecar' },
    sides: { value: [{ team: 'Red', players: ['Alice'] }, { team: 'Blue', players: ['Bob'] }], source: 'sidecar' },
    date: { value: Date.UTC(2024, 0, 1, 12, 0, 0), source: 'sidecar' },
    pov: { value: null, source: null },
    host: { value: null, source: null },
  },
}

function renderPanel(row: DemoRow = BASE_ROW, onClose: () => void = () => {}) {
  render(createElement(DemoDetailPanel, { row, onClose, onRowPatched: () => {}, onRenamed: () => {} }))
}

describe('DemoDetailPanel', () => {
  it('the panel shows each value with its source as text', async () => {
    sidecarRead.mockResolvedValue({ ok: true, value: { state: { state: 'ok' }, values: {} } } satisfies Outcome<{
      state: { state: string }
      values: Record<string, unknown>
    }>)

    renderPanel()

    const nameField = screen.getByTestId('replays-detail-field-name')
    expect(nameField.textContent).toContain('Grand final')
    expect(nameField.textContent).toContain('set by you')

    const mapField = screen.getByTestId('replays-detail-field-map')
    expect(mapField.textContent).toContain('q2dm1')
    expect(mapField.textContent).toContain('from the demo')

    const sidesField = screen.getByTestId('replays-detail-field-sides')
    expect(sidesField.textContent).toContain('Red vs Blue')

    await waitFor(() => expect(sidecarRead).toHaveBeenCalledWith(BASE_ROW.id))
  })

  it('renders itemized sidecar issues when the live read reports an error', async () => {
    sidecarRead.mockResolvedValue({
      ok: true,
      value: {
        state: { state: 'error', issues: [{ kind: 'invalidJson', key: 'replays.sidecar.issue.invalidJson', params: { line: 1, column: 2 } }] },
        values: {},
      },
    })

    renderPanel()

    await waitFor(() => expect(screen.getByTestId('replays-detail-sidecar-issues')).toBeTruthy())
    expect(screen.getByTestId('replays-detail-sidecar-issues').textContent).toContain('valid JSON')
  })

  it('an mvd2 row states who the camera follows; a dm2 row does not', () => {
    sidecarRead.mockResolvedValue({ ok: true, value: { state: { state: 'none' }, values: {} } })
    renderPanel({ ...BASE_ROW, fileName: 'team.mvd2', format: 'mvd2', gzip: false })
    expect(screen.getByTestId('demo-detail-mvd2-note').textContent).toContain('cmd chase <player>')
    cleanup()
    renderPanel({ ...BASE_ROW, fileName: 'tourney.mvd2.gz', format: 'mvd2', gzip: true })
    expect(screen.getByTestId('demo-detail-mvd2-note')).toBeTruthy()
    cleanup()
    renderPanel(BASE_ROW)
    expect(screen.queryByTestId('demo-detail-mvd2-note')).toBeNull()
  })

  it('close calls onClose', () => {
    sidecarRead.mockResolvedValue({ ok: true, value: { state: { state: 'none' }, values: {} } })
    const onClose = vi.fn()
    renderPanel(BASE_ROW, onClose)
    screen.getByTestId('replays-detail-close').click()
    expect(onClose).toHaveBeenCalled()
  })
})
