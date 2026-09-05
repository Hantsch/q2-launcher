// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { initI18n } from '../../../i18n'
import type { ConfigAction } from '@shared/modules/config'
import { ControlsGrid } from './ControlsGrid'
import type { ControlsRowGroup } from '../lib/controls-row-groups'

/**
 * Story 053 D6: the group header's own rename/move/delete buttons - `ControlsGrid` itself only
 * owns whether a move button is enabled (first/last among *sub-category* groups, the ungrouped run
 * never counts) and which id/direction it reports; `ControlsTab` owns what happens after that
 * (covered by `ControlsTab.dialogs.test.ts`'s create/rename dialog tests instead, since the
 * mutation itself is a plain array splice with nothing left to assert once wired).
 */

function action(id: string): ConfigAction {
  return { id, categoryId: 'weapons', name: id, kind: 'bind', commands: [] }
}

beforeAll(async () => {
  await initI18n('en')
})

afterEach(() => {
  cleanup()
})

describe('ControlsGrid sub-category group header', () => {
  const groups: ControlsRowGroup[] = [
    { subcategory: null, entries: [{ kind: 'action', action: action('ungrouped-1') }] },
    { subcategory: { id: 'sub-1', name: 'Use weapon' }, entries: [{ kind: 'action', action: action('a1') }] },
    { subcategory: { id: 'sub-2', name: 'Cycling' }, entries: [] },
  ]

  it('renders every sub-category as its own header, including an empty one', () => {
    render(
      createElement(ControlsGrid, {
        ariaLabel: 'Controls',
        groups,
        rowCount: 1,
        boundCount: 0,
      }),
    )
    expect(screen.getByText('Use weapon')).toBeTruthy()
    expect(screen.getByText('Cycling')).toBeTruthy()
  })

  it('disables move-up on the first sub-category and move-down on the last, skipping the ungrouped run', () => {
    render(
      createElement(ControlsGrid, {
        ariaLabel: 'Controls',
        groups,
        rowCount: 1,
        boundCount: 0,
      }),
    )
    const upButtons = screen.getAllByRole('button', { name: 'Move sub-category up' }) as HTMLButtonElement[]
    const downButtons = screen.getAllByRole('button', {
      name: 'Move sub-category down',
    }) as HTMLButtonElement[]
    expect(upButtons[0]!.disabled).toBe(true)
    expect(downButtons[0]!.disabled).toBe(false)
    expect(upButtons[1]!.disabled).toBe(false)
    expect(downButtons[1]!.disabled).toBe(true)
  })

  it('reports the clicked sub-category’s id and direction to the caller', () => {
    const onMoveSubcategory = vi.fn()
    const onRenameSubcategory = vi.fn()
    const onDeleteSubcategory = vi.fn()
    render(
      createElement(ControlsGrid, {
        ariaLabel: 'Controls',
        groups,
        rowCount: 1,
        boundCount: 0,
        onMoveSubcategory,
        onRenameSubcategory,
        onDeleteSubcategory,
      }),
    )
    fireEvent.click(screen.getAllByRole('button', { name: 'Move sub-category down' })[0]!)
    expect(onMoveSubcategory).toHaveBeenCalledWith('sub-1', 'down')

    fireEvent.click(screen.getAllByRole('button', { name: 'Rename sub-category' })[1]!)
    expect(onRenameSubcategory).toHaveBeenCalledWith({ id: 'sub-2', name: 'Cycling' })

    fireEvent.click(screen.getAllByRole('button', { name: 'Delete sub-category' })[1]!)
    expect(onDeleteSubcategory).toHaveBeenCalledWith('sub-2')
  })
})
