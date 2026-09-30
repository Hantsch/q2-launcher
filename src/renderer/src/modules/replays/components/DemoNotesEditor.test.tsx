// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { initI18n } from '../../../i18n'

/**
 * Story 155. Mirrors `DemoDetailPanel.test.tsx`'s stubbed-client idiom (`vi.mock('../client')`):
 * the editor's store calls `sidecarWrite`/`sidecarRead` through that module.
 */

const sidecarRead = vi.fn()
const sidecarWrite = vi.fn()

vi.mock('../client', () => ({
  sidecarRead: (...args: unknown[]) => sidecarRead(...args),
  sidecarWrite: (...args: unknown[]) => sidecarWrite(...args),
}))

let DemoNotesEditor: typeof import('./DemoNotesEditor').DemoNotesEditor
let useDemoEditorStore: typeof import('../demo-editor-store').useDemoEditorStore

beforeAll(async () => {
  await initI18n('en')
  ;({ DemoNotesEditor } = await import('./DemoNotesEditor'))
  ;({ useDemoEditorStore } = await import('../demo-editor-store'))
})

afterEach(() => {
  cleanup()
  sidecarRead.mockReset()
  sidecarWrite.mockReset()
  useDemoEditorStore.setState({ selectedId: null, drafts: {}, pendingLeave: null })
})

describe('DemoNotesEditor', () => {
  it('a failed save shows its reason', async () => {
    sidecarWrite.mockResolvedValue({
      ok: false,
      error: { key: 'replays.sidecar.error.notWritable', params: { folder: 'D:\readonly-demos' } },
    })
    const onRowPatched = vi.fn()
    render(
      createElement(DemoNotesEditor, {
        demoId: '0123456789abcdef',
        values: {},
        onRowPatched,
        disabledReason: null,
      }),
    )

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

  it('the map field placeholder shows the lower-source value and where it came from', () => {
    render(
      createElement(DemoNotesEditor, {
        demoId: '0123456789abcdef',
        values: {},
        onRowPatched: vi.fn(),
        disabledReason: null,
        mapField: { id: 'map', group: 'match', value: 'q2dm1', source: 'demo' },
      }),
    )

    const map = screen.getByTestId('replays-editor-map') as HTMLInputElement
    expect(map.placeholder).toContain('q2dm1')
    expect(map.placeholder).toContain('from the demo')
  })

  it('the map field placeholder falls back to the generic hint when the value is the sidecar\'s own', () => {
    render(
      createElement(DemoNotesEditor, {
        demoId: '0123456789abcdef',
        values: {},
        onRowPatched: vi.fn(),
        disabledReason: null,
        mapField: { id: 'map', group: 'match', value: 'q2dm1', source: 'sidecar' },
      }),
    )

    const map = screen.getByTestId('replays-editor-map') as HTMLInputElement
    expect(map.placeholder).toBe('e.g. q2dm1')
  })

  it('an archive-entry demo shows its read-only reason and disables the whole form', () => {
    render(
      createElement(DemoNotesEditor, {
        demoId: '0123456789abcdef',
        values: {},
        onRowPatched: vi.fn(),
        disabledReason: 'replays.archive.readOnly.edit',
      }),
    )

    const notice = screen.getByTestId('replays-archive-readonly-edit')
    expect(notice.textContent).toContain('read-only')

    const description = screen.getByTestId('replays-editor-description') as HTMLTextAreaElement
    expect(description.disabled).toBe(true)

    const save = screen.getByTestId('replays-editor-save') as HTMLButtonElement
    expect(save.disabled).toBe(true)

    const fieldset = description.closest('fieldset') as HTMLFieldSetElement
    expect(fieldset.disabled).toBe(true)
    expect(fieldset.getAttribute('aria-describedby')).toBe(notice.id)
  })
})
