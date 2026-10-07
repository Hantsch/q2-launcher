import type { ConfigProfile } from '@shared/modules/config'
import { makeConfigProfile } from '../../../../../test-support/fixtures'

/**
 * The Controls tab's default profile: two categories, one catalogue action (`movement:forward`
 * resolves to a translated label) and one free-named action. Every collection is fresh per call so
 * a test can mutate it without leaking into the next.
 */
export function profileFixture(overrides: Partial<ConfigProfile> = {}): ConfigProfile {
  return makeConfigProfile({
    name: 'Profile',
    categories: [
      { id: 'movement', name: 'Movement' },
      { id: 'weapons', name: 'Weapons' },
    ],
    actions: [
      {
        id: 'f',
        categoryId: 'movement',
        name: 'movement:forward',
        catalogId: 'movement:forward',
        kind: 'bind',
        commands: [],
      },
      { id: 'free', categoryId: 'movement', name: 'My own bind', kind: 'bind', commands: [] },
    ],
    ...overrides,
  })
}
