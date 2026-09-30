// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { DemoRow } from '@shared/modules/replays'
import { initI18n } from '../../../i18n'

/**
 * Stories 155/178. Mirrors `DemoDetailPanel.test.tsx`'s stubbed-client idiom (`vi.mock('../client')`):
 * the editor's store calls `sidecarWrite`/`sidecarRead` through that module. The editor only renders
 * while its demo has a draft in edit mode, so every test enters edit mode through the store first.
 */

const sidecarRead = vi.fn()
const sidecarWrite = vi.fn()

vi.mock('../client', () => ({
  sidecarRead: (...args: unknown[]) => sidecarRead(...args),
  sidecarWrite: (...args: unknown[]) => sidecarWrite(...args),
}))

let DemoDetailEditor: typeof import('./DemoDetailEditor').DemoDetailEditor
let DemoDetailNameInput: typeof import('./DemoDetailEditor').DemoDetailNameInput
let useDemoEditorStore: typeof import('../demo-editor-store').useDemoEditorStore

beforeAll(async () => {
  await initI18n('en')
  ;({ DemoDetailEditor, DemoDetailNameInput } = await import('./DemoDetailEditor'))
  ;({ useDemoEditorStore } = await import('../demo-editor-store'))
})

afterEach(() => {
  cleanup()
  sidecarRead.mockReset()
  sidecarWrite.mockReset()
  useDemoEditorStore.setState({ selectedId: null, editingId: null, drafts: {}, pendingLeave: null })
})

const ROW: DemoRow = {
  id: '0123456789abcdef',
  fileName: 'demo1.dm2',
  format: 'dm2',
  gzip: false,
  source: { kind: 'extraFolder', path: '/demos' },
  archiveEntry: null,
  map: 'q2dm1',
  unparsableReason: null,
  readable: true,
  unreadable: null,
  gameDir: null,
  pov: null,
  players: [],
  durationMs: 65_000,
  fileTime: { birthtimeMs: 0, mtimeMs: 0 },
  nameFacts: null,
  sidecar: { state: 'none', values: {} },
  effective: {
    name: { value: 'duel alice bob', source: 'name' },
    map: { value: 'q2dm1', source: 'demo' },
    mod: { value: 'baseq2', source: 'demo' },
    gamemode: { value: null, source: null },
    sides: { value: null, source: null },
    date: { value: new Date(2024, 0, 2, 13, 45, 10).getTime(), source: 'file' },
    pov: { value: null, source: null },
    host: { value: null, source: null },
  },
}

function renderEditor(row: DemoRow = ROW, onRowPatched = vi.fn()) {
  useDemoEditorStore.getState().select(row.id)
  useDemoEditorStore.getState().startEdit(row.id, row.sidecar.values)
  render(
    createElement(
      'div',
      null,
      createElement(DemoDetailNameInput, { row }),
      createElement(DemoDetailEditor, { row, onRowPatched, readOnlyText: { duration: '1:05' } }),
    ),
  )
  return onRowPatched
}

describe('DemoDetailEditor', () => {
  it('a failed save shows its reason', async () => {
    sidecarWrite.mockResolvedValue({
      ok: false,
      error: { key: 'replays.sidecar.error.notWritable', params: { folder: 'D:\readonly-demos' } },
    })
    const onRowPatched = renderEditor()

    const save = screen.getByTestId('replays-editor-save') as HTMLButtonElement
    expect(save.disabled).toBe(true)

    fireEvent.change(screen.getByTestId('replays-editor-name'), { target: { value: 'Grand final' } })
    expect(save.disabled).toBe(false)
    fireEvent.click(save)

    const error = await screen.findByTestId('replays-editor-save-error')
    expect(error.textContent).toContain('D:\readonly-demos')
    expect(error.textContent).toContain('not writable')
    expect(sidecarRead).not.toHaveBeenCalled()
    expect(onRowPatched).not.toHaveBeenCalled()
    // The draft is kept, so the user can fix the folder and save again.
    await waitFor(() => expect((screen.getByTestId('replays-editor-name') as HTMLInputElement).value).toBe('Grand final'))
  })

  it('Save is disabled until something changes and while the date is invalid, with the reason as text', () => {
    renderEditor()
    const save = screen.getByTestId('replays-editor-save') as HTMLButtonElement
    expect(save.disabled).toBe(true)
    expect(screen.queryByTestId('replays-editor-error-date')).toBeNull()

    const date = screen.getByTestId('replays-editor-date') as HTMLInputElement
    fireEvent.change(date, { target: { value: '2026-02-30 10:00' } })
    expect(save.disabled).toBe(true)
    const reason = screen.getByTestId('replays-editor-error-date')
    expect(reason.textContent).toBe('Enter a real date and time as YYYY-MM-DD HH:MM.')
    expect(date.getAttribute('aria-invalid')).toBe('true')
    expect(date.getAttribute('aria-describedby')).toBe(reason.id)

    fireEvent.change(date, { target: { value: '2026-02-28 10:00' } })
    expect(screen.queryByTestId('replays-editor-error-date')).toBeNull()
    expect(save.disabled).toBe(false)
  })

  it('every editable field shows even when empty, laid out as the facts rows', () => {
    renderEditor()
    for (const id of ['name', 'date', 'map', 'mod', 'gamemode', 'description']) {
      expect(screen.getByTestId(`replays-editor-${id}`)).toBeTruthy()
    }
    expect(screen.getByTestId('replays-sides-add')).toBeTruthy()
    const file = screen.getByTestId('replays-editor-facts-file')
    expect(file.textContent).toContain('File name')
    expect(file.textContent).toContain('demo1.dm2')
    expect(file.textContent).toContain('Length')
    expect(file.textContent).toContain('1:05')
    expect(file.textContent).toContain('Recorded')
    expect(screen.getByTestId('replays-editor-facts-match').textContent).toContain('Gamemode')
  })

  it('an empty field shows the lower-source value as placeholder without a source prefix', () => {
    renderEditor()
    const placeholder = (id: string): string => (screen.getByTestId(`replays-editor-${id}`) as HTMLInputElement).placeholder
    expect(placeholder('name')).toBe('duel alice bob')
    expect(placeholder('map')).toBe('q2dm1')
    expect(placeholder('mod')).toBe('baseq2')
    expect(placeholder('date')).toBe('2024-01-02 13:45')
    // Nothing known from any source: the generic hint.
    expect(placeholder('gamemode')).toBe('e.g. ctf')
    const text = document.body.innerHTML
    for (const provenance of ['from the demo', 'from the file name', 'file time']) {
      expect(text).not.toContain(provenance)
    }
  })

  it("a value that is the sidecar's own falls back to the generic hint", () => {
    renderEditor({
      ...ROW,
      sidecar: { state: 'ok', values: { map: 'q2dm1' } },
      effective: { ...ROW.effective, map: { value: 'q2dm1', source: 'sidecar' } },
    })
    const map = screen.getByTestId('replays-editor-map') as HTMLInputElement
    expect(map.value).toBe('q2dm1')
    expect(map.placeholder).toBe('e.g. q2dm1')
  })

  it('the header name input submits the editor form (Enter saves like every other text input)', () => {
    renderEditor()
    const name = screen.getByTestId('replays-editor-name') as HTMLInputElement
    const form = screen.getByTestId('replays-editor-save').closest('form') as HTMLFormElement
    expect(name.form).toBe(form)
  })
})
