// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { initI18n } from '../../../i18n'
import type { ConfigAction, ConfigActionCategory } from '@shared/modules/config'
import { ActionEditor } from './ActionEditor'

/**
 * Story 053 D7: the sub-category select in `ActionEditor` - scoped to `action`'s own category,
 * with an explicit "no sub-category" option, and hidden entirely when the category has none.
 *
 * `createElement`, not JSX: keeps this test module inside the `.ts` include pattern
 * `ControlsTab.dialogs.test.ts` already established for a renderer test that mounts real
 * components.
 */

// `ActionEditor` itself never touches `window.q2`, but its import chain (via `ControlsTab`-adjacent
// modules) can reach code that resolves it at module scope - stub it before anything is imported,
// same reasoning `ControlsTab.dialogs.test.ts` documents.
vi.hoisted(() => {
  ;(globalThis as unknown as { q2: unknown }).q2 = {
    invoke: () => Promise.reject(new Error('IPC is not available in this test')),
    on: () => () => {},
  }
})

beforeAll(async () => {
  await initI18n('en')
})

afterEach(() => {
  cleanup()
})

const baseAction: ConfigAction = {
  id: 'action-1',
  categoryId: 'cat-1',
  name: '+forward',
  kind: 'bind',
  commands: [],
}

const categoryWithSubcategories: ConfigActionCategory = {
  id: 'cat-1',
  name: 'Movement',
  subcategories: [
    { id: 'sub-1', name: 'Walking' },
    { id: 'sub-2', name: 'Swimming' },
  ],
}

const categoryWithoutSubcategories: ConfigActionCategory = {
  id: 'cat-1',
  name: 'Movement',
}

describe('ActionEditor sub-category select', () => {
  it('hides the control entirely when the category has no sub-categories', () => {
    render(
      createElement(ActionEditor, {
        action: baseAction,
        actions: [baseAction],
        category: categoryWithoutSubcategories,
        onClose: () => {},
        onSave: () => {},
      }),
    )
    expect(screen.queryByLabelText('Sub-category')).toBeNull()
  })

  it('lists the category’s own sub-categories, in order, plus "No sub-category", and moves the entry into one on save', () => {
    const onSave = vi.fn()
    render(
      createElement(ActionEditor, {
        action: baseAction,
        actions: [baseAction],
        category: categoryWithSubcategories,
        onClose: () => {},
        onSave,
      }),
    )
    const select = screen.getByLabelText('Sub-category') as HTMLSelectElement
    const optionLabels = Array.from(select.options).map((option) => option.text)
    expect(optionLabels).toEqual(['No sub-category', 'Walking', 'Swimming'])

    fireEvent.change(select, { target: { value: 'sub-2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ subcategoryId: 'sub-2' }))
  })

  it('moves an entry back out of its sub-category when "No sub-category" is picked', () => {
    const onSave = vi.fn()
    const grouped: ConfigAction = { ...baseAction, subcategoryId: 'sub-1' }
    render(
      createElement(ActionEditor, {
        action: grouped,
        actions: [grouped],
        category: categoryWithSubcategories,
        onClose: () => {},
        onSave,
      }),
    )
    const select = screen.getByLabelText('Sub-category') as HTMLSelectElement
    expect(select.value).toBe('sub-1')

    fireEvent.change(select, { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ subcategoryId: undefined }))
  })
})
