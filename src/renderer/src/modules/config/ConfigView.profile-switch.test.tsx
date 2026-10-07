// @vitest-environment jsdom
import './test/bridge'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockClient } from '../../test-support/mock-client'
import { initI18n } from '../../i18n'
import { profileFixture } from './test/fixtures'

vi.stubGlobal(
  'ResizeObserver',
  class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  },
)

Element.prototype.scrollIntoView = (): void => {}

const PROFILES = [
  profileFixture({ id: 'p1', name: 'Competitive' }),
  profileFixture({ id: 'p2', name: 'Casual' }),
]

vi.mock('./client', (importOriginal) =>
  mockClient<typeof import('./client')>(importOriginal, {
    listConfigProfiles: async () => ({ ok: true as const, value: PROFILES }),
    getSwitchBinds: async () => ({ ok: true as const, value: {} }),
  }),
)
vi.mock('./lib/use-drift-state', () => ({
  useDriftState: () => ({ status: { kind: 'loading' as const }, refetch: () => {} }),
}))
vi.mock('./lib/useFileSourceRefresh', () => ({ useFileSourceRefresh: () => {} }))

const { ConfigView } = await import('./ConfigView')
const { useConfigProfiles } = await import('./config-profiles-store')
const { useLauncher, ROUTE_HOME } = await import('../../store/useLauncher')

beforeAll(() => initI18n('en'))
beforeEach(() => {
  useConfigProfiles.setState({ profiles: PROFILES })
  useLauncher.setState({ route: ROUTE_HOME, routeFocus: null })
})
afterEach(cleanup)

async function openProfile(name: string): Promise<void> {
  const rows = await screen.findAllByTestId('config-profile-row')
  fireEvent.click(rows.find((row) => row.textContent?.includes(name))!)
  await screen.findByTestId('config-profile-header')
}

describe('ConfigView profile switch', () => {
  it('switching profile remounts the detail tabs with fresh state', async () => {
    render(<ConfigView />)
    await openProfile('Competitive')

    fireEvent.click(screen.getByRole('button', { name: 'Start test mode' }))
    await screen.findByRole('button', { name: 'Stop test mode' })

    // A route focus arriving while the detail screen stays open switches the profile in place.
    act(() => {
      useLauncher.getState().setRoute('/config', 'p2')
      useConfigProfiles.setState({ profiles: [...PROFILES] })
    })
    await waitFor(() =>
      expect(screen.getByTestId('config-profile-identity').textContent).toContain('Casual'),
    )

    expect(screen.getByRole('button', { name: 'Start test mode' })).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: /^Controls/ }))
    expect(((await screen.findByLabelText('Filter actions…')) as HTMLInputElement).value).toBe('')
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Movement' }).getAttribute('aria-pressed')).toBe(
        'true',
      ),
    )
  })
})
