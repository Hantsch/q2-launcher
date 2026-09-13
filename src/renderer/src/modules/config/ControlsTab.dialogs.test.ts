// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { initI18n } from '../../i18n'
import { DeleteCategoryDialog } from './components/DeleteCategoryDialog'
import {
  CreateActionDialog,
  CreateCategoryDialog,
  CreateSubcategoryDialog,
  RenameSubcategoryDialog,
} from './ControlsTab'

/**
 * Story 052 D9: "Add action" and "New category" each gain a suggestions list next to their
 * existing free-form path, and deleting a category with entries opens a new delete-or-move modal
 * instead of the old plain confirm. These tests cover the accept criteria directly named by the
 * deliverable: both dialogs still list suggestions and still allow a free-form entry, and the
 * delete dialog states what happens to the entries and defaults to move.
 *
 * `createElement`, not JSX: this test module keeps the `.ts` extension so it stays inside
 * `vitest.config.ts`'s existing `src/**\/*.{test,spec}.ts` include pattern - `profile-changes.test.ts`
 * already sets this precedent for a renderer test that mounts real components.
 */

// `ControlsTab`'s import chain reaches `lib/client.ts` -> `lib/bridge.ts`, which resolves
// `window.q2` at *module* scope and throws when it is missing - so the bridge has to exist before
// this file's own imports are evaluated, which is what `vi.hoisted` is for. Nothing in these
// dialogs calls it (they hand their result to a callback and let the caller save), so a stub that
// only has to exist is enough.
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

describe('CreateCategoryDialog', () => {
  it("offers the template's three categories as suggestions, alongside the free-form field", () => {
    render(
      createElement(CreateCategoryDialog, {
        existingCategoryIds: [],
        onClose: () => {},
        onSubmit: async () => true,
      }),
    )
    expect(screen.getByRole('button', { name: 'Movement' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Weapons' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Weapon dropping' })).toBeTruthy()
    // The free-form field is still there.
    expect(screen.getByLabelText('Name')).toBeTruthy()
  })

  it('submits the picked template id when a suggestion is clicked', () => {
    const onSubmit = vi.fn().mockResolvedValue(true)
    render(
      createElement(CreateCategoryDialog, { existingCategoryIds: [], onClose: () => {}, onSubmit }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Weapons' }))
    expect(onSubmit).toHaveBeenCalledWith({ name: '', templateId: 'weapons' })
  })

  it('does not suggest a template category the profile already has', () => {
    render(
      createElement(CreateCategoryDialog, {
        existingCategoryIds: ['movement', 'weapons', 'drops'],
        onClose: () => {},
        onSubmit: async () => true,
      }),
    )
    expect(screen.queryByRole('button', { name: 'Movement' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Weapons' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Weapon dropping' })).toBeNull()
  })

  it('still creates a free-form category by typing a name', () => {
    const onSubmit = vi.fn().mockResolvedValue(true)
    render(
      createElement(CreateCategoryDialog, { existingCategoryIds: [], onClose: () => {}, onSubmit }),
    )
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'My own category' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create category' }))
    expect(onSubmit).toHaveBeenCalledWith({ name: 'My own category' })
  })
})

describe('CreateActionDialog', () => {
  it('offers catalogue actions as suggestions, each with its known command', () => {
    render(createElement(CreateActionDialog, { onClose: () => {}, onSubmit: () => {} }))
    // "Forward" is a movement catalogue row (`movement:forward`, command `+forward`).
    const row = screen.getByRole('button', { name: /Forward/ })
    expect(row.textContent).toContain('+forward')
  })

  it('stores the catalogue-derived name, not the translated label, for a picked suggestion', () => {
    // Review finding 8: `ConfigAction.name` is persisted and written into the .cfg comment, so it
    // must be the same locale-independent `nameForCatalogRow` value `STANDARD_TEMPLATE` and the
    // migration seed - the translated "Forward" only ever appears in the picker above.
    const onSubmit = vi.fn()
    render(createElement(CreateActionDialog, { onClose: () => {}, onSubmit }))
    fireEvent.click(screen.getByRole('button', { name: /Forward/ }))
    expect(onSubmit).toHaveBeenCalledWith('+forward', 'bind', 'movement:forward')
  })

  it('still creates a free-form action by typing a name and picking a kind', () => {
    const onSubmit = vi.fn()
    render(createElement(CreateActionDialog, { onClose: () => {}, onSubmit }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'My own action' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create action' }))
    // The free-form path passes no `catalogId` at all - `handleCreateAction` only adds the field
    // when one is given.
    expect(onSubmit).toHaveBeenCalledWith('My own action', 'bind')
  })

  it('keeps the Name field and the catalogue filter distinguishable by accessible name', () => {
    // Review finding 2: two `ui:flow` scripts fill this Name field to create a custom action. They
    // used to locate it as the dialog's *first* text input - which D9's catalogue filter took over,
    // so they filled the filter, `canSubmit` stayed false and "Create action" was permanently
    // disabled. They go by label now, so the two inputs must stay separately addressable.
    render(createElement(CreateActionDialog, { onClose: () => {}, onSubmit: () => {} }))
    const nameField = screen.getByLabelText('Name')
    const filterField = screen.getByLabelText('Filter actions…')
    expect(nameField.tagName).toBe('INPUT')
    expect(nameField).not.toBe(filterField)
  })
})

describe('CreateSubcategoryDialog', () => {
  it('creates a sub-category by typing a name', () => {
    const onSubmit = vi.fn().mockResolvedValue(true)
    render(createElement(CreateSubcategoryDialog, { onClose: () => {}, onSubmit }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Cycling' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create sub-category' }))
    expect(onSubmit).toHaveBeenCalledWith('Cycling')
  })

  it('disables submit while the name is blank', () => {
    render(createElement(CreateSubcategoryDialog, { onClose: () => {}, onSubmit: async () => true }))
    expect(
      (screen.getByRole('button', { name: 'Create sub-category' }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })
})

describe('RenameSubcategoryDialog', () => {
  it('starts pre-filled with the sub-category’s current name and submits the edited one', () => {
    const onSubmit = vi.fn().mockResolvedValue(true)
    render(
      createElement(RenameSubcategoryDialog, {
        subcategory: { id: 'sub-1', name: 'Use weapon' },
        onClose: () => {},
        onSubmit,
      }),
    )
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Use weapon')
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Fire modes' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSubmit).toHaveBeenCalledWith('Fire modes')
  })
})

describe('DeleteCategoryDialog', () => {
  const otherCategories = [
    { id: 'weapons', label: 'Weapons' },
    { id: 'drops', label: 'Weapon dropping' },
  ]

  it('defaults to move, with the first other category as the target', () => {
    render(
      createElement(DeleteCategoryDialog, {
        categoryLabel: 'Movement',
        entryCount: 3,
        otherCategories,
        onClose: () => {},
        onConfirm: () => {},
      }),
    )
    expect((screen.getByRole('radio', { name: /Move/ }) as HTMLInputElement).checked).toBe(true)
    expect(screen.getByText(/3 entries will move to “Weapons”/)).toBeTruthy()
  })

  it('lets the target category be changed, and confirming "move" reports it', () => {
    const onConfirm = vi.fn()
    render(
      createElement(DeleteCategoryDialog, {
        categoryLabel: 'Movement',
        entryCount: 3,
        otherCategories,
        onClose: () => {},
        onConfirm,
      }),
    )
    fireEvent.change(screen.getByLabelText('Move entries to'), { target: { value: 'drops' } })
    fireEvent.click(screen.getByRole('button', { name: 'Delete category' }))
    expect(onConfirm).toHaveBeenCalledWith('move', 'drops')
  })

  it('confirming "delete" reports the entries will be deleted, with no target', () => {
    const onConfirm = vi.fn()
    render(
      createElement(DeleteCategoryDialog, {
        categoryLabel: 'Movement',
        entryCount: 3,
        otherCategories,
        onClose: () => {},
        onConfirm,
      }),
    )
    fireEvent.click(screen.getByRole('radio', { name: /Delete its entries/ }))
    expect(screen.getByText(/3 entries will be deleted with this category/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Delete category' }))
    expect(onConfirm).toHaveBeenCalledWith('delete', undefined)
  })

  it('offers no move choice, and defaults to delete, when there is no other category', () => {
    render(
      createElement(DeleteCategoryDialog, {
        categoryLabel: 'Movement',
        entryCount: 2,
        otherCategories: [],
        onClose: () => {},
        onConfirm: () => {},
      }),
    )
    expect(screen.queryByRole('radio', { name: /Move/ })).toBeNull()
    expect(screen.getByText(/2 entries will be deleted with this category/)).toBeTruthy()
  })
})
