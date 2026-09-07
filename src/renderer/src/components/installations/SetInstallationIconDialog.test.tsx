// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Installation } from '@shared/types'
import { initI18n } from '../../i18n'
import { useLauncher } from '../../store/useLauncher'
import { SHIPPED_ICONS } from '../../lib/installation-icons'
import { SetInstallationIconDialog } from './SetInstallationIconDialog'

/**
 * Story 067 D6, AC6: "a failed outcome shows a translated message and keeps the dialog open."
 *
 * `SetInstallationIconDialog` imports the real `useLauncher` store (not a mock, mirroring
 * `CreateInstallationDialog.test.ts` rather than `InstallationTile.test.tsx`) - its import chain
 * reaches `lib/bridge.ts`, which resolves `window.q2` at *module* scope and throws without a
 * stub, so `window.q2.invoke` is faked here and the store's own `setInstallationIcon` action
 * (a thin wrapper around `invoke('installations:setIcon', ...)`) runs for real against it. That
 * lets this test drive the exact failure path the dialog has to render inline: a failed
 * `Outcome` coming back from IPC, with nothing mocked out of the dialog itself.
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
  useLauncher.setState({ installations: [makeInstallation()] })
})

afterEach(() => {
  cleanup()
})

describe('SetInstallationIconDialog', () => {
  it('review finding F1: a successful pick drops any cached data: URL for this installation', async () => {
    // Regression test for a real bug found in review: `setInstallationIcon`/`pickInstallationIconFile`
    // used to be thin `invoke(...)` wrappers with no effect on `useLauncher`'s `iconDataUrls` cache.
    // Re-picking a custom image (the shape stays `{ kind: 'custom' }`, so nothing about the
    // *installation record* looks different) left every mounted tile showing the *previous*
    // `data:` URL from cache until the app was restarted. `useLauncher.setState` seeds a stale
    // cache entry the same way a tile that already rendered the old icon would have populated it.
    useLauncher.setState({
      installations: [makeInstallation({ icon: { kind: 'custom' } })],
      iconDataUrls: { 'inst-1': 'data:image/png;base64,OLD' },
    })
    invokeMock.mockImplementation((channel: string) => {
      if (channel === 'installations:pickIconFile') {
        return Promise.resolve({ ok: true, value: makeInstallation({ icon: { kind: 'custom' } }) })
      }
      return Promise.resolve(null)
    })

    render(createElement(SetInstallationIconDialog, { installationId: 'inst-1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Choose image file…' }))

    // The click handler is fire-and-forget (`onClick={() => void chooseFile()}`); `waitFor` retries
    // until the mocked pick's promise resolves and the store's invalidation has run.
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('installations:pickIconFile', { installationId: 'inst-1' })
    })
    expect('inst-1' in useLauncher.getState().iconDataUrls).toBe(false)
  })

  it('AC6: a failed outcome shows a translated message and keeps the dialog open', async () => {
    invokeMock.mockImplementation((channel: string) => {
      if (channel === 'installations:setIcon') {
        return Promise.resolve({
          ok: false,
          error: { key: 'installations.error.iconUnsupportedFormat' },
        })
      }
      return Promise.resolve(null)
    })

    render(createElement(SetInstallationIconDialog, { installationId: 'inst-1' }))

    expect(SHIPPED_ICONS.length).toBeGreaterThan(0)
    const firstShipped = SHIPPED_ICONS[0]
    const iconButton = screen.getByRole('button', {
      name: `\u201c${firstShipped.id}\u201d icon`,
    })
    fireEvent.click(iconButton)

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('Only PNG and JPEG images can be used as an icon.')

    // The dialog stays open: its title is still rendered and the installation's icon
    // is untouched (the store never applied the failed outcome).
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(useLauncher.getState().installations[0]?.icon).toBeUndefined()
  })
})
