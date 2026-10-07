// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServerListRow } from '@shared/modules/servers'
import { DEFAULT_SETTINGS, IDLE_LAUNCH_STATE } from '@shared/types'
import { initI18n } from '../../../i18n'
import { useLauncher } from '../../../store/useLauncher'
import { useJoinFlow } from './useJoinFlow'
import { makeInstallation } from '../../../../../test-support/fixtures'

const { invokeMock } = vi.hoisted(() => {
  const invokeMock = vi.fn()
  ;(globalThis as unknown as { q2: unknown }).q2 = {
    invoke: (...args: unknown[]) => invokeMock(...args),
    on: () => () => {},
  }
  return { invokeMock }
})

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

/** A caller that is not a button: it hands `start()` whichever row it is told to. */
function Harness({ rows }: { rows: ServerListRow[] }) {
  const { start, dialogs } = useJoinFlow()
  return createElement(
    'div',
    null,
    ...rows.map((row, i) =>
      createElement('button', { key: i, 'data-testid': `go-${i}`, onClick: () => start(row) }),
    ),
    dialogs,
  )
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

describe('useJoinFlow', () => {
  it('start() with a mismatching, password-protected row asks both before play()', async () => {
    render(createElement(Harness, { rows: [makeRow({ mod: 'ctf', needpass: true })] }))

    fireEvent.click(screen.getByTestId('go-0'))

    expect(screen.getByTestId('servers-join-mismatch')).toBeTruthy()
    expect(screen.queryByTestId('servers-join-password')).toBeNull()
    expect(invokeMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('servers-join-mismatch-confirm'))

    expect(screen.getByTestId('servers-join-password')).toBeTruthy()
    expect(invokeMock).not.toHaveBeenCalled()

    const input = screen.getByTestId('servers-join-password').querySelector('input')!
    fireEvent.change(input, { target: { value: 'sekret' } })
    fireEvent.click(screen.getByTestId('servers-join-password-submit'))

    await vi.waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('launch:start', {
        installationId: 'inst-1',
        connect: '1.2.3.4:27910',
        userinfo: { password: 'sekret' },
      })
    })
  })

  it('start() uses the row it was given, not an earlier one', async () => {
    useLauncher.setState({ installations: [makeInstallation({ activeGameDir: 'ctf' })] })
    render(
      createElement(Harness, {
        rows: [
          makeRow({ address: '1.2.3.4:27910', mod: 'ctf' }),
          makeRow({ address: '5.6.7.8:27920', mod: 'ctf' }),
        ],
      }),
    )

    fireEvent.click(screen.getByTestId('go-0'))
    await vi.waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        'launch:start',
        expect.objectContaining({ connect: '1.2.3.4:27910' }),
      )
    })

    invokeMock.mockClear()
    fireEvent.click(screen.getByTestId('go-1'))

    await vi.waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('launch:start', {
        installationId: 'inst-1',
        connect: '5.6.7.8:27920',
        userinfo: undefined,
      })
    })
    expect(invokeMock).toHaveBeenCalledTimes(1)
  })
})
