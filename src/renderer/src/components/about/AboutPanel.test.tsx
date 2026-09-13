// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { APP_CHANGELOG_URL, APP_REPO_URL } from '@shared/constants'
import type { ReleaseNoteSection } from '@shared/release-notes'
import { initI18n } from '../../i18n'
import { AboutPanel } from './AboutPanel'

/**
 * Story 099 D3. `../../lib/bridge` is stubbed rather than `window.q2` itself (mirrors
 * `SettingsView.test.tsx`), since jsdom has no preload bridge and these tests need to control
 * exactly what `app:getReleaseNotes` resolves to.
 */
const invoke = vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => undefined)

vi.mock('../../lib/bridge', () => ({
  invoke: (...args: unknown[]) => invoke(...(args as [string])),
  onEvent: vi.fn(),
}))

beforeAll(async () => {
  await initI18n('en')
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const HTML_LOOKING_ITEM = '<img src=x onerror="alert(1)">'

describe('AboutPanel', () => {
  it('renders release note sections as headings and list items when app:getReleaseNotes resolves with sections', async () => {
    const sections: ReleaseNoteSection[] = [
      { heading: 'Added', items: ['A new thing'] },
      { heading: 'Fixed', items: ['A fixed thing', 'Another fixed thing'] },
    ]
    invoke.mockResolvedValueOnce({ version: '1.2.3', date: '2026-01-01', sections })

    render(createElement(AboutPanel))

    const notes = await screen.findByTestId('about-release-notes')
    expect(screen.getByText('Added')).toBeTruthy()
    expect(screen.getByText('Fixed')).toBeTruthy()
    expect(notes.querySelectorAll('h2')).toHaveLength(2)
    expect(screen.getByText('A new thing').tagName).toBe('LI')
    expect(screen.getByText('A fixed thing')).toBeTruthy()
    expect(screen.getByText('Another fixed thing')).toBeTruthy()
  })

  it('renders a raw-HTML-looking item as visible text and produces no actual img element (AC6)', async () => {
    const sections: ReleaseNoteSection[] = [{ heading: 'Security', items: [HTML_LOOKING_ITEM] }]
    invoke.mockResolvedValueOnce({ version: '1.2.3', date: '2026-01-01', sections })

    render(createElement(AboutPanel))

    const notes = await screen.findByTestId('about-release-notes')
    expect(notes.textContent).toContain(HTML_LOOKING_ITEM)
    expect(notes.querySelector('img')).toBeNull()
  })

  it('renders the empty-state sentence when app:getReleaseNotes resolves null', async () => {
    invoke.mockResolvedValueOnce(null)

    render(createElement(AboutPanel))

    await waitFor(() => expect(screen.getByTestId('about-release-notes-empty')).toBeTruthy())
    expect(screen.queryByTestId('about-release-notes')).toBeNull()
  })

  it('the repository link invokes app:openExternal with APP_REPO_URL', async () => {
    invoke.mockResolvedValueOnce(null)
    render(createElement(AboutPanel))

    const button = await screen.findByTestId('about-link-repository')
    invoke.mockClear()
    fireEvent.click(button)

    expect(invoke).toHaveBeenCalledWith('app:openExternal', APP_REPO_URL)
  })

  it('the changelog link invokes app:openExternal with APP_CHANGELOG_URL', async () => {
    invoke.mockResolvedValueOnce(null)
    render(createElement(AboutPanel))

    const button = await screen.findByTestId('about-link-changelog')
    invoke.mockClear()
    fireEvent.click(button)

    expect(invoke).toHaveBeenCalledWith('app:openExternal', APP_CHANGELOG_URL)
  })
})
