// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { mockClient } from '../../test-support/mock-client'
import type { DemoRow } from '@shared/modules/replays'
import { initI18n } from '../../i18n'

/**
 * Story 157 D4. Mirrors `DemoNotesEditor.test.tsx`'s stubbed-client idiom (`vi.mock('./client')`):
 * the dialog calls `renameDemo`/`sidecarRead` through that module.
 */

const renameDemo = vi.fn()
const sidecarRead = vi.fn()

vi.mock('./client', (importOriginal) =>
  mockClient<typeof import('./client')>(importOriginal, {
    renameDemo: (...args: unknown[]) => renameDemo(...args),
    sidecarRead: (...args: unknown[]) => sidecarRead(...args),
  }),
)

let RenameDemoDialog: typeof import('./RenameDemoDialog').RenameDemoDialog

beforeAll(async () => {
  await initI18n('en')
  ;({ RenameDemoDialog } = await import('./RenameDemoDialog'))
})

afterEach(() => {
  cleanup()
  renameDemo.mockReset()
  sidecarRead.mockReset()
})

const BASE_ROW: DemoRow = {
  id: '0123456789abcdef',
  fileName: '2026-09-26-2130-q2dm1.dm2',
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
  sidecar: { state: 'ok', values: {} },
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

function renderDialog(onRenamed = vi.fn(), onClose = vi.fn()) {
  render(createElement(RenameDemoDialog, { demo: BASE_ROW, onClose, onRenamed }))
  return { onRenamed, onClose }
}

describe('RenameDemoDialog', () => {
  it('an invalid stem shows its inline reason and disables Save', () => {
    renderDialog()

    fireEvent.change(screen.getByTestId('demo-rename-input'), { target: { value: 'bad/name' } })

    expect(screen.getByTestId('demo-rename-error').textContent).toContain("Can't contain")
    expect((screen.getByTestId('demo-rename-save') as HTMLButtonElement).disabled).toBe(true)
    expect(renameDemo).not.toHaveBeenCalled()
  })

  it('a failed outcome with replays.rename.error.playing shows its text', async () => {
    renameDemo.mockResolvedValue({ ok: false, error: { key: 'replays.rename.error.playing' } })
    renderDialog()

    fireEvent.change(screen.getByTestId('demo-rename-input'), { target: { value: 'final-vs-tom' } })
    fireEvent.click(screen.getByTestId('demo-rename-save'))

    const error = await screen.findByTestId('demo-rename-error')
    expect(error.textContent).toContain('Cannot rename while playing')
  })

  it('a failed outcome with replays.rename.error.renameFailed shows its text', async () => {
    renameDemo.mockResolvedValue({
      ok: false,
      error: { key: 'replays.rename.error.renameFailed', params: { code: 'EBUSY' } },
    })
    renderDialog()

    fireEvent.change(screen.getByTestId('demo-rename-input'), { target: { value: 'final-vs-tom' } })
    fireEvent.click(screen.getByTestId('demo-rename-save'))

    const error = await screen.findByTestId('demo-rename-error')
    expect(error.textContent).toContain('Rename failed')
    expect(error.textContent).toContain('EBUSY')
  })

  it('a successful rename calls onRenamed', async () => {
    renameDemo.mockResolvedValue({
      ok: true,
      value: { demo: { ...BASE_ROW, id: 'fedcba9876543210', fileName: 'final-vs-tom.dm2' } },
    })
    sidecarRead.mockResolvedValue({ ok: true, value: { state: { state: 'none' }, values: {} } })
    const { onRenamed, onClose } = renderDialog()

    fireEvent.change(screen.getByTestId('demo-rename-input'), { target: { value: 'final-vs-tom' } })
    fireEvent.click(screen.getByTestId('demo-rename-save'))

    await vi.waitFor(() => expect(onRenamed).toHaveBeenCalled())
    expect(onRenamed).toHaveBeenCalledWith(
      '0123456789abcdef',
      expect.objectContaining({ id: 'fedcba9876543210', fileName: 'final-vs-tom.dm2' }),
    )
    expect(onClose).toHaveBeenCalled()
  })
})
