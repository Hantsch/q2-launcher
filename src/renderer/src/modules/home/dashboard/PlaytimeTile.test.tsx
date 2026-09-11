// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { LibraryStats } from '@shared/modules/library'
import type { Outcome } from '@shared/types'
import { initI18n } from '../../../i18n'

/**
 * Story 087 D3 (AC1's acceptance test): "the playtime tile shows status, engines, favourites,
 * playtime and the last session" - and, separately, that a truly empty library (zero
 * installations) renders the shared frame's empty state instead of a wall of zeroes.
 *
 * `./client` (the library module's typed client) and `../../../store/useLauncher` both reach
 * `window.q2` through `lib/bridge.ts` at *module* scope (mirrors `HomeView.test.tsx`), so the
 * bridge is stubbed via `vi.hoisted` before the component under test is imported.
 */

const FILLED_STATS: LibraryStats = {
  total: 6,
  ok: 3,
  needsAttention: 2,
  missing: 1,
  favorites: 4,
  totalPlaytimeSeconds: 3720, // formatDuration -> "1h 2m"
  byEngine: { r1q2: 3, q2pro: 3 },
  lastSession: {
    installationId: 'inst-1',
    name: 'My R1Q2 Server',
    at: '2026-01-01T00:00:00.000Z',
  },
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

const getLibraryStats = vi.fn<() => Promise<Outcome<LibraryStats>>>(async () => ({
  ok: true,
  value: FILLED_STATS,
}))

vi.mock('../../library/client', () => ({
  getLibraryStats: () => getLibraryStats(),
}))

vi.hoisted(() => {
  ;(globalThis as unknown as { q2: unknown }).q2 = { invoke: vi.fn(), on: vi.fn(() => () => {}) }
})

const { PlaytimeTile } = await import('./PlaytimeTile')

beforeAll(async () => {
  await initI18n('en')
})

afterEach(() => {
  cleanup()
  getLibraryStats.mockClear()
})

describe('PlaytimeTile', () => {
  it('the playtime tile shows status, engines, favourites, playtime and the last session', async () => {
    getLibraryStats.mockResolvedValueOnce({ ok: true, value: FILLED_STATS })

    render(<PlaytimeTile />)

    await waitFor(() => expect(screen.getByTestId('dashboard-tile-frame-filled')).toBeTruthy())

    // (1) installations by status (ok/needsAttention/missing - and total)
    const status = screen.getByTestId('playtime-tile-status')
    expect(status.textContent).toContain('6') // total
    expect(status.textContent).toContain('3') // ok
    expect(status.textContent).toContain('2') // needsAttention
    expect(status.textContent).toContain('1') // missing

    // (2) byEngine breakdown - at least one engine's (untranslated) product-name label
    const engines = screen.getByTestId('playtime-tile-engines')
    expect(engines.textContent).toContain('R1Q2')

    // (3) favourites count
    expect(screen.getByText('4')).toBeTruthy()

    // (4) total playtime, via the shared formatDuration helper
    expect(screen.getByText('1h 2m')).toBeTruthy()

    // (5) the last session's installation name
    expect(screen.getByText(/My R1Q2 Server/)).toBeTruthy()
  })

  it('a zeroed stats object renders the empty state, not a wall of zeroes', async () => {
    getLibraryStats.mockResolvedValueOnce({ ok: true, value: EMPTY_STATS })

    render(<PlaytimeTile />)

    await waitFor(() => expect(screen.getByTestId('dashboard-tile-frame-empty')).toBeTruthy())

    expect(screen.queryByTestId('dashboard-tile-frame-filled')).toBeNull()
    expect(screen.queryByTestId('playtime-tile-status')).toBeNull()
    expect(screen.queryByTestId('playtime-tile-engines')).toBeNull()
    // None of the filled-state stat labels leaked into the empty state.
    expect(screen.queryByText('Total playtime')).toBeNull()
    expect(screen.queryByText('Favourites')).toBeNull()
  })
})
