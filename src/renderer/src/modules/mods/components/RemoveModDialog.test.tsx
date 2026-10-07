// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { mockClient } from '../../../test-support/mock-client'
import { initI18n } from '../../../i18n'

vi.hoisted(() => {
  // The job store behind useStartJob evaluates the preload bridge accessor.
  ;(globalThis as unknown as { q2: unknown }).q2 = {
    invoke: vi.fn(async () => ({ ok: true })),
    on: vi.fn(() => () => {}),
  }
})

const { previewRemoval, removeMod } = vi.hoisted(() => ({
  previewRemoval: vi.fn(async () => ({
    ok: true as const,
    value: {
      installationName: 'My Quake',
      modName: 'opentdm',
      gameDir: 'opentdm',
      changedFiles: ['opentdm.cfg'],
    },
  })),
  removeMod: vi.fn(async () => ({ ok: true as const, value: { jobId: 'job-9' } })),
}))
// Importing the real client module evaluates the preload bridge accessor.
vi.mock('../client', (importOriginal) =>
  mockClient<typeof import('../client')>(importOriginal, { previewRemoval, removeMod }),
)

const { RemoveModDialog } = await import('./RemoveModDialog')

beforeAll(async () => {
  await initI18n('en')
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('RemoveModDialog', () => {
  it('changed files default to keep and the choice reaches the remove call', async () => {
    const onStarted = vi.fn()
    const onClose = vi.fn()
    const view = () =>
      createElement(RemoveModDialog, {
        installationId: 'inst-1',
        modId: 'opentdm',
        displayName: 'OpenTDM',
        onClose,
        onStarted,
      })
    render(view())

    const list = await screen.findByTestId('mods-remove-changed-list')
    expect(list.textContent).toContain('opentdm.cfg')
    expect(screen.getByRole('dialog').textContent).toContain('Remove OpenTDM from My Quake?')
    expect((screen.getByTestId('mods-remove-changed-keep') as HTMLInputElement).checked).toBe(true)

    fireEvent.click(screen.getByTestId('mods-remove-confirm'))
    await waitFor(() => expect(removeMod).toHaveBeenCalledWith('inst-1', 'opentdm', 'keep'))
    await waitFor(() => expect(onStarted).toHaveBeenCalledWith('job-9'))

    cleanup()
    render(view())
    await screen.findByTestId('mods-remove-changed-list')
    fireEvent.click(screen.getByTestId('mods-remove-changed-delete'))
    fireEvent.click(screen.getByTestId('mods-remove-confirm'))
    await waitFor(() => expect(removeMod).toHaveBeenLastCalledWith('inst-1', 'opentdm', 'delete'))
  })
})
