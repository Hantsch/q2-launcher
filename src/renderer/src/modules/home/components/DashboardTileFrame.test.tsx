// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { initI18n } from '../../../i18n'
import { DashboardTileFrame } from './DashboardTileFrame'

/**
 * Story 087 D2 (AC4): "every tile renders one of four explicit states - loading, error with a
 * working retry, empty with a sentence and an action, filled - through one shared tile frame."
 * Each state gets its own markup assertion; the error state's retry is exercised end to end; and a
 * throwing child in the `filled` slot must land on the error state instead of unmounting the tree,
 * which is what the frame's internal `TileFrameBoundary` exists for.
 */

function Thrower(): never {
  throw new Error('tile body blew up')
}

beforeAll(async () => {
  await initI18n('en')
})

afterEach(() => {
  cleanup()
})

describe('DashboardTileFrame', () => {
  it('renders its own title as a heading regardless of state', () => {
    render(createElement(DashboardTileFrame, { title: 'Playtime', state: 'loading' }))
    expect(screen.getByRole('heading', { name: 'Playtime' })).toBeTruthy()
  })

  it('loading state renders its own markup', () => {
    render(createElement(DashboardTileFrame, { title: 'Playtime', state: 'loading' }))

    expect(screen.getByTestId('dashboard-tile-frame-loading')).toBeTruthy()
    expect(screen.queryByTestId('dashboard-tile-frame-error')).toBeNull()
    expect(screen.queryByTestId('dashboard-tile-frame-empty')).toBeNull()
    expect(screen.queryByTestId('dashboard-tile-frame-filled')).toBeNull()
  })

  it('error state renders a message and a working retry button', () => {
    const onRetry = vi.fn()
    render(
      createElement(DashboardTileFrame, {
        title: 'Playtime',
        state: 'error',
        onRetry,
      }),
    )

    expect(screen.getByTestId('dashboard-tile-frame-error')).toBeTruthy()
    const retryButton = screen.getByTestId('dashboard-tile-frame-retry')
    expect(retryButton).toBeTruthy()

    fireEvent.click(retryButton)
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('empty state renders the shared EmptyState primitive with a sentence and an action', () => {
    render(
      createElement(DashboardTileFrame, {
        title: 'Config Profiles',
        state: 'empty',
        empty: {
          title: 'No profiles yet',
          body: 'Create one to get started.',
          actions: createElement('button', { type: 'button' }, 'Create profile'),
        },
      }),
    )

    expect(screen.getByTestId('dashboard-tile-frame-empty')).toBeTruthy()
    expect(screen.getByText('No profiles yet')).toBeTruthy()
    expect(screen.getByText('Create one to get started.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Create profile' })).toBeTruthy()
  })

  it('filled state renders whatever children it is handed', () => {
    render(
      createElement(DashboardTileFrame, {
        title: 'Playtime',
        state: 'filled',
        children: createElement('p', null, 'total: 42h'),
      }),
    )

    expect(screen.getByTestId('dashboard-tile-frame-filled')).toBeTruthy()
    expect(screen.getByText('total: 42h')).toBeTruthy()
  })

  it('a filled body that throws is caught by the internal boundary and renders the error state instead of crashing', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(
      createElement(DashboardTileFrame, {
        title: 'Playtime',
        state: 'filled',
        children: createElement(Thrower),
      }),
    )

    expect(screen.getByTestId('dashboard-tile-frame-error')).toBeTruthy()
    expect(screen.queryByTestId('dashboard-tile-frame-filled')).toBeNull()
    // The whole tree survived - the frame's own title is still on screen.
    expect(screen.getByRole('heading', { name: 'Playtime' })).toBeTruthy()

    consoleError.mockRestore()
  })

  it("the boundary's retry re-attempts rendering the children", () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(
      createElement(DashboardTileFrame, {
        title: 'Playtime',
        state: 'filled',
        children: createElement(Thrower),
      }),
    )

    const retryButton = screen.getByTestId('dashboard-tile-frame-retry')
    // Re-attempting a render of the same always-throwing component must not itself crash the test -
    // it lands right back on the error state.
    fireEvent.click(retryButton)
    expect(screen.getByTestId('dashboard-tile-frame-error')).toBeTruthy()

    consoleError.mockRestore()
  })
})
