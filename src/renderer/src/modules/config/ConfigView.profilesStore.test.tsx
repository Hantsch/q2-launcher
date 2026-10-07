// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockClient } from '../../test-support/mock-client'
import type { ConfigProfile, ProfileSyncState } from '@shared/modules/config'
import type { Outcome } from '@shared/types'
import { initI18n } from '../../i18n'

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

const SYNC: ProfileSyncState = {
  own: { path: 'C:/profiles/p.cfg', fileName: 'p.cfg', status: 'inSync' },
  installations: [],
}

const listConfigProfiles = vi.fn<() => Promise<Outcome<ConfigProfile[]>>>()

vi.hoisted(() => {
  ;(globalThis as unknown as { q2: unknown }).q2 = {
    invoke: () => Promise.resolve({ ok: true, value: {} }),
    on: () => () => {},
  }
})

// jsdom has no `ResizeObserver`; the Overview tab constructs one on mount.
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  },
)

vi.mock('./client', (importOriginal) =>
  mockClient<typeof import('./client')>(importOriginal, {
    listConfigProfiles: () => listConfigProfiles(),
    getProfileSyncState: async () => ({ ok: true as const, value: SYNC }),
    getSwitchBinds: async () => ({ ok: true as const, value: {} }),
  }),
)

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
const { ConfigProfilesTile } = await import('../home/dashboard/ConfigProfilesTile')
const { useLauncher, ROUTE_HOME } = await import('../../store/useLauncher')
const { useConfigProfiles } = await import('./config-profiles-store')

beforeAll(async () => {
  await initI18n('en')
})

beforeEach(() => {
  useLauncher.setState({ route: ROUTE_HOME, routeFocus: null })
  useConfigProfiles.setState({ profiles: [] })
})

afterEach(() => {
  cleanup()
  listConfigProfiles.mockReset()
})

describe('ConfigView and the shared profile list', () => {
  it('a profile renamed through the dashboard tile shows in an open Config view without a remount', async () => {
    listConfigProfiles.mockResolvedValueOnce({ ok: true, value: [profile('p1', 'Competitive')] })
    useLauncher.getState().setRoute('/config', 'p1')

    render(<ConfigView />)
    await waitFor(() =>
      expect(screen.getByTestId('config-profile-identity').textContent).toContain('Competitive'),
    )
    const header = screen.getByTestId('config-profile-header')

    // The tile's read is the second one, and main answers it with the profile under its new name.
    listConfigProfiles.mockResolvedValueOnce({ ok: true, value: [profile('p1', 'Ranked')] })
    render(<ConfigProfilesTile />)

    await waitFor(() =>
      expect(screen.getByTestId('config-profile-identity').textContent).toContain('Ranked'),
    )
    expect(screen.getByTestId('config-profile-header')).toBe(header)
  })
})
