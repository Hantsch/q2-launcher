// @vitest-environment jsdom
import { createElement } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Installation } from '@shared/types'
import { IDLE_LAUNCH_STATE } from '@shared/types'
import { initI18n } from '../../i18n'
import { useLauncher } from '../../store/useLauncher'
import { RemoveInstallationDialog } from './RemoveInstallationDialog'

/**
 * Story 094 D3 acceptance tests for the removal chooser.
 *
 * Mirrors `SetInstallationIconDialog.test.tsx`: the real `useLauncher` store is used (not a mock)
 * so `removeInstallation`'s actual `invoke('installations:remove', ...)` wrapper runs, with only
 * `window.q2.invoke` faked. That lets AC2 assert the exact IPC payload the dialog produces instead
 * of a hand-mocked store action that could silently drift from the real one.
 */
const { invokeMock } = vi.hoisted(() => {
  const invokeMock = vi.fn()
  ;(globalThis as unknown as { q2: unknown }).q2 = {
    invoke: (...args: unknown[]) => invokeMock(...args),
    on: () => () => {},
  }
  return { invokeMock }
})

function makeInstallation(overrides: Partial<Installation> = {}): Installation {
  return {
    id: 'inst-1',
    name: 'Test Install',
    rootPath: 'C:\\Games\\Q2',
    engineKind: 'r1q2',
    launchArgs: [],
    activeGameDir: '',
    source: 'manual',
    status: 'ok',
    checks: [],
    gameDirs: [],
    favorite: false,
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    totalPlaytimeSeconds: 0,
    ...overrides,
  }
}

beforeAll(async () => {
  await initI18n('en')
})

beforeEach(() => {
  invokeMock.mockReset()
  invokeMock.mockResolvedValue({ ok: true, value: makeInstallation() })
  useLauncher.setState({
    installations: [makeInstallation()],
    launch: IDLE_LAUNCH_STATE,
  })
})

afterEach(() => {
  cleanup()
})

describe('RemoveInstallationDialog', () => {
  it('AC1: a removable installation offers both outcomes', () => {
    render(createElement(RemoveInstallationDialog, { installationId: 'inst-1' }))

    expect(screen.getByTestId('remove-dialog-entry-only-option')).toBeTruthy()
    expect(screen.getByTestId('remove-dialog-disk-option')).toBeTruthy()
  })

  it('AC2: the disk confirm step names the rootPath and invokes nothing before its own confirm', async () => {
    render(createElement(RemoveInstallationDialog, { installationId: 'inst-1' }))

    fireEvent.click(screen.getByTestId('remove-dialog-disk-option'))

    expect(screen.getByTestId('remove-dialog-disk-path').textContent).toBe('C:\\Games\\Q2')
    expect(invokeMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('remove-dialog-delete-folder-confirm'))

    await vi.waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('installations:remove', {
        id: 'inst-1',
        deleteFromDisk: true,
      })
    })
  })

  it('the entry-only choice still submits with no deleteFromDisk flag', async () => {
    render(createElement(RemoveInstallationDialog, { installationId: 'inst-1' }))

    fireEvent.click(screen.getByText('Remove from launcher'))

    await vi.waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('installations:remove', { id: 'inst-1' })
    })
  })

  it('AC4: a store-managed installation shows only the entry-only outcome plus the store note', () => {
    useLauncher.setState({
      installations: [makeInstallation({ source: 'steam' })],
      launch: IDLE_LAUNCH_STATE,
    })

    render(createElement(RemoveInstallationDialog, { installationId: 'inst-1' }))

    expect(screen.getByTestId('remove-dialog-store-note')).toBeTruthy()
    expect(screen.queryByTestId('remove-dialog-disk-option')).toBeNull()
    expect(screen.queryByTestId('remove-dialog-entry-only-option')).toBeNull()
  })

  it('AC5: the disk option is disabled while this installation is running', () => {
    useLauncher.setState({
      installations: [makeInstallation()],
      launch: { ...IDLE_LAUNCH_STATE, installationId: 'inst-1', phase: 'running' },
    })

    render(createElement(RemoveInstallationDialog, { installationId: 'inst-1' }))

    const diskOption = screen.getByTestId('remove-dialog-disk-option') as HTMLButtonElement
    expect(diskOption.disabled).toBe(true)

    fireEvent.click(diskOption)
    expect(screen.queryByTestId('remove-dialog-disk-confirm-step')).toBeNull()
  })

  it('review fix: the game starting mid-dialog disables the delete-folder confirm too, not just the option row', () => {
    render(createElement(RemoveInstallationDialog, { installationId: 'inst-1' }))

    // Chosen while idle: the confirm step renders and `choice` is now 'delete-from-disk'.
    fireEvent.click(screen.getByTestId('remove-dialog-disk-option'))
    expect(screen.getByTestId('remove-dialog-disk-confirm-step')).toBeTruthy()

    // The game starts running while the dialog is still open - `choice` does not reset.
    act(() => {
      useLauncher.setState({
        installations: [makeInstallation()],
        launch: { ...IDLE_LAUNCH_STATE, installationId: 'inst-1', phase: 'running' },
      })
    })

    const confirmButton = screen.getByTestId(
      'remove-dialog-delete-folder-confirm',
    ) as HTMLButtonElement
    expect(confirmButton.disabled).toBe(true)

    fireEvent.click(confirmButton)
    expect(invokeMock).not.toHaveBeenCalled()
  })
})
