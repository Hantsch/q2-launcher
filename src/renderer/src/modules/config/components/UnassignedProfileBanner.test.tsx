// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { initI18n } from '../../../i18n'
import { makeConfigProfile } from '../../../../../test-support/fixtures'
import { UnassignedProfileBanner } from './UnassignedProfileBanner'

beforeAll(async () => {
  await initI18n('en')
})

afterEach(() => {
  cleanup()
})

describe('UnassignedProfileBanner', () => {
  it('a profile with no assignments shows the not-used warning', () => {
    render(<UnassignedProfileBanner profile={makeConfigProfile()} onAssign={() => {}} />)

    expect(screen.getByText('No installation uses this config')).toBeTruthy()
  })

  it('Assign… calls onAssign', () => {
    const onAssign = vi.fn()
    render(<UnassignedProfileBanner profile={makeConfigProfile()} onAssign={onAssign} />)

    fireEvent.click(screen.getByRole('button', { name: 'Assign…' }))

    expect(onAssign).toHaveBeenCalledTimes(1)
  })

  it('an assigned profile renders no banner', () => {
    const profile = makeConfigProfile({
      assignments: [{ installationId: 'i1', isDefault: true }],
    })
    render(<UnassignedProfileBanner profile={profile} onAssign={() => {}} />)

    expect(screen.queryByText('No installation uses this config')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Assign…' })).toBeNull()
  })
})
