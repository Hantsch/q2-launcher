// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { ConfigProfile } from '@shared/modules/config'
import type { EngineKind } from '@shared/types/engine'
import type { Installation } from '@shared/types/installation'
import { initI18n } from '../../i18n'
import { useLauncher } from '../../store/useLauncher'
import { InstallationProfilesPanel } from './InstallationProfilesPanel'
import { ProfileAssignmentsPanel } from './ProfileAssignmentsPanel'

/**
 * Story 065 D3: both config-module installation lists (`InstallationProfilesPanel`'s
 * by-installation view and `ProfileAssignmentsPanel`'s per-profile assignment rows) grow the same
 * `EngineBadge` D1 introduced, placed right after the installation name. Covers the two literal
 * ACs the story maps to this deliverable: the badge shows up (with the `unknown` label spelled out
 * correctly) and a long name truncates instead of shoving the badge out of the row - the DOM half
 * of that (classes present), not the pixel-layout half (that's e2e's job, jsdom doesn't lay out).
 *
 * `getSwitchBinds` is mocked because `InstallationProfilesPanel` fetches it on mount (real IPC
 * would reject in jsdom) - same reasoning `AliasesTab.test.ts` gives for mocking `./client`.
 */

// `InstallationProfilesPanel`'s import chain reaches `store/useLauncher.ts` -> `lib/bridge.ts`,
// which resolves `window.q2` at *module* scope and throws when it is missing - so the bridge has
// to exist before this file's own imports are evaluated, which is what `vi.hoisted` is for
// (`ControlsTab.dialogs.test.ts` sets this precedent). `./client`'s `getSwitchBinds` is mocked on
// top of that because `InstallationProfilesPanel` calls it for real on mount.
vi.hoisted(() => {
  ;(globalThis as unknown as { q2: unknown }).q2 = {
    invoke: () => Promise.reject(new Error('IPC is not available in this test')),
    on: () => () => {},
  }
})

vi.mock('./client', () => ({
  getSwitchBinds: vi.fn(async () => ({ ok: true, value: {} })),
}))

beforeAll(async () => {
  await initI18n('en')
})

afterEach(() => {
  cleanup()
  useLauncher.setState({ installations: [] })
})

function installation(overrides: Partial<Installation> & { id: string }): Installation {
  return {
    name: overrides.id,
    rootPath: `C:/games/${overrides.id}`,
    engineKind: 'r1q2' as EngineKind,
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

function profile(overrides: Partial<ConfigProfile> = {}): ConfigProfile {
  return {
    id: 'p1',
    name: 'Profile',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    cvars: {},
    binds: {},
    assignments: [],
    ...overrides,
  }
}

const LONG_NAME = 'A'.repeat(120)

describe('InstallationProfilesPanel', () => {
  it('shows the engine badge after the installation name, with the unknown label spelled out', () => {
    useLauncher.setState({
      installations: [
        installation({ id: 'i-r1q2', name: 'Main install', engineKind: 'r1q2' }),
        installation({ id: 'i-unknown', name: 'Mystery install', engineKind: 'unknown' }),
      ],
    })

    render(createElement(InstallationProfilesPanel, { profiles: [] }))

    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(2)

    const badges = screen.getAllByTestId('engine-badge')
    expect(badges).toHaveLength(2)
    expect(within(rows[1]).getByTestId('engine-badge').textContent).toBe(
      'Unknown engine (unsupported)',
    )
  })

  it('a long installation name does not push the badge out of the row', () => {
    useLauncher.setState({
      installations: [installation({ id: 'i-long', name: LONG_NAME, engineKind: 'q2pro' })],
    })

    render(createElement(InstallationProfilesPanel, { profiles: [] }))

    const row = screen.getByRole('listitem')
    const nameEl = within(row).getByText(LONG_NAME)
    const nameClasses = nameEl.className.split(/\s+/)
    expect(nameClasses).toContain('truncate')
    expect(nameClasses).toContain('min-w-0')
    expect(nameClasses).not.toContain('shrink-0')

    expect(within(row).getByTestId('engine-badge')).toBeTruthy()
  })
})

describe('ProfileAssignmentsPanel', () => {
  it('shows the engine badge after the installation name, with the unknown label spelled out', () => {
    useLauncher.setState({
      installations: [
        installation({ id: 'i-r1q2', name: 'Main install', engineKind: 'r1q2' }),
        installation({ id: 'i-unknown', name: 'Mystery install', engineKind: 'unknown' }),
      ],
    })

    render(
      createElement(ProfileAssignmentsPanel, {
        profile: profile(),
        onChanged: () => {},
      }),
    )

    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(2)

    const badges = screen.getAllByTestId('engine-badge')
    expect(badges).toHaveLength(2)
    expect(within(rows[1]).getByTestId('engine-badge').textContent).toBe(
      'Unknown engine (unsupported)',
    )
  })

  it('a long installation name does not push the badge out of the row', () => {
    useLauncher.setState({
      installations: [installation({ id: 'i-long', name: LONG_NAME, engineKind: 'q2pro' })],
    })

    render(
      createElement(ProfileAssignmentsPanel, {
        profile: profile(),
        onChanged: () => {},
      }),
    )

    const row = screen.getByRole('listitem')
    const nameEl = within(row).getByText(LONG_NAME)
    const nameClasses = nameEl.className.split(/\s+/)
    expect(nameClasses).toContain('truncate')
    expect(nameClasses).toContain('min-w-0')
    expect(nameClasses).not.toContain('shrink-0')

    expect(within(row).getByTestId('engine-badge')).toBeTruthy()
  })
})
