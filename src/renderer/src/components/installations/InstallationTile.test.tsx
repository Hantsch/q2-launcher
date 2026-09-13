// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Installation } from '@shared/types'
import { InstallationTile } from './InstallationTile'

/**
 * `useInstallationIcon` reads/writes `useLauncher`'s `iconDataUrls` cache and
 * calls its `fetchIconDataUrl` action - mocked the same way
 * `useFileSourceRefresh.test.ts` mocks the store (a bare selector call, no
 * Zustand plumbing), since importing the real store pulls in `lib/bridge.ts`,
 * which throws at module load without a real `window.q2`.
 */
let iconDataUrls: Record<string, string | null> = {}
const fetchIconDataUrl = vi.fn()

vi.mock('../../store/useLauncher', () => ({
  useLauncher: (selector: (state: { iconDataUrls: Record<string, string | null>; fetchIconDataUrl: typeof fetchIconDataUrl }) => unknown) =>
    selector({ iconDataUrls, fetchIconDataUrl }),
}))

/**
 * Pixel-for-pixel baseline for the three call sites' pre-extraction markup
 * (rail, library card, action bar). These class lists were captured verbatim
 * from the source before it was refactored to use this component - any
 * change here is a visual regression, not a style-guide nit.
 */
function makeInstallation(overrides: Partial<Installation> = {}): Installation {
  return {
    id: 'inst-1',
    name: 'Test Install',
    rootPath: 'C:\\Games\\Q2',
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

function classesOf(element: Element): string[] {
  return element.className.split(/\s+/).filter(Boolean)
}

beforeEach(() => {
  iconDataUrls = {}
  fetchIconDataUrl.mockClear()
})

afterEach(() => {
  cleanup()
})

describe('InstallationTile', () => {
  it("renders the rail variant with today's exact classes", () => {
    render(<InstallationTile installation={makeInstallation()} size="rail" />)

    const text = screen.getByText('R1')
    const root = text.parentElement as HTMLElement
    expect(classesOf(root)).toEqual(
      expect.arrayContaining(['grid', 'place-items-center', 'rounded-md', 'border', 'aspect-square', 'w-full']),
    )
    expect(classesOf(text)).toEqual(
      expect.arrayContaining(['font-display', 'font-semibold', 'text-lg', 'tracking-tight']),
    )
  })

  it("renders the card variant with today's exact classes", () => {
    render(<InstallationTile installation={makeInstallation()} size="card" />)

    const text = screen.getByText('R1')
    const root = text.parentElement as HTMLElement
    expect(classesOf(root)).toEqual(
      expect.arrayContaining(['grid', 'place-items-center', 'rounded-md', 'border', 'size-11']),
    )
    expect(classesOf(text)).toEqual(expect.arrayContaining(['font-display', 'font-semibold', 'text-sm']))
  })

  it("renders the actionBar variant with today's exact classes", () => {
    render(<InstallationTile installation={makeInstallation()} size="actionBar" />)

    const text = screen.getByText('R1')
    const root = text.parentElement as HTMLElement
    expect(classesOf(root)).toEqual(
      expect.arrayContaining(['grid', 'place-items-center', 'rounded-md', 'border', 'size-12']),
    )
    expect(classesOf(text)).toEqual(
      expect.arrayContaining(['font-display', 'font-semibold', 'text-base', 'text-flame-300']),
    )
  })

  it('falls back to "--" when there is no installation', () => {
    render(<InstallationTile installation={null} size="actionBar" />)

    expect(screen.getByText('--')).toBeTruthy()
  })

  it('passes className through to the root and textClassName through to the text', () => {
    render(
      <InstallationTile
        installation={makeInstallation()}
        size="rail"
        className="border-flame-500"
        textClassName="text-flame-200"
      />,
    )

    const text = screen.getByText('R1')
    const root = text.parentElement as HTMLElement
    expect(classesOf(root)).toContain('border-flame-500')
    expect(classesOf(text)).toContain('text-flame-200')
  })

  describe('story 067 D5 - icon rendering', () => {
    it('renders a decorative <img> for a shipped icon, with no IPC call', () => {
      const { container } = render(
        <InstallationTile
          installation={makeInstallation({ icon: { kind: 'shipped', id: 'gate' } })}
          size="rail"
        />,
      )

      const img = container.querySelector('img') as HTMLImageElement
      expect(img).toBeTruthy()
      expect(img.getAttribute('alt')).toBe('')
      expect(img.getAttribute('aria-hidden')).toBe('true')
      expect(img.src).toContain('gate')
      expect(screen.queryByText('R1')).toBeNull()
      expect(fetchIconDataUrl).not.toHaveBeenCalled()
    })

    it('renders the cached data URL for a custom icon without refetching', () => {
      iconDataUrls['inst-1'] = 'data:image/png;base64,AAAA'

      const { container } = render(
        <InstallationTile installation={makeInstallation({ icon: { kind: 'custom' } })} size="card" />,
      )

      const img = container.querySelector('img') as HTMLImageElement
      expect(img.src).toBe('data:image/png;base64,AAAA')
      expect(fetchIconDataUrl).not.toHaveBeenCalled()
    })

    it('falls back to the code tile and fetches once while a custom icon is uncached', () => {
      render(
        <InstallationTile installation={makeInstallation({ icon: { kind: 'custom' } })} size="card" />,
      )

      expect(screen.getByText('R1')).toBeTruthy()
      expect(fetchIconDataUrl).toHaveBeenCalledTimes(1)
      expect(fetchIconDataUrl).toHaveBeenCalledWith('inst-1')
    })

    it('never calls fetchIconDataUrl when the installation has no icon (AC9)', () => {
      render(<InstallationTile installation={makeInstallation()} size="rail" />)

      expect(screen.getByText('R1')).toBeTruthy()
      expect(fetchIconDataUrl).not.toHaveBeenCalled()
    })
  })

  describe('story 077 D4 - failed microtag', () => {
    it('the failed microtag renders only with a lastFailure (AC5)', () => {
      const { rerender } = render(
        <InstallationTile
          installation={makeInstallation({
            status: 'invalid',
            lastFailure: { errorKey: 'downloads.error.network', at: 1, jobId: 'job-1' },
          })}
          size="card"
        />,
      )
      expect(screen.getByTestId('installation-tile-failed-tag')).toBeTruthy()

      // Same broken status, no `lastFailure` - an ordinary broken folder must not
      // pick up the tag.
      rerender(<InstallationTile installation={makeInstallation({ status: 'invalid' })} size="card" />)
      expect(screen.queryByTestId('installation-tile-failed-tag')).toBeNull()
    })

    it('an installation without the field renders exactly as before (AC8)', () => {
      render(<InstallationTile installation={makeInstallation()} size="rail" />)

      expect(screen.queryByTestId('installation-tile-failed-tag')).toBeNull()
      expect(screen.queryByTestId('installation-tile-demo-tag')).toBeNull()
      expect(screen.getByText('R1')).toBeTruthy()
    })
  })
})
