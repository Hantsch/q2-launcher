// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServerListRow } from '@shared/modules/servers'
import type { Installation } from '@shared/types'
import { DEFAULT_SETTINGS, IDLE_LAUNCH_STATE } from '@shared/types'
import { initI18n } from '../../../i18n'
import { useLauncher } from '../../../store/useLauncher'
import { JoinServerButton } from './JoinServerButton'

/**
 * Story 125 D4 acceptance tests. Mirrors `RemoveInstallationDialog.test.tsx`: the real `useLauncher`
 * store is used (not a mocked store) so `play()`'s actual `invoke('launch:start', ...)` wrapper
 * runs, with only `window.q2.invoke` faked - this lets the tests assert the exact IPC payload the
 * join flow produces.
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

function makeRow(overrides: Partial<ServerListRow> = {}): ServerListRow {
  return {
    address: '1.2.3.4:27910',
    origins: ['manual'],
    status: 'online',
    lastSeenAt: null,
    favourite: false,
    ...overrides,
  }
}

beforeAll(async () => {
  await initI18n('en')
})

beforeEach(() => {
  invokeMock.mockReset()
  invokeMock.mockResolvedValue({ ok: true, value: IDLE_LAUNCH_STATE })
  useLauncher.setState({
    installations: [makeInstallation()],
    settings: { ...DEFAULT_SETTINGS, activeInstallationId: 'inst-1' },
    launch: IDLE_LAUNCH_STATE,
  })
})

afterEach(() => {
  cleanup()
})

describe('JoinServerButton', () => {
  it('calls launch:start with the active installation and the normalised address', async () => {
    render(createElement(JoinServerButton, { row: makeRow({ address: '1.2.3.4:27910' }) }))

    fireEvent.click(screen.getByTestId('servers-join'))

    await vi.waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('launch:start', {
        installationId: 'inst-1',
        connect: '1.2.3.4:27910',
        userinfo: undefined,
      })
    })
  })

  it('an address that fails validation shows its reason and never calls launch:start', () => {
    render(createElement(JoinServerButton, { row: makeRow({ address: 'not a valid address' }) }))

    fireEvent.click(screen.getByTestId('servers-join'))

    expect(screen.getByTestId('servers-join-refused').textContent).toBeTruthy()
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('a mod mismatch warns naming both mods, and join anyway launches', async () => {
    useLauncher.setState({
      installations: [makeInstallation({ activeGameDir: '' })],
    })
    render(createElement(JoinServerButton, { row: makeRow({ mod: 'ctf' }) }))

    fireEvent.click(screen.getByTestId('servers-join'))

    const mismatch = screen.getByTestId('servers-join-mismatch')
    expect(mismatch.textContent).toContain('ctf')
    expect(mismatch.textContent).toContain('baseq2')
    expect(invokeMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('servers-join-mismatch-confirm'))

    await vi.waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('launch:start', {
        installationId: 'inst-1',
        connect: '1.2.3.4:27910',
        userinfo: undefined,
      })
    })
  })

  it('cancelling a mismatch aborts the join', () => {
    useLauncher.setState({ installations: [makeInstallation({ activeGameDir: '' })] })
    render(createElement(JoinServerButton, { row: makeRow({ mod: 'ctf' }) }))

    fireEvent.click(screen.getByTestId('servers-join'))
    fireEvent.click(screen.getByTestId('servers-join-mismatch-cancel'))

    expect(screen.queryByTestId('servers-join-mismatch')).toBeNull()
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('no mismatch launches without a warning', async () => {
    useLauncher.setState({ installations: [makeInstallation({ activeGameDir: 'ctf' })] })
    render(createElement(JoinServerButton, { row: makeRow({ mod: 'ctf' }) }))

    fireEvent.click(screen.getByTestId('servers-join'))

    expect(screen.queryByTestId('servers-join-mismatch')).toBeNull()
    await vi.waitFor(() => {
      expect(invokeMock).toHaveBeenCalled()
    })
  })

  it('an unknown server mod does not warn', async () => {
    useLauncher.setState({ installations: [makeInstallation({ activeGameDir: 'ctf' })] })
    render(createElement(JoinServerButton, { row: makeRow({ mod: undefined }) }))

    fireEvent.click(screen.getByTestId('servers-join'))

    expect(screen.queryByTestId('servers-join-mismatch')).toBeNull()
    await vi.waitFor(() => {
      expect(invokeMock).toHaveBeenCalled()
    })
  })

  it('a password server asks before launch:start, and cancel never calls it', () => {
    render(createElement(JoinServerButton, { row: makeRow({ needpass: true }) }))

    fireEvent.click(screen.getByTestId('servers-join'))

    expect(screen.getByTestId('servers-join-password')).toBeTruthy()
    expect(invokeMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('servers-join-password-cancel'))
    expect(screen.queryByTestId('servers-join-password')).toBeNull()
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('the password goes into userinfo, never into connect or extraArgs', async () => {
    render(createElement(JoinServerButton, { row: makeRow({ needpass: true }) }))

    fireEvent.click(screen.getByTestId('servers-join'))
    const input = screen.getByTestId('servers-join-password').querySelector('input')!

    // Submit stays disabled until the value passes `parseUserinfoValue`.
    expect((screen.getByTestId('servers-join-password-submit') as HTMLButtonElement).disabled).toBe(
      true,
    )

    fireEvent.change(input, { target: { value: 'sekret' } })
    expect((screen.getByTestId('servers-join-password-submit') as HTMLButtonElement).disabled).toBe(
      false,
    )

    fireEvent.click(screen.getByTestId('servers-join-password-submit'))

    await vi.waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('launch:start', {
        installationId: 'inst-1',
        connect: '1.2.3.4:27910',
        userinfo: { password: 'sekret' },
      })
    })
  })

  it('without an active installation join is disabled with a visible reason', () => {
    useLauncher.setState({
      settings: { ...DEFAULT_SETTINGS, activeInstallationId: null },
    })
    render(createElement(JoinServerButton, { row: makeRow() }))

    expect((screen.getByTestId('servers-join') as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByTestId('servers-join-no-installation').textContent).toBeTruthy()
  })

  // Story 126 D3: spectate mode goes through the same flow, just gated on `spectatorPass`
  // (never `needpass`) and with its own password prompt copy.
  it('spectate goes through the join flow', async () => {
    useLauncher.setState({ installations: [makeInstallation({ activeGameDir: '' })] })
    render(
      createElement(JoinServerButton, {
        row: makeRow({ mod: 'ctf', spectatorPass: true }),
        mode: 'spectate',
      }),
    )

    fireEvent.click(screen.getByTestId('servers-spectate'))

    // Same mod-mismatch warning as join.
    const mismatch = screen.getByTestId('servers-join-mismatch')
    expect(mismatch.textContent).toContain('ctf')
    expect(mismatch.textContent).toContain('baseq2')
    fireEvent.click(screen.getByTestId('servers-join-mismatch-confirm'))

    // Spectator-specific password prompt copy (title + label both say "Spectator password").
    expect(screen.getAllByText('Spectator password').length).toBeGreaterThanOrEqual(2)

    const input = screen.getByTestId('servers-join-password').querySelector('input')!
    fireEvent.change(input, { target: { value: 'sekret' } })
    fireEvent.click(screen.getByTestId('servers-join-password-submit'))

    await vi.waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('launch:start', {
        installationId: 'inst-1',
        connect: '1.2.3.4:27910',
        userinfo: { password: 'sekret' },
        spectate: true,
      })
    })
  })

  it('spectate with no spectatorPass skips the password prompt and launches straight away', async () => {
    render(
      createElement(JoinServerButton, {
        row: makeRow({ spectatorPass: undefined, needpass: true }),
        mode: 'spectate',
      }),
    )

    fireEvent.click(screen.getByTestId('servers-spectate'))

    expect(screen.queryByTestId('servers-join-password')).toBeNull()
    await vi.waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('launch:start', {
        installationId: 'inst-1',
        connect: '1.2.3.4:27910',
        userinfo: undefined,
        spectate: true,
      })
    })
  })
})
