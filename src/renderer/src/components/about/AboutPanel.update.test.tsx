// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { UpdateState } from '@shared/types'
import { initI18n } from '../../i18n'

/**
 * Story 099 D4: the About panel's pending-update block, rendered above this-version's own notes
 * (D3) whenever 097/098's update state names a known release (`update.update !== null`). Same
 * stubbing convention as `UpdatePopover.test.tsx` - `window.q2` is resolved at *module* scope by
 * `lib/bridge.ts`, so the bridge stub must exist before the store (and anything importing it) is
 * imported - and a real `useLauncher.setState` drives every phase.
 */

const IDLE_UPDATE_STATE: UpdateState = {
  status: 'idle',
  phase: 'idle',
  update: null,
  error: null,
  progress: null,
  dismissed: false,
  lastCheckedAt: null,
  lastSuccessAt: null,
  supported: true,
}

const AVAILABLE_STATE: UpdateState = {
  ...IDLE_UPDATE_STATE,
  status: 'available',
  phase: 'available',
  update: { version: '1.2.3', notes: '### Added\n- A new thing\n\n### Fixed\n- A fixed thing', releasedAt: null },
}

const AVAILABLE_NO_NOTES_STATE: UpdateState = {
  ...AVAILABLE_STATE,
  update: { version: '1.2.3', notes: '   ', releasedAt: null },
}

const bridge = vi.hoisted(() => {
  const responses = new Map<string, unknown>()
  const invoke = vi.fn((channel: string) => Promise.resolve(responses.get(channel)))
  const on = vi.fn(() => () => {})
  ;(globalThis as unknown as { q2: unknown }).q2 = { invoke, on }
  return { responses, invoke }
})

const { useLauncher } = await import('../../store/useLauncher')
const { AboutPanel } = await import('./AboutPanel')

beforeAll(async () => {
  await initI18n('en')
})

afterEach(() => {
  cleanup()
  bridge.invoke.mockClear()
  bridge.responses.clear()
  useLauncher.setState({ update: IDLE_UPDATE_STATE })
})

describe('AboutPanel pending update block', () => {
  it('renders the version, "not yet installed" badge, and parsed notes when a release is known', async () => {
    useLauncher.setState({ update: AVAILABLE_STATE })
    render(createElement(AboutPanel))

    const block = await screen.findByTestId('about-update-available')
    expect(block).toBeTruthy()
    expect(screen.getByTestId('about-update-version').textContent).toBe('Version 1.2.3')
    expect(screen.getByText('Not yet installed')).toBeTruthy()

    const notes = screen.getByTestId('about-update-notes')
    expect(notes.querySelectorAll('h2')).toHaveLength(2)
    expect(screen.getByText('A new thing')).toBeTruthy()
    expect(screen.getByText('A fixed thing')).toBeTruthy()

    expect(screen.getByTestId('about-update-action')).toBeTruthy()
    expect(screen.getByTestId('update-popover-download')).toBeTruthy()
  })

  it('renders the empty-state sentence, not a blank block, when the pending notes are empty', async () => {
    useLauncher.setState({ update: AVAILABLE_NO_NOTES_STATE })
    render(createElement(AboutPanel))

    await screen.findByTestId('about-update-available')
    const notes = screen.getByTestId('about-update-notes')
    expect(notes.textContent).toContain('This version has no release notes.')
  })

  it('renders neither the block nor its children when no update is known (up to date)', async () => {
    useLauncher.setState({ update: IDLE_UPDATE_STATE })
    render(createElement(AboutPanel))

    await waitFor(() => expect(screen.getByTestId('about-release-notes-empty')).toBeTruthy())
    expect(screen.queryByTestId('about-update-available')).toBeNull()
    expect(screen.queryByTestId('about-update-version')).toBeNull()
    expect(screen.queryByTestId('about-update-notes')).toBeNull()
    expect(screen.queryByTestId('about-update-action')).toBeNull()
  })

  it('the action button is the same UpdateAction the titlebar popover uses, wired to the same store action', async () => {
    useLauncher.setState({ update: AVAILABLE_STATE })
    bridge.responses.set('update:download', { ok: true, value: AVAILABLE_STATE })
    render(createElement(AboutPanel))

    const button = await screen.findByTestId('update-popover-download')
    fireEvent.click(button)

    await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('update:download'))
  })
})
