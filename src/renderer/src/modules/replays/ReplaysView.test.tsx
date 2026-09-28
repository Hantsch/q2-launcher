// @vitest-environment jsdom
import { createElement } from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { DiscoveredDemo } from '@shared/modules/replays'
import en from '../../i18n/locales/en.json'
import { initI18n } from '../../i18n'

/**
 * Story 141 D4. Mirrors `ServersView.test.tsx`'s convention: the module's own typed client
 * (`./client`) is stubbed directly via `vi.mock`, rather than going through `window.q2`'s
 * `invoke`/`on` plumbing.
 */
vi.hoisted(() => {
  const invoke = vi.fn(() => Promise.resolve(undefined))
  const on = vi.fn(() => () => {})
  ;(globalThis as unknown as { q2: unknown }).q2 = { invoke, on }
})

const { listDemosMock } = vi.hoisted(() => ({
  listDemosMock: vi.fn(),
}))

vi.mock('./client', () => ({
  listDemos: listDemosMock,
}))

let ReplaysView: typeof import('./ReplaysView').ReplaysView

beforeAll(async () => {
  await initI18n('en')
  ;({ ReplaysView } = await import('./ReplaysView'))
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const DEMO: DiscoveredDemo = {
  id: '0123456789abcdef',
  fileName: 'ffa1_2026-01-02.dm2',
  format: 'dm2',
  gzip: false,
  source: {
    kind: 'installation',
    installationId: 'inst-1',
    installationName: 'My Install',
    gameDir: 'baseq2',
  },
}

async function renderView(demos: DiscoveredDemo[]): Promise<void> {
  listDemosMock.mockResolvedValue({ ok: true, value: demos })
  render(createElement(ReplaysView))
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

function stringAt(path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (acc, key) => (acc && typeof acc === 'object' && key in acc ? (acc as Record<string, unknown>)[key] : undefined),
      en,
    )
}

describe('ReplaysView (story 141 D4)', () => {
  it('each row shows the file name and its installation and game dir', async () => {
    await renderView([DEMO])

    const row = await screen.findByTestId('replays-demo-row')
    expect(row.getAttribute('data-demo-id')).toBe(DEMO.id)

    const name = screen.getByTestId('replays-demo-name')
    expect(name.textContent).toBe('ffa1_2026-01-02.dm2')

    const source = screen.getByTestId('replays-demo-source')
    expect(source.textContent).toBe('My Install · baseq2')
  })

  it('an empty discovery shows the empty line', async () => {
    await renderView([])

    const empty = await screen.findByTestId('replays-list-empty')
    expect(empty.textContent).toBe('No demos found.')
    expect(screen.queryByTestId('replays-demo-list')).toBeNull()
  })

  it('every new string comes from the replays block', async () => {
    await renderView([DEMO])

    const heading = await screen.findByRole('heading', { name: 'Demos' })
    expect(heading.textContent).toBe(stringAt('replays.view.title'))

    const source = screen.getByTestId('replays-demo-source')
    expect(source.textContent).toBe(
      // The raw file name is data, not i18n - excluded here; only the source template's rendering
      // is checked against the shared block.
      (stringAt('replays.list.source') as string)
        .replace('{{installation}}', DEMO.source.installationName)
        .replace('{{gameDir}}', DEMO.source.gameDir),
    )

    // Every i18n key this view renders lives under the top-level `replays` block.
    for (const key of ['replays.view.title', 'replays.list.label', 'replays.list.loading', 'replays.list.empty', 'replays.list.source']) {
      expect(key).toMatch(/^replays\./)
      expect(typeof stringAt(key)).toBe('string')
    }
  })
})

describe('ReplaysView - loading state (story 141 D4)', () => {
  it('shows the loading line before listDemos resolves', async () => {
    let resolve!: (value: { ok: true; value: DiscoveredDemo[] }) => void
    listDemosMock.mockReturnValue(
      new Promise((r) => {
        resolve = r
      }),
    )

    render(createElement(ReplaysView))

    const loading = await screen.findByTestId('replays-list-loading')
    expect(loading.textContent).toBe('Looking for demos…')

    await act(async () => {
      resolve({ ok: true, value: [] })
      await Promise.resolve()
    })
  })
})
