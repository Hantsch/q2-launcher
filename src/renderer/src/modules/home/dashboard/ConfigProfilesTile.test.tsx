// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { ConfigProfile, ProfileSyncState, SyncProfileStateInput } from '@shared/modules/config'
import type { Outcome } from '@shared/types'
import { initI18n } from '../../../i18n'

/**
 * Story 087 D4 (acceptance line): "every profile appears once with both states; one profile's
 * failed `syncState` marks that row, it does not fail the tile" - plus a smoke test that the empty
 * state renders when there are zero profiles, and that a row click switches the route.
 *
 * `../../config/client` and `../../../store/useLauncher` both reach `window.q2` through
 * `lib/bridge.ts` at *module* scope (mirrors `PlaytimeTile.test.tsx`/`HomeView.test.tsx`), so the
 * bridge is stubbed via `vi.hoisted` before the component under test is imported.
 */

function profile(id: string, name: string, installationIds: string[] = ['i1']): ConfigProfile {
  return {
    id,
    name,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    cvars: {},
    binds: {},
    assignments: installationIds.map((installationId) => ({ installationId, isDefault: false })),
  }
}

function syncState(ownStatus: 'inSync' | 'outOfSync' | 'missing' | 'error'): ProfileSyncState {
  return {
    own: { path: 'C:/profiles/p.cfg', fileName: 'p.cfg', status: ownStatus },
    installations: [
      { installationId: 'i1', path: 'C:/games/i1/p.cfg', fileName: 'p.cfg', status: 'inSync' },
    ],
  }
}

const listConfigProfiles = vi.fn<() => Promise<Outcome<ConfigProfile[]>>>(async () => ({
  ok: true,
  value: [],
}))
const getProfileSyncState =
  vi.fn<(input: SyncProfileStateInput) => Promise<Outcome<ProfileSyncState>>>()

vi.mock('../../config/client', () => ({
  listConfigProfiles: () => listConfigProfiles(),
  getProfileSyncState: (input: SyncProfileStateInput) => getProfileSyncState(input),
}))

const setRoute = vi.fn()

vi.mock('../../../store/useLauncher', () => ({
  useLauncher: (selector: (state: { setRoute: typeof setRoute }) => unknown) =>
    selector({ setRoute }),
}))

vi.hoisted(() => {
  ;(globalThis as unknown as { q2: unknown }).q2 = { invoke: vi.fn(), on: vi.fn(() => () => {}) }
})

const { ConfigProfilesTile } = await import('./ConfigProfilesTile')

beforeAll(async () => {
  await initI18n('en')
})

afterEach(() => {
  cleanup()
  listConfigProfiles.mockClear()
  getProfileSyncState.mockClear()
  setRoute.mockClear()
})

describe('ConfigProfilesTile', () => {
  it('every profile appears once with both states; one failed syncState marks that row without failing the tile', async () => {
    listConfigProfiles.mockResolvedValueOnce({
      ok: true,
      value: [profile('p1', 'Competitive'), profile('p2', 'Broken fetch'), profile('p3', 'Casual')],
    })
    getProfileSyncState.mockImplementation(async ({ profileId }) => {
      if (profileId === 'p1') return { ok: true, value: syncState('inSync') }
      if (profileId === 'p2') return { ok: false, error: { key: 'config.error.notFound' } }
      return { ok: true, value: syncState('outOfSync') }
    })

    render(<ConfigProfilesTile />)

    await waitFor(() => expect(screen.getByTestId('dashboard-tile-frame-filled')).toBeTruthy())

    // The tile as a whole is filled, not errored, despite one profile's fetch failing.
    expect(screen.queryByTestId('dashboard-tile-frame-error')).toBeNull()

    // Every profile appears exactly once.
    expect(screen.getByTestId('config-profiles-tile-row-p1')).toBeTruthy()
    expect(screen.getByTestId('config-profiles-tile-row-p2')).toBeTruthy()
    expect(screen.getByTestId('config-profiles-tile-row-p3')).toBeTruthy()

    // The failed profile's row is visibly marked - both its own and installations badges read
    // 'Failed' rather than being silently omitted.
    const p2Own = screen.getByTestId('config-profiles-tile-own-p2')
    const p2Installations = screen.getByTestId('config-profiles-tile-installations-p2')
    expect(p2Own.textContent).toContain('Failed')
    expect(p2Installations.textContent).toContain('Failed')

    // A profile that fetched fine shows its real state, not 'Failed'.
    const p1Own = screen.getByTestId('config-profiles-tile-own-p1')
    expect(p1Own.textContent).toContain('In sync')
  })

  it('zero profiles renders the empty state with an action that opens config', async () => {
    listConfigProfiles.mockResolvedValueOnce({ ok: true, value: [] })

    render(<ConfigProfilesTile />)

    await waitFor(() => expect(screen.getByTestId('dashboard-tile-frame-empty')).toBeTruthy())
    expect(screen.queryByTestId('dashboard-tile-frame-filled')).toBeNull()

    fireEvent.click(screen.getByTestId('config-profiles-tile-empty-action'))
    expect(setRoute).toHaveBeenCalledWith('/config')
  })

  // Story 087 D5: a row click carries the clicked profile's id along as the shell's one-shot route
  // focus, so `ConfigView` can open that profile's editor rather than the profile list.
  it('clicking a profile row switches the route to config, focused on that profile', async () => {
    listConfigProfiles.mockResolvedValueOnce({ ok: true, value: [profile('p1', 'Competitive')] })
    getProfileSyncState.mockResolvedValueOnce({ ok: true, value: syncState('inSync') })

    render(<ConfigProfilesTile />)

    await waitFor(() => expect(screen.getByTestId('config-profiles-tile-row-p1')).toBeTruthy())
    fireEvent.click(screen.getByTestId('config-profiles-tile-row-p1'))

    expect(setRoute).toHaveBeenCalledWith('/config', 'p1')
  })
})
