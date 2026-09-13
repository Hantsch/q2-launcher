// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { ConfigProfile, ProfileSyncState, SyncProfileStateInput } from '@shared/modules/config'
import type { LibraryStats } from '@shared/modules/library'
import type { Outcome } from '@shared/types'
import { initI18n } from '../../../i18n'

/**
 * Story 087 D6 (AC7): "no tile state renders a translation key". Every one of
 * `DashboardTileFrame`'s four states - loading/error/empty/filled - for both dashboard tiles,
 * rendered against the REAL `en` bundle (`initI18n('en')`, not a key-echoing stub like
 * `HomeView.test.tsx`'s second assertion uses): a missing or misspelled key renders as the raw
 * dotted string itself under `react-i18next`'s default behaviour, which is exactly what
 * `assertNoLeakedKey` below catches. The per-state mocking mirrors `PlaytimeTile.test.tsx` and
 * `ConfigProfilesTile.test.tsx` exactly (same client modules, same fixtures) rather than
 * re-deriving it.
 */

const FILLED_STATS: LibraryStats = {
  total: 6,
  ok: 3,
  needsAttention: 2,
  missing: 1,
  favorites: 4,
  totalPlaytimeSeconds: 3720,
  byEngine: { r1q2: 3, q2pro: 3 },
  lastSession: { installationId: 'inst-1', name: 'My R1Q2 Server', at: '2026-01-01T00:00:00.000Z' },
}

const EMPTY_STATS: LibraryStats = {
  total: 0,
  ok: 0,
  needsAttention: 0,
  missing: 0,
  favorites: 0,
  totalPlaytimeSeconds: 0,
  byEngine: {},
}

const getLibraryStats = vi.fn<() => Promise<Outcome<LibraryStats>>>()

vi.mock('../../library/client', () => ({
  getLibraryStats: () => getLibraryStats(),
}))

function profile(id: string, name: string): ConfigProfile {
  return {
    id,
    name,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    cvars: {},
    binds: {},
    assignments: [{ installationId: 'i1', isDefault: false }],
  }
}

function syncState(): ProfileSyncState {
  return {
    own: { path: 'C:/profiles/p.cfg', fileName: 'p.cfg', status: 'inSync' },
    installations: [
      { installationId: 'i1', path: 'C:/games/i1/p.cfg', fileName: 'p.cfg', status: 'inSync' },
    ],
  }
}

const listConfigProfiles = vi.fn<() => Promise<Outcome<ConfigProfile[]>>>()
const getProfileSyncState =
  vi.fn<(input: SyncProfileStateInput) => Promise<Outcome<ProfileSyncState>>>()

vi.mock('../../config/client', () => ({
  listConfigProfiles: () => listConfigProfiles(),
  getProfileSyncState: (input: SyncProfileStateInput) => getProfileSyncState(input),
}))

vi.hoisted(() => {
  ;(globalThis as unknown as { q2: unknown }).q2 = { invoke: vi.fn(), on: vi.fn(() => () => {}) }
})

const { PlaytimeTile } = await import('./PlaytimeTile')
const { ConfigProfilesTile } = await import('./ConfigProfilesTile')

beforeAll(async () => {
  await initI18n('en')
})

afterEach(() => {
  cleanup()
  getLibraryStats.mockReset()
  listConfigProfiles.mockReset()
  getProfileSyncState.mockReset()
})

const STATES = ['loading', 'error', 'empty', 'filled'] as const
type TileState = (typeof STATES)[number]

/** No raw dotted i18n key survives into rendered text - that shape only appears when `t()` falls
 * back to echoing a missing/misspelled key back. Deliberately not scoped to `home.dashboard.*`:
 * these tiles also render keys from other namespaces (e.g. `common.retry` via
 * `DashboardTileFrame.tsx`'s error state), and a leak there would look exactly as wrong to a user
 * as one under this tile's own namespace, so the regex recognises any lowercase-led, dotted token
 * of two or more segments (every real key in this codebase is `lowerCamel(.lowerCamel)+`) rather
 * than just this feature's own `home.dashboard.` shape.
 *
 * Segments after the first are required to start lowercase too, which is what keeps this from
 * false-positiving on this test's own fixtures: `container.textContent` concatenates adjacent
 * elements with no inserted whitespace, so e.g. the error state's message ("...its data.") sitting
 * right next to its retry button ("Retry") reads as "...its data.Retry" - a dot immediately
 * followed by an upper-case word, which no real i18n key shape produces. */
function assertNoLeakedKey(container: HTMLElement): void {
  expect(container.textContent ?? '').not.toMatch(/\b[a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*)+\b/)
}

describe('assertNoLeakedKey (regression: catches a leak outside the home.dashboard namespace)', () => {
  it('flags a common.retry-shaped leak that the old home.dashboard.*-only regex would have missed', () => {
    const div = document.createElement('div')
    div.textContent = 'This tile could not load its data. common.retry'
    expect(() => assertNoLeakedKey(div)).toThrow()
  })

  it('still passes for ordinary rendered English, including a sentence directly abutting a button label', () => {
    const div = document.createElement('div')
    div.textContent = 'This tile could not load its data.Retry'
    expect(() => assertNoLeakedKey(div)).not.toThrow()
  })
})

function configurePlaytime(state: TileState): void {
  switch (state) {
    case 'loading':
      getLibraryStats.mockReturnValue(new Promise<Outcome<LibraryStats>>(() => {}))
      return
    case 'error':
      getLibraryStats.mockResolvedValue({ ok: false, error: { key: 'library.error.unknown' } })
      return
    case 'empty':
      getLibraryStats.mockResolvedValue({ ok: true, value: EMPTY_STATS })
      return
    case 'filled':
      getLibraryStats.mockResolvedValue({ ok: true, value: FILLED_STATS })
      return
  }
}

function configureConfigProfiles(state: TileState): void {
  switch (state) {
    case 'loading':
      listConfigProfiles.mockReturnValue(new Promise<Outcome<ConfigProfile[]>>(() => {}))
      return
    case 'error':
      listConfigProfiles.mockResolvedValue({ ok: false, error: { key: 'config.error.unknown' } })
      return
    case 'empty':
      listConfigProfiles.mockResolvedValue({ ok: true, value: [] })
      return
    case 'filled':
      listConfigProfiles.mockResolvedValue({ ok: true, value: [profile('p1', 'Competitive')] })
      getProfileSyncState.mockResolvedValue({ ok: true, value: syncState() })
      return
  }
}

describe('PlaytimeTile (AC7: no dotted key leaks into rendered text)', () => {
  it.each(STATES)('the %s state renders only real strings', async (state) => {
    configurePlaytime(state)

    const { container } = render(<PlaytimeTile />)
    await waitFor(() => expect(screen.getByTestId(`dashboard-tile-frame-${state}`)).toBeTruthy())
    assertNoLeakedKey(container)
  })
})

describe('ConfigProfilesTile (AC7: no dotted key leaks into rendered text)', () => {
  it.each(STATES)('the %s state renders only real strings', async (state) => {
    configureConfigProfiles(state)

    const { container } = render(<ConfigProfilesTile />)
    await waitFor(() => expect(screen.getByTestId(`dashboard-tile-frame-${state}`)).toBeTruthy())
    assertNoLeakedKey(container)
  })
})
