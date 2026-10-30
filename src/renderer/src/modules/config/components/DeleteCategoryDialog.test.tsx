// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { initI18n } from '../../../i18n'
import { DeleteCategoryDialog } from './DeleteCategoryDialog'

beforeAll(async () => {
  await initI18n('en')
})

afterEach(cleanup)

const OTHERS = [
  { id: 'a', label: 'Alpha' },
  { id: 'b', label: 'Beta' },
]

function dialog(otherCategories: { id: string; label: string }[]) {
  return createElement(DeleteCategoryDialog, {
    categoryLabel: 'Gone',
    entryCount: 3,
    otherCategories,
    onClose: () => {},
    onConfirm: () => {},
  })
}

function confirmButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Delete category' }) as HTMLButtonElement
}

describe('DeleteCategoryDialog', () => {
  it('the confirm stays disabled once the chosen move target is gone', () => {
    const { rerender } = render(dialog(OTHERS))
    expect(confirmButton().disabled).toBe(false)

    rerender(dialog([{ id: 'b', label: 'Beta' }]))
    expect(confirmButton().disabled).toBe(true)
  })

  it('the confirm stays enabled in delete mode even when the move target is gone', () => {
    const { rerender } = render(dialog(OTHERS))
    fireEvent.click(screen.getByRole('radio', { name: 'Delete its entries with it' }))

    rerender(dialog([{ id: 'b', label: 'Beta' }]))
    expect(confirmButton().disabled).toBe(false)
  })
})
