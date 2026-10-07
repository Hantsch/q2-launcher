// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { DemoRow } from '@shared/modules/replays'
import { initI18n } from '../../../i18n'

let TagDemosDialog: typeof import('./TagDemosDialog').TagDemosDialog
let MoveDemosDialog: typeof import('./MoveDemosDialog').MoveDemosDialog

beforeAll(async () => {
  await initI18n('en')
  ;({ TagDemosDialog } = await import('./TagDemosDialog'))
  ;({ MoveDemosDialog } = await import('./MoveDemosDialog'))
})

afterEach(() => cleanup())

const demo = (id: string, tags: string[], archiveEntry: string | null = null): DemoRow =>
  ({ id, archiveEntry, sidecar: { values: { tags } } }) as unknown as DemoRow

describe('TagDemosDialog', () => {
  it('counts each tag across the selection and sends only the staged changes', () => {
    const onSubmit = vi.fn()
    render(
      createElement(TagDemosDialog, {
        rows: [demo('a', ['Final', 'lan']), demo('b', ['final']), demo('z', ['zip-only'], 'x.dm2')],
        allTags: [],
        onSubmit,
        onClose: vi.fn(),
      }),
    )
    const chips = screen.getAllByTestId('replays-bulk-tag-chip')
    expect(chips.map((chip) => chip.textContent)).toEqual(['Final2 of 2', 'lan1 of 2'])
    expect(screen.getByTestId('replays-bulk-tag-apply')).toHaveProperty('disabled', true)

    fireEvent.click(within(chips[1]!).getByRole('button'))
    const input = screen.getByTestId('replays-tag-input')
    fireEvent.change(input, { target: { value: 'epic' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.click(screen.getByTestId('replays-bulk-tag-apply'))
    expect(onSubmit).toHaveBeenCalledWith(['epic'], ['lan'])
  })
})

describe('MoveDemosDialog', () => {
  const folders = [
    { sourceKey: 's', source: 'Root', path: [], archive: false },
    { sourceKey: 's', path: ['sub'], archive: false },
    { sourceKey: 's', path: ['sub', 'deep'], archive: false },
    { sourceKey: 's', path: ['pack.zip'], archive: true },
  ]

  it('lists writable folders indented, marks the open one and moves into a clicked one', () => {
    const onMove = vi.fn()
    render(
      createElement(MoveDemosDialog, {
        folders,
        current: { sourceKey: 's', path: ['sub'] },
        count: 2,
        onMove,
        onClose: vi.fn(),
      }),
    )
    const rows = screen.getAllByTestId('replays-bulk-move-folder')
    expect(rows.map((row) => row.getAttribute('data-path'))).toEqual(['', 'sub', 'sub/deep'])
    expect(rows[1]!.getAttribute('aria-current')).toBe('true')
    fireEvent.click(rows[2]!)
    expect(onMove).toHaveBeenCalledWith({
      kind: 'folder',
      folderId: { sourceKey: 's', path: ['sub', 'deep'] },
    })
    fireEvent.click(screen.getByTestId('replays-bulk-move-pick'))
    expect(onMove).toHaveBeenLastCalledWith({ kind: 'pick' })
  })
})
