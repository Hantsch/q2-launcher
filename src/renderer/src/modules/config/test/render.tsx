import './bridge'
import type { ReactElement } from 'react'
import { cleanup, render, type RenderResult } from '@testing-library/react'
import { afterEach, beforeAll } from 'vitest'
import type { ConfigProfile } from '@shared/modules/config'
import { initI18n } from '../../../i18n'
import { ProfileChangesProvider } from '../lib/profile-changes'
import { ProfileDraftProvider } from '../lib/ProfileDraftProvider'
import { profileFixture } from './fixtures'

// Vitest globals are off, so testing-library neither flags the act environment nor unmounts.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
beforeAll(() => initI18n('en'))
afterEach(cleanup)

export interface RenderWithProvidersResult extends RenderResult {
  profile: ConfigProfile
}

/**
 * Mounts `ui` the way the config view does. The profile object is created once per call: a fresh
 * object per render would reseed the draft provider.
 */
export function renderWithProviders(
  ui: ReactElement,
  options: { profile?: ConfigProfile } = {},
): RenderWithProvidersResult {
  const profile = options.profile ?? profileFixture()
  const result = render(
    <ProfileChangesProvider profile={profile}>
      <ProfileDraftProvider profile={profile}>{ui}</ProfileDraftProvider>
    </ProfileChangesProvider>,
  )
  return Object.assign(result, { profile })
}
