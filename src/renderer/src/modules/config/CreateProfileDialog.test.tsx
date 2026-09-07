// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { ConfigProfile, CreateConfigProfileInput } from '@shared/modules/config'
import { initI18n } from '../../i18n'
import { CreateProfileDialog } from './CreateProfileDialog'

/**
 * Story 066 D6: the "Start from" select gains a second template option - "Standard template
 * (right-handed)"/"Standard template (left-handed)" in place of the old single "Standard template" -
 * alongside Empty and Import, four options in total. `createConfigProfile` is mocked (rather than
 * stubbing `window.q2` and letting a real IPC call reject, `AliasesTab.test.ts`'s own precedent for
 * this module) because these tests need to see exactly which `from` value each option sends, not
 * just that a create was attempted.
 */

let createCalls: CreateConfigProfileInput[] = []

vi.mock('./client', () => ({
  createConfigProfile: vi.fn(async (input: CreateConfigProfileInput) => {
    createCalls.push(input)
    return { ok: true, value: [] as ConfigProfile[] }
  }),
}))

beforeAll(async () => {
  await initI18n('en')
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  createCalls = []
})

function renderDialog(onWantImport = vi.fn()): { onCreated: ReturnType<typeof vi.fn>; onWantImport: ReturnType<typeof vi.fn> } {
  const onCreated = vi.fn()
  render(
    createElement(CreateProfileDialog, {
      onClose: () => {},
      onCreated,
      onWantImport,
    }),
  )
  return { onCreated, onWantImport }
}

describe('CreateProfileDialog', () => {
  it(
    'four start-from options render, each non-import choice wires to its own seed value on ' +
      'submit, and import hands off instead of creating directly (AC1)',
    async () => {
      const { onWantImport } = renderDialog()

      const select = screen.getByTestId('config-create-source') as HTMLSelectElement
      const options = [...select.options]
      expect(options.map((option) => ({ value: option.value, label: option.textContent }))).toEqual([
        { value: 'empty', label: 'Empty profile' },
        { value: 'template-right', label: 'Standard template (right-handed)' },
        { value: 'template-left', label: 'Standard template (left-handed)' },
        { value: 'import', label: 'Import from files' },
      ])

      const nameInput = screen.getByPlaceholderText('My profile')
      const submit = screen.getByTestId('config-create-submit')

      for (const seed of ['empty', 'template-right', 'template-left'] as const) {
        fireEvent.change(select, { target: { value: seed } })
        fireEvent.change(nameInput, { target: { value: `Profile ${seed}` } })
        fireEvent.click(submit)
        await waitFor(() =>
          expect(createCalls.at(-1)).toEqual({ name: `Profile ${seed}`, from: seed }),
        )
      }
      expect(createCalls).toHaveLength(3)
      expect(onWantImport).not.toHaveBeenCalled()

      fireEvent.change(select, { target: { value: 'import' } })
      fireEvent.click(submit)

      expect(onWantImport).toHaveBeenCalledTimes(1)
      // Import never reaches `createConfigProfile` - the count from the three seeds above is
      // unchanged.
      expect(createCalls).toHaveLength(3)
    },
  )

  it('shows the "identical for now" caption only while a template seed is selected', () => {
    renderDialog()
    const select = screen.getByTestId('config-create-source') as HTMLSelectElement
    const caption =
      'Both layouts are the same for now — distinct content arrives in a later update.'

    expect(screen.queryByText(caption)).toBeNull()

    fireEvent.change(select, { target: { value: 'template-right' } })
    expect(screen.getByText(caption)).toBeTruthy()

    fireEvent.change(select, { target: { value: 'template-left' } })
    expect(screen.getByText(caption)).toBeTruthy()

    fireEvent.change(select, { target: { value: 'empty' } })
    expect(screen.queryByText(caption)).toBeNull()
  })
})
