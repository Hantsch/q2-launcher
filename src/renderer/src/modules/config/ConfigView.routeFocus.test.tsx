// @vitest-environment jsdom
import { StrictMode } from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConfigProfile } from '@shared/modules/config'
import type { Outcome } from '@shared/types'
import { initI18n } from '../../i18n'

/**
 * Story 087 D5 (AC2), at the unit level: a profile id handed to the config view as the shell's
 * one-shot route focus lands in *that* profile's editor, and a second mount of the view does not
 * re-apply it (navigating away and back shows the profile list again).
 *
 * `ConfigView` is a heavy component, so this file mocks exactly the machinery that would otherwise
 * talk to main on mount and nothing else - the focus seeding itself runs for real, through the real
 * `useLauncher` store:
 *   - `./client` keeps all its real exports (`importActual`, so every other config component in the
 *     import graph still finds the named export it imports) with only `listConfigProfiles` replaced
 *     by a fixture; `window.q2` is stubbed via `vi.hoisted` because that module reaches
 *     `lib/bridge.ts` at *module* scope (`InstallationProfilesPanel.test.ts`'s precedent).
 *   - the three IPC-backed hooks the view drives on mount (`useDriftState`,
 *     `useFileSourceRefresh`, `useProfileDraft`) are stubbed to their idle shapes.
 */

function profile(id: string, name: string): ConfigProfile {
  return {
    id,
    name,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    cvars: {},
    binds: {},
    assignments: [],
  }
}

const PROFILES = [profile('p1', 'Competitive'), profile('p2', 'Casual')]

const listConfigProfiles = vi.fn<() => Promise<Outcome<ConfigProfile[]>>>(async () => ({
  ok: true,
  value: PROFILES,
}))

vi.hoisted(() => {
  ;(globalThis as unknown as { q2: unknown }).q2 = {
    invoke: () => Promise.resolve({ ok: true, value: {} }),
    on: () => () => {},
  }
})

// jsdom has no `ResizeObserver`, and `OverviewKeyboardPanel` (the Overview tab, i.e. the detail
// screen this test opens) constructs one on mount. A no-op stand-in is enough here: this test
// asserts *which* profile is open, never a measured layout.
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  },
)

vi.mock('./client', async () => {
  const actual = await vi.importActual<typeof import('./client')>('./client')
  return { ...actual, listConfigProfiles: () => listConfigProfiles() }
})

vi.mock('./lib/use-drift-state', () => ({
  useDriftState: () => ({ status: { kind: 'loading' as const }, refetch: () => {} }),
}))

vi.mock('./lib/useFileSourceRefresh', () => ({ useFileSourceRefresh: () => {} }))

vi.mock('./lib/useProfileDraft', () => ({
  useProfileDraft: (selected: ConfigProfile | null) => ({
    draft: selected,
    patch: () => {},
    resetDraft: () => {},
  }),
}))

const { ConfigView } = await import('./ConfigView')
const { useLauncher, ROUTE_HOME } = await import('../../store/useLauncher')

beforeAll(async () => {
  await initI18n('en')
})

beforeEach(() => {
  useLauncher.setState({ route: ROUTE_HOME, routeFocus: null })
})

afterEach(() => {
  cleanup()
  useLauncher.setState({ route: ROUTE_HOME, routeFocus: null })
  listConfigProfiles.mockClear()
})

/**
 * Rendered under `StrictMode`, exactly as `main.tsx` mounts the app: its double-invoked mount
 * effects are precisely what a one-shot "consume this focus" is easy to get wrong under, so the
 * seeding is proven against that behaviour rather than only against a single-pass mount.
 */
function renderView(): ReturnType<typeof render> {
  return render(<ConfigView />, { wrapper: StrictMode })
}

/** The list screen is showing, with every profile as a row and no detail header. */
async function expectListScreen(): Promise<void> {
  await waitFor(() => expect(screen.getAllByTestId('config-profile-row')).toHaveLength(2))
  expect(screen.queryByTestId('config-profile-header')).toBeNull()
}

describe('ConfigView route focus', () => {
  it('a seeded focus opens that profile, and a second mount lands on the list again (AC2)', async () => {
    // The real store action the dashboard tile calls: route plus the clicked profile's id.
    useLauncher.getState().setRoute('/config', 'p2')

    const first = renderView()

    await waitFor(() =>
      expect(screen.getByTestId('config-profile-identity').textContent).toContain('Casual'),
    )
    // The detail screen, not the list - and for the focused profile, not the first one.
    expect(screen.getByTestId('config-profile-header')).toBeTruthy()
    expect(screen.queryByTestId('config-profile-row')).toBeNull()
    expect(screen.getByTestId('config-profile-identity').textContent).not.toContain('Competitive')
    // Consumed, so nothing is left in the store to fire again.
    expect(useLauncher.getState().routeFocus).toBeNull()

    // Navigating away and back remounts the view (the shell renders a different component per
    // route): the already-consumed focus must not re-select the profile.
    first.unmount()
    renderView()
    await expectListScreen()
  })

  it('a focus naming a profile that no longer exists lands on the list', async () => {
    useLauncher.getState().setRoute('/config', 'p-deleted')

    renderView()

    await expectListScreen()
    expect(useLauncher.getState().routeFocus).toBeNull()
  })

  it('without a focus the view opens on the list, as before', async () => {
    useLauncher.getState().setRoute('/config')

    renderView()

    await expectListScreen()
  })
})
