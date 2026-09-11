// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { TilePlacement } from '@shared/modules/home'
import { initI18n } from '../../../i18n'

/**
 * Review fix (post-087, AC5): `DashboardTile`'s own `DashboardTileBodyBoundary` has to catch a
 * throw from the tile body itself - not just from whatever `children` a tile hands
 * `DashboardTileFrame` - because a tile computes derived data (`Object.entries(data.byEngine)`,
 * `toConfigProfileRows(...)`, ...) before it ever constructs a `<DashboardTileFrame>` element, one
 * level above `DashboardTileFrame`'s own internal `TileFrameBoundary`. `dashboard-modules.tsx` is
 * mocked here (the same registry-substitution pattern the rest of this directory's tests use for
 * client modules) so one tile's `Body` throws unconditionally while its sibling renders normally -
 * proving the fault is contained to the one tile instead of propagating past the grid.
 */

function Thrower(): never {
  throw new Error('tile body blew up during render')
}

function Fine() {
  return createElement('p', { 'data-testid': 'fine-tile-body' }, 'still here')
}

vi.mock('./dashboard-modules', () => ({
  DASHBOARD_MODULES: {
    playtime: {
      id: 'playtime',
      titleKey: 'home.dashboard.tiles.playtime.title',
      Body: Thrower,
    },
    configProfiles: {
      id: 'configProfiles',
      titleKey: 'home.dashboard.tiles.configProfiles.title',
      Body: Fine,
    },
  },
}))

const { DashboardTile } = await import('./DashboardTile')

const PLAYTIME_TILE: TilePlacement = { moduleId: 'playtime', x: 0, y: 0, w: 6, h: 5 }
const CONFIG_TILE: TilePlacement = { moduleId: 'configProfiles', x: 6, y: 0, w: 6, h: 5 }

function handlers() {
  return {
    onKeyboardChange: vi.fn(),
    onKeyboardCancel: vi.fn(),
    onAnnounce: vi.fn(),
  }
}

beforeAll(async () => {
  await initI18n('en')
})

afterEach(() => {
  cleanup()
})

describe('DashboardTile (AC5: a throwing tile body cannot unmount the grid)', () => {
  it('a throw during body render is caught by this tile alone, and a sibling tile keeps rendering', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(
      createElement(
        'div',
        null,
        createElement(DashboardTile, { tile: PLAYTIME_TILE, ...handlers() }),
        createElement(DashboardTile, { tile: CONFIG_TILE, ...handlers() }),
      ),
    )

    // The throwing tile lands on its own render-error fallback, not on `DashboardTileFrame`'s
    // fetch-error state (they are two different boundaries, catching two different faults).
    expect(screen.getByTestId('dashboard-tile-render-error')).toBeTruthy()
    expect(screen.queryByTestId('dashboard-tile-frame-error')).toBeNull()

    // Review fix (second cycle, AC5): the fallback names the tile that failed - `DashboardTileFrame`'s
    // own heading never got a chance to render (the throw happened before `definition.Body` ever
    // reached it), so `DashboardTileBodyBoundary` must show the title itself.
    const playtimeTitle = screen
      .getByTestId('dashboard-tile-playtime')
      .querySelector('[data-testid="dashboard-tile-render-error"] h2')
    expect(playtimeTitle?.textContent).toBe('Playtime')

    // The sibling tile's frame and body rendered fine - the throw did not unmount the grid.
    expect(screen.getByTestId('dashboard-tile-playtime')).toBeTruthy()
    expect(screen.getByTestId('dashboard-tile-configProfiles')).toBeTruthy()
    expect(screen.getByTestId('fine-tile-body')).toBeTruthy()

    consoleError.mockRestore()
  })

  it("the boundary's retry re-attempts rendering the body", () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(createElement(DashboardTile, { tile: PLAYTIME_TILE, ...handlers() }))

    const retryButton = screen.getByTestId('dashboard-tile-render-error-retry')
    // Re-attempting a render of the same always-throwing body must not itself crash the test - it
    // lands right back on the render-error fallback.
    fireEvent.click(retryButton)
    expect(screen.getByTestId('dashboard-tile-render-error')).toBeTruthy()

    consoleError.mockRestore()
  })
})
