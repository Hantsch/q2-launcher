// @vitest-environment jsdom
import { createElement } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
const sidecarWrite = vi.fn()

vi.mock('../client', () => ({
  sidecarRead: (demoId: string) => sidecarRead(demoId),
  sidecarWrite: (...args: unknown[]) => sidecarWrite(...args),
  revealDemo: vi.fn(async () => ({ ok: true, value: { ok: true } })),
  copyDemoPath: vi.fn(async () => ({ ok: true, value: { ok: true } })),
  renameDemo: vi.fn(async () => ({ ok: true, value: { ok: true } })),
}))

let DemoDetailPanel: typeof import('./DemoDetailPanel').DemoDetailPanel
let useDemoEditorStore: typeof import('../demo-editor-store').useDemoEditorStore

beforeAll(async () => {
  await initI18n('en')
  ;({ DemoDetailPanel } = await import('./DemoDetailPanel'))
  ;({ useDemoEditorStore } = await import('../demo-editor-store'))
})

afterEach(() => {
  cleanup()
  sidecarRead.mockReset()
  sidecarWrite.mockReset()
  useDemoEditorStore.setState({ selectedId: null, editingId: null, drafts: {}, pendingLeave: null })
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
  it('the panel shows the name as its title and the facts without provenance', async () => {
    sidecarRead.mockResolvedValue({ ok: true, value: { state: { state: 'ok' }, values: {} } } satisfies Outcome<{
      state: { state: string }
      values: Record<string, unknown>
    }>)

    renderPanel()

    expect(screen.getByTestId('replays-detail-title').textContent).toBe('Grand final')
    for (const id of ['name', 'source', 'format', 'host']) {
      expect(screen.queryByTestId(`replays-detail-field-${id}`)).toBeNull()
    }
    const panelText = screen.getByTestId('replays-detail').textContent ?? ''
    expect(panelText).not.toContain('What the browser knows')
    for (const provenance of ['set by you', 'from the demo', 'from the file name', 'file time', 'guessed']) {
      expect(panelText).not.toContain(provenance)
    }

    expect(screen.getByTestId('replays-detail-field-map').textContent).toContain('q2dm1')
    expect(screen.getByTestId('replays-detail-field-gamemode').textContent).toContain('CTF')
    expect(screen.getByTestId('replays-detail-field-sides').textContent).toContain('Red vs Blue')
    expect(screen.getByTestId('replays-detail-facts-file')).toBeTruthy()
    expect(screen.getByTestId('replays-detail-facts-match')).toBeTruthy()

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

  it('reading mode shows description and tags when set', () => {
    sidecarRead.mockResolvedValue({ ok: true, value: { state: { state: 'none' }, values: {} } })
    renderPanel({
      ...BASE_ROW,
      sidecar: { state: 'ok', values: { description: '  Great match  ', tags: ['clutch', 'ctf'] } },
    })
    expect(screen.getByTestId('replays-detail-description').textContent).toBe('Great match')
    expect(screen.getByTestId('replays-detail-tags').textContent).toContain('clutch')
    expect(screen.getByTestId('replays-detail-tags').textContent).toContain('ctf')
  })

  it('reading mode omits empty description and tags', () => {
    sidecarRead.mockResolvedValue({ ok: true, value: { state: { state: 'none' }, values: {} } })
    renderPanel({ ...BASE_ROW, sidecar: { state: 'ok', values: { description: '   ', tags: [] } } })
    expect(screen.queryByTestId('replays-detail-description')).toBeNull()
    expect(screen.queryByTestId('replays-detail-tags')).toBeNull()
  })

  it('close calls onClose', () => {
    sidecarRead.mockResolvedValue({ ok: true, value: { state: { state: 'none' }, values: {} } })
    const onClose = vi.fn()
    renderPanel(BASE_ROW, onClose)
    screen.getByTestId('replays-detail-close').click()
    expect(onClose).toHaveBeenCalled()
  })

  it('the header offers Edit, Reveal, Copy path and Rename as icon buttons', () => {
    sidecarRead.mockResolvedValue({ ok: true, value: { state: { state: 'none' }, values: {} } })
    renderPanel()
    for (const id of ['replays-detail-edit', 'replays-demo-reveal', 'replays-demo-copy-path', 'demo-rename']) {
      const button = screen.getByTestId(id) as HTMLButtonElement
      expect(button.disabled).toBe(false)
      expect(button.getAttribute('aria-label')).toBeTruthy()
    }
    expect(screen.getByTestId('replays-detail-edit').getAttribute('aria-label')).toBe('Edit')
    expect(screen.queryByTestId('replays-archive-readonly-edit')).toBeNull()
  })

  it('an archive entry shows Edit disabled with the read-only reason as visible text', () => {
    sidecarRead.mockResolvedValue({ ok: true, value: { state: { state: 'none' }, values: {} } })
    renderPanel({ ...BASE_ROW, archiveEntry: { archivePath: 'pack.zip', entryPath: 'test.dm2' } } as DemoRow)
    const edit = screen.getByTestId('replays-detail-edit') as HTMLButtonElement
    expect(edit.disabled).toBe(true)
    const reason = screen.getByTestId('replays-archive-readonly-edit')
    expect(reason.textContent).toContain('read-only')
    expect(edit.getAttribute('aria-describedby')).toBe(reason.id)
    expect((screen.getByTestId('demo-rename') as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByTestId('replays-archive-readonly-rename').textContent).toContain("can't be renamed")
    // An archive entry cannot enter edit mode at all.
    fireEvent.click(edit)
    expect(screen.queryByTestId('replays-editor')).toBeNull()
    expect(screen.getByTestId('replays-detail-title')).toBeTruthy()
  })

  it('no separate notes form is rendered', () => {
    sidecarRead.mockResolvedValue({ ok: true, value: { state: { state: 'none' }, values: {} } })
    renderPanel()
    expect(screen.queryByTestId('replays-notes-slot')).toBeNull()
    expect(document.querySelector('[data-testid^="replays-editor"]')).toBeNull()
    expect(screen.getByTestId('replays-detail').querySelector('form, input, textarea')).toBeNull()
    expect(screen.getByTestId('replays-detail').textContent).not.toContain('Your notes')
  })

  it('Edit turns the facts into inputs in place, name in the header', () => {
    sidecarRead.mockResolvedValue({ ok: true, value: { state: { state: 'none' }, values: {} } })
    const row: DemoRow = {
      ...BASE_ROW,
      sidecar: { state: 'ok', values: { name: 'Grand final', gamemode: 'ctf', favourite: true, rating: 7 } },
    }
    useDemoEditorStore.getState().select(row.id)
    renderPanel(row)
    fireEvent.click(screen.getByTestId('replays-detail-edit'))

    // The header: the name input in the title slot, and Close - nothing else.
    const header = screen.getByTestId('replays-detail-header')
    const name = screen.getByTestId('replays-editor-name') as HTMLInputElement
    expect(header.contains(name)).toBe(true)
    expect(name.value).toBe('Grand final')
    expect(screen.queryByTestId('replays-detail-title')).toBeNull()
    expect(Array.from(header.querySelectorAll('button')).map((b) => b.getAttribute('data-testid'))).toEqual([
      'replays-detail-close',
    ])

    // The facts list became the form, in the same place: no reading-mode facts left.
    expect(screen.queryByTestId('replays-detail-facts-file')).toBeNull()
    expect(screen.queryByTestId('replays-detail-facts-match')).toBeNull()
    expect(screen.getByTestId('replays-editor-facts-file').textContent).toContain('demo1.dm2')
    expect((screen.getByTestId('replays-editor-gamemode') as HTMLInputElement).value).toBe('ctf')
    expect((screen.getByTestId('replays-editor-map') as HTMLInputElement).value).toBe('')
    expect((screen.getByTestId('replays-editor-map') as HTMLInputElement).placeholder).toBe('q2dm1')
    expect((screen.getByTestId('replays-editor-rating') as HTMLInputElement).value).toBe('7')
  })

  it('Cancel restores the values and writes nothing', () => {
    sidecarRead.mockResolvedValue({ ok: true, value: { state: { state: 'none' }, values: {} } })
    const row: DemoRow = { ...BASE_ROW, sidecar: { state: 'ok', values: { mod: 'lithium' } } }
    useDemoEditorStore.getState().select(row.id)
    renderPanel({ ...row, effective: { ...row.effective, mod: { value: 'lithium', source: 'sidecar' } } })

    fireEvent.click(screen.getByTestId('replays-detail-edit'))
    fireEvent.change(screen.getByTestId('replays-editor-mod'), { target: { value: 'typed but not kept' } })
    fireEvent.click(screen.getByTestId('replays-editor-cancel'))

    expect(screen.queryByTestId('replays-editor')).toBeNull()
    expect(screen.getByTestId('replays-detail-field-mod').textContent).toContain('lithium')
    expect(sidecarWrite).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('replays-detail-edit'))
    expect((screen.getByTestId('replays-editor-mod') as HTMLInputElement).value).toBe('lithium')
  })

  it('leaving a dirty edit asks first - the panel owns the discard dialog', () => {
    sidecarRead.mockResolvedValue({ ok: true, value: { state: { state: 'none' }, values: {} } })
    useDemoEditorStore.getState().select(BASE_ROW.id)
    renderPanel()
    fireEvent.click(screen.getByTestId('replays-detail-edit'))
    fireEvent.change(screen.getByTestId('replays-editor-mod'), { target: { value: 'lithium' } })

    act(() => useDemoEditorStore.getState().select('fedcba9876543210'))
    expect(screen.getByTestId('replays-discard-dialog')).toBeTruthy()
    fireEvent.click(screen.getByTestId('replays-discard-keep'))
    expect(screen.queryByTestId('replays-discard-dialog')).toBeNull()
    expect((screen.getByTestId('replays-editor-mod') as HTMLInputElement).value).toBe('lithium')

    act(() => useDemoEditorStore.getState().close())
    fireEvent.click(screen.getByTestId('replays-discard-confirm'))
    expect(useDemoEditorStore.getState().selectedId).toBeNull()
    expect(useDemoEditorStore.getState().drafts[BASE_ROW.id]).toBeUndefined()
    expect(sidecarWrite).not.toHaveBeenCalled()
  })
})
