// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { mockClient } from '../../../test-support/mock-client'
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

vi.mock('../client', (importOriginal) =>
  mockClient<typeof import('../client')>(importOriginal, {
    sidecarRead: (demoId: string) => sidecarRead(demoId),
    sidecarWrite: (...args: unknown[]) => sidecarWrite(...args),
    revealDemo: vi.fn(async () => ({ ok: true, value: { ok: true } })) as never,
    copyDemoPath: vi.fn(async () => ({ ok: true, value: { ok: true } })) as never,
    renameDemo: vi.fn(async () => ({ ok: true, value: { ok: true } })) as never,
  }),
)

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
  useDemoEditorStore.setState({ selectedId: null, drafts: {}, quickPending: {} })
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
  roster: null,
  fileTime: { birthtimeMs: 0, mtimeMs: 0 },
  folder: [],
  nameFacts: null,
  sidecar: { state: 'ok', values: { favourite: true, rating: 7 } },
  effective: {
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
    pov: { value: null, source: null },
    host: { value: null, source: null },
  },
}

function renderPanel(row: DemoRow = BASE_ROW, onClose: () => void = () => {}) {
  render(
    createElement(DemoDetailPanel, {
      row,
      onClose,
      onRowPatched: () => {},
      onRename: () => {},
      onMove: () => {},
      onDelete: () => {},
    }),
  )
}

describe('DemoDetailPanel', () => {
  it('the detail panel has no play or play-anyway button', async () => {
    sidecarRead.mockResolvedValue({ ok: true, value: { state: { state: 'ok' }, values: {} } })

    renderPanel()

    // Story 180 D2 (AC7): playing moved to the action bar's View - the panel offers neither.
    expect(screen.queryByTestId('replays-demo-play')).toBeNull()
    expect(screen.queryByTestId('replays-demo-play-anyway')).toBeNull()
    const buttons = screen.getAllByRole('button').map((button) => button.textContent ?? '')
    expect(buttons.some((label) => /\bplay\b/i.test(label))).toBe(false)
    await waitFor(() => expect(sidecarRead).toHaveBeenCalledWith(BASE_ROW.id))
  })

  it('the panel shows the name as its title and the facts without provenance', async () => {
    sidecarRead.mockResolvedValue({
      ok: true,
      value: { state: { state: 'ok' }, values: {} },
    } satisfies Outcome<{
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
    for (const provenance of [
      'set by you',
      'from the demo',
      'from the file name',
      'file time',
      'guessed',
    ]) {
      expect(panelText).not.toContain(provenance)
    }

    expect((screen.getByTestId('replays-detail-input-map') as HTMLInputElement).value).toBe('q2dm1')
    expect((screen.getByTestId('replays-detail-input-gamemode') as HTMLInputElement).value).toBe(
      'CTF',
    )
    expect(screen.getByTestId('replays-detail-field-sides').textContent).toContain('Red')
    expect(screen.getByTestId('replays-detail-field-sides').textContent).toContain('Blue')
    expect(screen.getByTestId('replays-detail-facts-file')).toBeTruthy()
    expect(screen.getByTestId('replays-detail-facts-match')).toBeTruthy()

    await waitFor(() => expect(sidecarRead).toHaveBeenCalledWith(BASE_ROW.id))
  })

  it('renders itemized sidecar issues when the live read reports an error', async () => {
    sidecarRead.mockResolvedValue({
      ok: true,
      value: {
        state: {
          state: 'error',
          issues: [
            {
              kind: 'invalidJson',
              key: 'replays.sidecar.issue.invalidJson',
              params: { line: 1, column: 2 },
            },
          ],
        },
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

  it('shows the description and tags that are set', () => {
    sidecarRead.mockResolvedValue({ ok: true, value: { state: { state: 'none' }, values: {} } })
    renderPanel({
      ...BASE_ROW,
      sidecar: { state: 'ok', values: { description: 'Great match', tags: ['clutch', 'ctf'] } },
    })
    const description = screen.getByTestId(
      'replays-detail-input-description',
    ) as HTMLTextAreaElement
    expect(description.value).toBe('Great match')
    expect(screen.getByTestId('replays-detail-tags').textContent).toContain('clutch')
    expect(screen.getByTestId('replays-detail-tags').textContent).toContain('ctf')
  })

  it('close calls onClose', () => {
    sidecarRead.mockResolvedValue({ ok: true, value: { state: { state: 'none' }, values: {} } })
    const onClose = vi.fn()
    renderPanel(BASE_ROW, onClose)
    screen.getByTestId('replays-detail-close').click()
    expect(onClose).toHaveBeenCalled()
  })

  it('the detail is one view: no Edit, Save, Cancel or discard dialog', () => {
    sidecarRead.mockResolvedValue({ ok: true, value: { state: { state: 'none' }, values: {} } })
    useDemoEditorStore.getState().select(BASE_ROW.id)
    renderPanel()
    for (const id of ['replays-detail-edit', 'replays-editor-save', 'replays-editor-cancel']) {
      expect(screen.queryByTestId(id)).toBeNull()
    }
    for (const id of ['replays-demo-reveal', 'replays-demo-copy-path', 'demo-rename']) {
      expect((screen.getByTestId(id) as HTMLButtonElement).disabled).toBe(false)
    }
    expect(screen.queryByTestId('replays-archive-readonly-edit')).toBeNull()
    expect(screen.getByTestId('replays-detail').querySelector('form')).toBeNull()
  })

  it('an archive entry shows the same view read-only with its reason as visible text', () => {
    sidecarRead.mockResolvedValue({ ok: true, value: { state: { state: 'none' }, values: {} } })
    renderPanel({
      ...BASE_ROW,
      archiveEntry: { archivePath: 'pack.zip', entryPath: 'test.dm2' },
      sidecar: { state: 'ok', values: { tags: ['clutch'] } },
    } as DemoRow)
    expect(screen.getByTestId('replays-archive-readonly-edit').textContent).toContain('read-only')
    expect(screen.getByTestId('replays-archive-readonly-rename').textContent).toContain(
      "can't be renamed",
    )
    expect((screen.getByTestId('demo-rename') as HTMLButtonElement).disabled).toBe(true)
    for (const field of ['name', 'date', 'map', 'mod', 'gamemode']) {
      expect(screen.getByTestId(`replays-detail-input-${field}`).tagName).toBe('SPAN')
    }
    expect(screen.getByTestId('replays-detail-tags').textContent).toContain('clutch')
    expect(screen.getByTestId('replays-detail-tags').querySelector('input')).toBeNull()
  })

  it('every text field is an input in place and the name sits in the header', () => {
    sidecarRead.mockResolvedValue({ ok: true, value: { state: { state: 'none' }, values: {} } })
    renderPanel({
      ...BASE_ROW,
      sidecar: { state: 'ok', values: { name: 'Grand final', gamemode: 'ctf' } },
    })
    const name = screen.getByTestId('replays-detail-input-name') as HTMLInputElement
    expect(screen.getByTestId('replays-detail-header').contains(name)).toBe(true)
    expect(name.value).toBe('Grand final')
    for (const field of ['date', 'map', 'mod', 'gamemode']) {
      expect(screen.getByTestId(`replays-detail-input-${field}`).tagName).toBe('INPUT')
    }
    expect(screen.getByTestId('replays-detail-input-description').tagName).toBe('TEXTAREA')
    expect(screen.getByTestId('replays-detail-field-fileName').textContent).toContain('demo1.dm2')
  })

  it('leaving a field saves only that field and keeps favourite and rating', async () => {
    const values = { favourite: true, rating: 6 }
    sidecarRead.mockResolvedValue({ ok: true, value: { state: { state: 'ok' }, values } })
    sidecarWrite.mockResolvedValue({ ok: true, value: { status: 'saved', state: 'written' } })
    const onRowPatched = vi.fn()
    render(
      createElement(DemoDetailPanel, {
        row: { ...BASE_ROW, sidecar: { state: 'ok', values } },
        onClose: () => {},
        onRowPatched,
        onRename: () => {},
        onMove: () => {},
        onDelete: () => {},
      }),
    )
    const mod = screen.getByTestId('replays-detail-input-mod')
    fireEvent.change(mod, { target: { value: 'lithium' } })
    fireEvent.blur(mod)

    await waitFor(() => expect(sidecarWrite).toHaveBeenCalledTimes(1))
    expect(sidecarWrite.mock.calls[0][1]).toEqual({ ...values, mod: 'lithium' })
    await waitFor(() => expect(onRowPatched).toHaveBeenCalled())
  })

  it('Escape reverts the typed text and writes nothing', () => {
    sidecarRead.mockResolvedValue({ ok: true, value: { state: { state: 'none' }, values: {} } })
    renderPanel({ ...BASE_ROW, sidecar: { state: 'ok', values: { mod: 'lithium' } } })
    const mod = screen.getByTestId('replays-detail-input-mod') as HTMLInputElement
    fireEvent.change(mod, { target: { value: 'typed but not kept' } })
    fireEvent.keyDown(mod, { key: 'Escape' })
    fireEvent.blur(mod)
    expect(mod.value).not.toBe('typed but not kept')
    expect(sidecarWrite).not.toHaveBeenCalled()
  })

  it('an impossible date is refused with its reason and writes nothing', () => {
    sidecarRead.mockResolvedValue({ ok: true, value: { state: { state: 'none' }, values: {} } })
    renderPanel()
    const date = screen.getByTestId('replays-detail-input-date')
    fireEvent.change(date, { target: { value: '2024-13-45 99:99' } })
    fireEvent.blur(date)
    expect(screen.getByTestId('replays-detail-input-date-error').textContent).toContain('real date')
    expect(sidecarWrite).not.toHaveBeenCalled()
  })

  it('the sides field saves when focus leaves it', async () => {
    const values = { sides: [{ team: 'Red', players: ['Alice'] }] }
    sidecarRead.mockResolvedValue({ ok: true, value: { state: { state: 'ok' }, values } })
    sidecarWrite.mockResolvedValue({ ok: true, value: { status: 'saved', state: 'written' } })
    renderPanel({ ...BASE_ROW, sidecar: { state: 'ok', values } })
    fireEvent.click(screen.getByTestId('replays-detail-sides-edit'))
    fireEvent.change(screen.getByTestId('replays-side-0-team'), { target: { value: 'Crimson' } })
    fireEvent.blur(screen.getByTestId('replays-side-0-team'), { relatedTarget: document.body })
    await waitFor(() => expect(sidecarWrite).toHaveBeenCalledTimes(1))
    expect(sidecarWrite.mock.calls[0][1]).toEqual({
      sides: [{ team: 'Crimson', players: ['Alice'] }],
    })
    expect(screen.queryByTestId('replays-detail-sides-editor')).toBeNull()
  })

  it('a refused sides save keeps the editor open with its reason, and Escape discards it', async () => {
    const values = { sides: [{ team: 'Red', players: ['Alice'] }] }
    sidecarRead.mockResolvedValue({ ok: true, value: { state: { state: 'ok' }, values } })
    sidecarWrite.mockResolvedValue({ ok: false, error: { key: 'replays.sidecar.error.write' } })
    renderPanel({ ...BASE_ROW, sidecar: { state: 'ok', values } })
    fireEvent.click(screen.getByTestId('replays-detail-sides-edit'))
    const team = screen.getByTestId('replays-side-0-team') as HTMLInputElement
    fireEvent.change(team, { target: { value: 'Crimson' } })
    fireEvent.blur(team, { relatedTarget: document.body })
    await waitFor(() => expect(screen.getByTestId('replays-detail-sides-error')).toBeTruthy())
    expect((screen.getByTestId('replays-side-0-team') as HTMLInputElement).value).toBe('Crimson')
    fireEvent.keyDown(screen.getByTestId('replays-side-0-team'), { key: 'Escape' })
    expect(screen.queryByTestId('replays-detail-sides-editor')).toBeNull()
  })

  it('Escape reverts the sides field', () => {
    const values = { sides: [{ team: 'Red', players: ['Alice'] }] }
    sidecarRead.mockResolvedValue({ ok: true, value: { state: { state: 'ok' }, values } })
    renderPanel({ ...BASE_ROW, sidecar: { state: 'ok', values } })
    fireEvent.click(screen.getByTestId('replays-detail-sides-edit'))
    const team = screen.getByTestId('replays-side-0-team')
    fireEvent.change(team, { target: { value: 'Crimson' } })
    fireEvent.keyDown(team, { key: 'Escape' })
    expect(screen.queryByTestId('replays-detail-sides-editor')).toBeNull()
    expect(sidecarWrite).not.toHaveBeenCalled()
  })

  it('adding a tag writes it through the store', async () => {
    sidecarRead.mockResolvedValue({
      ok: true,
      value: { state: { state: 'ok' }, values: { tags: ['old'] } },
    })
    sidecarWrite.mockResolvedValue({ ok: true, value: { status: 'saved', state: 'written' } })
    renderPanel({ ...BASE_ROW, sidecar: { state: 'ok', values: { tags: ['old'] } } })
    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: 'clutch' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(sidecarWrite).toHaveBeenCalledTimes(1))
    expect((sidecarWrite.mock.calls[0][1] as { tags: string[] }).tags).toEqual(['old', 'clutch'])
  })

  it('the header favourite toggle reports aria-pressed and calls quickEdit with the flipped value', () => {
    sidecarRead.mockResolvedValue({ ok: true, value: { state: { state: 'ok' }, values: {} } })
    const quickEdit = vi.fn(async () => {})
    useDemoEditorStore.setState({ quickEdit } as never)
    renderPanel()
    const toggle = screen.getByTestId('replays-detail-favourite')
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    expect(toggle.getAttribute('aria-label')).toBe('Favourite Grand final')
    expect(toggle.querySelector('svg')?.getAttribute('class')).toContain('fill-flame-500')
    fireEvent.click(toggle)
    expect(quickEdit).toHaveBeenCalledWith(BASE_ROW.id, { favourite: false }, expect.any(Function))
    cleanup()
    renderPanel({ ...BASE_ROW, sidecar: { state: 'ok', values: {} } })
    const off = screen.getByTestId('replays-detail-favourite')
    expect(off.getAttribute('aria-pressed')).toBe('false')
    expect(off.querySelector('svg')?.getAttribute('class')).not.toContain('fill-flame-500')
    fireEvent.click(off)
    expect(quickEdit).toHaveBeenLastCalledWith(
      BASE_ROW.id,
      { favourite: true },
      expect.any(Function),
    )
  })

  it("an archive entry's favourite toggle is disabled and described by the visible read-only reason", () => {
    sidecarRead.mockResolvedValue({ ok: true, value: { state: { state: 'none' }, values: {} } })
    renderPanel({
      ...BASE_ROW,
      archiveEntry: { archivePath: 'pack.zip', entryPath: 'test.dm2' },
    } as DemoRow)
    const toggle = screen.getByTestId('replays-detail-favourite') as HTMLButtonElement
    expect(toggle.disabled).toBe(true)
    const reason = screen.getByTestId('replays-archive-readonly-edit')
    expect(reason.textContent).toContain('read-only')
    expect(toggle.getAttribute('aria-describedby')).toBe(reason.id)
    expect(screen.getAllByTestId('replays-archive-readonly-edit')).toHaveLength(1)
  })
})
