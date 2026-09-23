// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppInfo, Installation } from '@shared/types'
import { initI18n } from '../../i18n'
import { useLauncher } from '../../store/useLauncher'
import { RunnerSection } from './RunnerSection'

/**
 * Story 103 D7. `RunnerSection` imports the real `useLauncher` store (not a mock, mirroring
 * `SetInstallationIconDialog.test.tsx`) - its import chain reaches `lib/bridge.ts`, which resolves
 * `window.q2` at *module* scope and throws without a stub, so `window.q2.invoke` is faked here and
 * the store's own `updateInstallation` action (a thin wrapper around
 * `invoke('installations:update', ...)`) runs for real against it.
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
    rootPath: '/home/user/Games/Q2',
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

const linuxAppInfo: AppInfo = {
  appVersion: '1.2.3',
  electronVersion: '30.0.0',
  chromeVersion: '124.0.0',
  nodeVersion: '20.10.0',
  platform: 'linux',
  osVersion: '6.9.0',
  userDataPath: '/home/user/.config/q2-launcher',
  logPath: '/home/user/.config/q2-launcher/logs/main.log',
  isDev: false,
  isPackaged: true,
}

const RUNNERS = [
  { kind: 'native', id: 'native', labelKey: 'runner.kind.native', available: true },
  {
    kind: 'wine',
    id: 'wine',
    labelKey: 'runner.kind.wine',
    available: false,
    reasonKey: 'runner.unavailable.wine',
  },
]

beforeAll(async () => {
  await initI18n('en')
})

beforeEach(() => {
  invokeMock.mockReset()
  invokeMock.mockImplementation((channel: string) => {
    if (channel === 'installations:listRunners') {
      return Promise.resolve({ ok: true, value: RUNNERS })
    }
    if (channel === 'launch:plan') {
      return Promise.resolve({
        ok: true,
        value: {
          executablePath: '/home/user/Games/Q2/r1q2',
          args: [],
          workingDirectory: '/home/user/Games/Q2',
          preview: 'wine /home/user/Games/Q2/r1q2',
        },
      })
    }
    return Promise.resolve({ ok: true, value: null })
  })
  useLauncher.setState({ appInfo: linuxAppInfo, installations: [makeInstallation()] })
})

afterEach(() => {
  cleanup()
})

describe('RunnerSection', () => {
  it('an unavailable runner renders its reason as visible text', async () => {
    render(createElement(RunnerSection, { installation: makeInstallation() }))

    const wineOption = await screen.findByTestId('installation-runner-option-wine')
    expect((wineOption as HTMLButtonElement).disabled).toBe(true)

    // The reason must be actual DOM text (queried by text content), not only a `title` tooltip -
    // CLAUDE.md's platform-parity rule, first implementation in the app.
    const reason = screen.getByTestId('installation-runner-reason-wine')
    expect(reason.textContent).toBe('wine not found — install wine to run Windows builds')
    expect(
      screen.getByText('wine not found — install wine to run Windows builds'),
    ).toBeTruthy()
    expect(wineOption.getAttribute('title')).toBeNull()
  })

  it('renders on win32 with Native checked - Steam is a second real runner choice there too (story 104)', async () => {
    useLauncher.setState({
      appInfo: { ...linuxAppInfo, platform: 'win32' },
      installations: [makeInstallation()],
    })
    // No `runner` stored at all - a real, freshly-added installation never has one until a user
    // actively picks a runner. `resolveRunner()` (`src/main/services/runners.ts`) defaults an
    // unset choice to native; the renderer's checked state must mirror that default rather than
    // rendering nothing as selected.
    render(createElement(RunnerSection, { installation: makeInstallation() }))

    const nativeOption = await screen.findByTestId('installation-runner-option-native')
    expect(nativeOption.getAttribute('aria-checked')).toBe('true')
  })

  it('off win32, an installation with no stored runner checks nothing (native is not a universal default)', async () => {
    // `resolveRunner()`'s unset-choice default is platform- and executableKind-dependent off
    // win32 (wine/umu, not native) - the renderer must not default-check Native there, or it
    // would show a runner the preview below it does not actually match.
    render(createElement(RunnerSection, { installation: makeInstallation() }))

    const nativeOption = await screen.findByTestId('installation-runner-option-native')
    expect(nativeOption.getAttribute('aria-checked')).toBe('false')
    const wineOption = screen.getByTestId('installation-runner-option-wine')
    expect(wineOption.getAttribute('aria-checked')).toBe('false')
  })

  it('selecting an available runner calls installations:update with the new runner id', async () => {
    render(createElement(RunnerSection, { installation: makeInstallation() }))

    const nativeOption = await screen.findByTestId('installation-runner-option-native')
    expect((nativeOption as HTMLButtonElement).disabled).toBe(false)
    nativeOption.click()

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('installations:update', {
        id: 'inst-1',
        runner: 'native',
      })
    })
  })

  it('shows the resolved command from launch:plan', async () => {
    render(createElement(RunnerSection, { installation: makeInstallation() }))

    const preview = await screen.findByTestId('installation-runner-preview')
    expect(preview.textContent).toContain('wine /home/user/Games/Q2/r1q2')
  })

  it('re-fetches and updates the preview when the runner choice changes', async () => {
    // `launch:plan` doesn't carry which runner was picked - the main process resolves that from
    // the installation's persisted `runner` field, so this mock differentiates by call order, the
    // same way a real second fetch (triggered by a new `installation.runner`) would return a
    // different plan than the first.
    let planCalls = 0
    invokeMock.mockImplementation((channel: string) => {
      if (channel === 'installations:listRunners') {
        return Promise.resolve({ ok: true, value: RUNNERS })
      }
      if (channel === 'launch:plan') {
        planCalls += 1
        return Promise.resolve({
          ok: true,
          value: {
            executablePath: '/home/user/Games/Q2/r1q2',
            args: [],
            workingDirectory: '/home/user/Games/Q2',
            preview: planCalls === 1 ? 'wine /home/user/Games/Q2/r1q2' : 'native /home/user/Games/Q2/r1q2',
          },
        })
      }
      return Promise.resolve({ ok: true, value: null })
    })

    const { rerender } = render(
      createElement(RunnerSection, { installation: makeInstallation({ runner: 'wine' }) }),
    )

    const firstPreview = await screen.findByTestId('installation-runner-preview')
    expect(firstPreview.textContent).toContain('wine /home/user/Games/Q2/r1q2')

    // Simulate the store round-trip a real runner selection causes: `updateInstallation` writes
    // the choice, `installations:changed` pushes a fresh list, and the parent re-renders this
    // component with a new `installation` object whose `.runner` differs.
    rerender(createElement(RunnerSection, { installation: makeInstallation({ runner: 'native' }) }))

    await waitFor(() => {
      expect(screen.getByTestId('installation-runner-preview').textContent).toContain(
        'native /home/user/Games/Q2/r1q2',
      )
    })
  })

  it('scopes the container id to the installation so two rows never collide', async () => {
    render(
      createElement(
        'div',
        null,
        createElement(RunnerSection, { installation: makeInstallation({ id: 'inst-1' }) }),
        createElement(RunnerSection, { installation: makeInstallation({ id: 'inst-2' }) }),
      ),
    )

    await waitFor(() => {
      expect(document.getElementById('installation-runner-inst-1')).toBeTruthy()
      expect(document.getElementById('installation-runner-inst-2')).toBeTruthy()
    })
    // Both share the same testid by design (queries scope via `within(row)`), but the `id`
    // attribute must be page-unique - that's the actual HTML/DOM requirement this fix satisfies.
    expect(document.querySelectorAll('#installation-runner-inst-1').length).toBe(1)
    expect(document.querySelectorAll('#installation-runner-inst-2').length).toBe(1)
  })

  it('renders a failed launch:plan outcome as visible text instead of dropping it', async () => {
    invokeMock.mockImplementation((channel: string) => {
      if (channel === 'installations:listRunners') {
        return Promise.resolve({ ok: true, value: RUNNERS })
      }
      if (channel === 'launch:plan') {
        return Promise.resolve({
          ok: false,
          error: { key: 'launch.error.noRunner', params: { executable: 'quake2.exe' } },
        })
      }
      return Promise.resolve({ ok: true, value: null })
    })

    render(createElement(RunnerSection, { installation: makeInstallation() }))

    // Assert the resolved sentence, not just non-empty text - a raw, unresolved i18n key would
    // also satisfy a truthiness check, hiding a real i18n-resolution regression.
    const preview = await screen.findByTestId('installation-runner-preview')
    expect(preview.textContent).toBe(
      'quake2.exe is a Windows program and nothing on this machine can run it. Install wine or umu-run and pick it as the runner, or add this folder\'s game data to a native engine instead.',
    )
  })

  it('an unavailable steam option renders its reason as visible text', async () => {
    invokeMock.mockImplementation((channel: string) => {
      if (channel === 'installations:listRunners') {
        return Promise.resolve({
          ok: true,
          value: [
            ...RUNNERS,
            {
              kind: 'steam',
              id: 'steam',
              labelKey: 'runner.kind.steam',
              available: false,
              reasonKey: 'runner.unavailable.steamNotOwner',
            },
          ],
        })
      }
      if (channel === 'launch:plan') {
        return Promise.resolve({
          ok: true,
          value: {
            executablePath: '/home/user/Games/Q2/r1q2',
            args: [],
            workingDirectory: '/home/user/Games/Q2',
            preview: 'wine /home/user/Games/Q2/r1q2',
          },
        })
      }
      return Promise.resolve({ ok: true, value: null })
    })

    render(createElement(RunnerSection, { installation: makeInstallation() }))

    const steamOption = await screen.findByTestId('installation-runner-option-steam')
    expect((steamOption as HTMLButtonElement).disabled).toBe(true)

    const reason = screen.getByTestId('installation-runner-reason-steam')
    expect(reason.textContent).toBe(
      'this folder is not a Steam install — Steam can only start games it owns',
    )

    // The caveat paragraph is shown whenever the Steam option is in the list at all, regardless of
    // availability.
    expect(screen.getByTestId('installation-runner-steam-caveat')).toBeTruthy()
  })

  it('choosing a client writes steamClient', async () => {
    invokeMock.mockImplementation((channel: string) => {
      if (channel === 'installations:listRunners') {
        return Promise.resolve({
          ok: true,
          value: [
            ...RUNNERS,
            { kind: 'steam', id: 'steam', labelKey: 'runner.kind.steam', available: true },
          ],
        })
      }
      if (channel === 'launch:plan') {
        return Promise.resolve({
          ok: true,
          value: {
            executablePath: 'steam',
            args: [],
            workingDirectory: '/home/user/Games/Q2',
            preview: 'steam steam://launch/2320/client/2',
          },
        })
      }
      return Promise.resolve({ ok: true, value: null })
    })

    render(
      createElement(RunnerSection, {
        installation: makeInstallation({ runner: 'steam', steamAppId: '2320' }),
      }),
    )

    // Bug 3 (story 104 review): the client `Select` must have an accessible name - the adjacent
    // label text is not enough unless it is actually associated with the control.
    const clientSelect = await screen.findByRole('combobox', { name: /launch option/i })
    expect(clientSelect).toBe(screen.getByTestId('installation-runner-steam-client'))

    fireEvent.change(clientSelect, { target: { value: '1' } })

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('installations:update', {
        id: 'inst-1',
        steamClient: 1,
      })
    })
  })

  it('updates the previewed launch string when steamClient changes, with no remount needed', async () => {
    // Bug 1 (story 104 review): the preview effect must depend on `steamClient`, not just
    // `id`/`runner` - otherwise picking a different Steam client leaves the previous client's URL
    // on screen. Mirrors the "re-fetches ... runner choice changes" test above, but holds `id` and
    // `runner` fixed and varies only `steamClient` via `rerender`, simulating the same store round
    // trip (`updateInstallation` -> `installations:update` -> a fresh `installations:changed` list)
    // without needing a real IPC push in this unit test.
    let planCalls = 0
    invokeMock.mockImplementation((channel: string) => {
      if (channel === 'installations:listRunners') {
        return Promise.resolve({
          ok: true,
          value: [...RUNNERS, { kind: 'steam', id: 'steam', labelKey: 'runner.kind.steam', available: true }],
        })
      }
      if (channel === 'launch:plan') {
        planCalls += 1
        return Promise.resolve({
          ok: true,
          value: {
            executablePath: 'steam',
            args: [],
            workingDirectory: '/home/user/Games/Q2',
            preview:
              planCalls === 1
                ? 'steam steam://launch/2320/client/2'
                : 'steam steam://launch/2320/client/4',
          },
        })
      }
      return Promise.resolve({ ok: true, value: null })
    })

    const { rerender } = render(
      createElement(RunnerSection, {
        installation: makeInstallation({ runner: 'steam', steamAppId: '2320', steamClient: 2 }),
      }),
    )

    const firstPreview = await screen.findByTestId('installation-runner-preview')
    expect(firstPreview.textContent).toContain('client/2')

    rerender(
      createElement(RunnerSection, {
        installation: makeInstallation({ runner: 'steam', steamAppId: '2320', steamClient: 4 }),
      }),
    )

    await waitFor(() => {
      expect(screen.getByTestId('installation-runner-preview').textContent).toContain('client/4')
    })
  })
})
