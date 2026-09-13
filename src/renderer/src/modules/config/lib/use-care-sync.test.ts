// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConfigProfile } from '@shared/modules/config'
import { ok } from '@shared/types'
import type { CareItemAction } from './care-items'
import { useCareSync, type UseCareSyncResult } from './use-care-sync'
import { writeConfigProfile } from '../client'

/**
 * Story 079 D6: `useCareSync` no longer owns the profile's sync-state fetch (moved up to
 * `ConfigView`'s `useDriftState`, `lib/use-drift-state.ts`, so drift is checked whether or not the
 * Care tab is ever opened - AC5). What is left to pin down here is exactly what the file doc comment
 * promises: this hook never fetches on its own any more, and every action that used to `await
 * fetchSyncState()` now calls the passed-in `refetchSyncState` instead.
 *
 * Rendered against the real hook through a small probe component, mirroring
 * `useFileSourceRefresh.test.ts`'s own shape next door (`createElement`, since `vitest.config.ts`
 * only collects `*.test.ts` under the plain `node` environment and this file opts into jsdom via the
 * pragma above). `../client` is mocked wholesale, deliberately omitting `getProfileSyncState` - were
 * this hook to still call it, the mock factory would throw on the unmocked export instead of quietly
 * succeeding.
 */

const pushToast = vi.fn()

vi.mock('../../../store/useLauncher', () => ({
  useLauncher: (selector: (state: { pushToast: typeof pushToast }) => unknown) =>
    selector({ pushToast }),
}))

vi.mock('../client', () => ({
  writeConfigProfile: vi.fn(),
  openProfileFile: vi.fn(),
  refreshProfilesFromFiles: vi.fn(),
  saveConfigProfile: vi.fn(),
}))

const write = vi.mocked(writeConfigProfile)

const PROFILE: ConfigProfile = {
  id: 'p1',
  name: 'Profile One',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  cvars: {},
  binds: {},
  assignments: [],
}

const RETRY_ACTION: CareItemAction = { key: 'canonical:retry', kind: 'retry', labelKey: 'unused' }

/** Publishes the hook's result to the test, same idiom `useFileSourceRefresh.test.ts`'s `latest` uses
 * for `useRawDraft`. */
let latest: UseCareSyncResult | null = null

function Probe({ refetchSyncState }: { refetchSyncState: () => void }) {
  latest = useCareSync({
    profile: PROFILE,
    onProfileUpdated: () => {},
    status: { kind: 'loading' },
    refetchSyncState,
  })
  return null
}

function mount(refetchSyncState: () => void) {
  return render(createElement(Probe, { refetchSyncState }))
}

beforeEach(() => {
  latest = null
  pushToast.mockReset()
  write.mockReset()
  write.mockResolvedValue(ok([]))
})

afterEach(() => {
  cleanup()
})

describe('useCareSync', () => {
  it('never fetches sync state itself - status is exactly what it was handed', () => {
    const refetchSyncState = vi.fn()
    mount(refetchSyncState)

    expect(latest?.status).toEqual({ kind: 'loading' })
    expect(refetchSyncState).not.toHaveBeenCalled()
  })

  it('refetches through the passed-in callback after a successful retry, not through its own fetch', async () => {
    const refetchSyncState = vi.fn()
    mount(refetchSyncState)

    latest!.runAction(RETRY_ACTION, 'canonical')

    await waitFor(() => expect(refetchSyncState).toHaveBeenCalledTimes(1))
    expect(write).toHaveBeenCalledWith({ profileId: 'p1' })
  })

  it('does not refetch when the retry write itself fails', async () => {
    write.mockResolvedValue({
      ok: false,
      error: { key: 'config.error.installationRunning' },
    })
    const refetchSyncState = vi.fn()
    mount(refetchSyncState)

    latest!.runAction(RETRY_ACTION, 'canonical')

    await waitFor(() => expect(pushToast).toHaveBeenCalledTimes(1))
    expect(refetchSyncState).not.toHaveBeenCalled()
  })
})
