// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DemoRow as DemoRowData } from '@shared/modules/replays'
import { VirtualDemoList, type DemoListItem } from './VirtualDemoList'

vi.mock('./DemoListHeader', () => ({ DemoListHeader: () => null }))
vi.mock('./DemoRow', () => ({
  DemoRow: ({ row }: { row: DemoRowData }) =>
    createElement('div', null, [
      createElement('input', {
        key: 'box',
        type: 'checkbox',
        'data-testid': 'replays-row-select',
        'aria-label': row.id,
      }),
      createElement('input', { key: 'text', type: 'text', 'data-testid': 'other-field' }),
    ]),
}))

afterEach(() => cleanup())

const items: DemoListItem[] = ['a', 'b'].map((id) => ({
  kind: 'demo',
  row: { id } as unknown as DemoRowData,
}))

function renderList(selectedIds: string[]) {
  const onSelectAll = vi.fn()
  const onClearSelection = vi.fn()
  render(
    createElement(VirtualDemoList, {
      items,
      onOpenFolder: vi.fn(),
      onRenameFolder: vi.fn(),
      onDemoMenu: vi.fn(),
      onFolderMenu: vi.fn(),
      selectedIds,
      onSelect: vi.fn(),
      onToggle: vi.fn(),
      onRange: vi.fn(),
      onSelectAll,
      onClearSelection,
      sort: null,
      onSort: vi.fn(),
    }),
  )
  return { onSelectAll, onClearSelection }
}

describe('VirtualDemoList keyboard', () => {
  it('Ctrl+A and Escape still work while a row checkbox has focus', () => {
    const { onSelectAll, onClearSelection } = renderList(['a'])
    const box = screen.getAllByTestId('replays-row-select')[0]!
    fireEvent.keyDown(box, { key: 'a', ctrlKey: true })
    fireEvent.keyDown(box, { key: 'Escape' })
    expect(onSelectAll).toHaveBeenCalledWith(['a', 'b'])
    expect(onClearSelection).toHaveBeenCalledTimes(1)
  })

  it('leaves Ctrl+A and Escape to a text field inside a row', () => {
    const { onSelectAll, onClearSelection } = renderList(['a'])
    const field = screen.getAllByTestId('other-field')[0]!
    fireEvent.keyDown(field, { key: 'a', ctrlKey: true })
    fireEvent.keyDown(field, { key: 'Escape' })
    expect(onSelectAll).not.toHaveBeenCalled()
    expect(onClearSelection).not.toHaveBeenCalled()
  })

  it('Escape reaches the clear path with nothing selected so a shown outcome can be dismissed', () => {
    const { onClearSelection } = renderList([])
    fireEvent.keyDown(screen.getByTestId('replays-demo-scroll'), { key: 'Escape' })
    expect(onClearSelection).toHaveBeenCalledTimes(1)
  })
})
