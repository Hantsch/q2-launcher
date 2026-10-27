// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { initI18n } from '../../../i18n'
import { makeConfigProfile } from '../../../../../test-support/fixtures'
import { useConfigProfiles } from '../config-profiles-store'
import { ConfigListScreen } from './ConfigListScreen'

vi.hoisted(() => {
  ;(globalThis as unknown as { q2: unknown }).q2 = {
    invoke: () => Promise.resolve({ ok: true, value: {} }),
    on: () => () => {},
  }
})

vi.mock('../InstallationProfilesPanel', () => ({ InstallationProfilesPanel: () => null }))

beforeAll(async () => {
  await initI18n('en')
})

beforeEach(() => {
  useConfigProfiles.setState({ profiles: [] })
})

afterEach(() => {
  cleanup()
})

function renderList() {
  render(<ConfigListScreen onOpen={() => {}} onCreate={() => {}} />)
}

describe('ConfigListScreen', () => {
  it("an unassigned profile's row carries a Not assigned text marker", () => {
    useConfigProfiles.setState({
      profiles: [makeConfigProfile({ id: 'p1', name: 'Loose', assignments: [] })],
    })

    renderList()

    const row = screen.getByTestId('config-profile-row')
    expect(row.textContent).toContain('Not assigned')
    expect(screen.getByTestId('config-profile-unassigned').textContent).toBe('Not assigned')
  })

  it("an assigned profile's row has no marker", () => {
    useConfigProfiles.setState({
      profiles: [
        makeConfigProfile({
          id: 'p2',
          name: 'Used',
          assignments: [{ installationId: 'i1', isDefault: true }],
        }),
      ],
    })

    renderList()

    expect(screen.getByTestId('config-profile-row').textContent).not.toContain('Not assigned')
    expect(screen.queryByTestId('config-profile-unassigned')).toBeNull()
  })
})
