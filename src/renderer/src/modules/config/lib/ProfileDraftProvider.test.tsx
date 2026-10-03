// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConfigProfile } from '@shared/modules/config'
import { useLauncher } from '../../../store/useLauncher'
import { useConfigProfiles } from '../config-profiles-store'
import {
  ProfileDraftProvider,
  useProfileDraftContext,
  type ProfileDraftContextValue,
} from './ProfileDraftProvider'

vi.hoisted(() => {
  ;(globalThis as unknown as { q2: unknown }).q2 = {
    invoke: () => Promise.resolve({ ok: true, value: {} }),
    on: () => () => {},
  }
})

function profile(id: string, name = id): ConfigProfile {
  return {
    id,
    name,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    cvars: {},
    binds: {},
    assignments: [],
  }
}

let current: ProfileDraftContextValue

function Probe() {
  current = useProfileDraftContext()
  return null
}

function mount(p: ConfigProfile): void {
  const wrap = (children: ReactNode) => (
    <ProfileDraftProvider profile={p}>{children}</ProfileDraftProvider>
  )
  render(wrap(<Probe />))
}

beforeEach(() => {
  useConfigProfiles.setState({ profiles: [profile('a'), profile('b')] })
  useLauncher.setState({ installations: [] })
})

afterEach(cleanup)

describe('ProfileDraftProvider', () => {
  it('exposes profile, draft, patch, installations and save', () => {
    const p = profile('a')
    mount(p)

    expect(current.profile).toBe(p)
    expect(current.draft.id).toBe('a')
    expect(typeof current.patch).toBe('function')
    expect(current.installations).toBe(useLauncher.getState().installations)
    expect(typeof current.save).toBe('function')
  })

  it('save with a list replaces the store, with one profile upserts it', () => {
    mount(profile('a'))

    act(() => current.save([profile('c')]))
    expect(useConfigProfiles.getState().profiles.map((x) => x.id)).toEqual(['c'])

    act(() => current.save(profile('c', 'renamed')))
    act(() => current.save(profile('d')))
    expect(useConfigProfiles.getState().profiles.map((x) => x.name)).toEqual(['renamed', 'd'])
  })

  it('patch changes draft but not profile', () => {
    const p = profile('a')
    mount(p)

    act(() => current.patch({ cvars: { sensitivity: '3' } }))

    expect(current.draft.cvars).toEqual({ sensitivity: '3' })
    expect(current.profile.cvars).toEqual({})
  })

  it('useProfileDraftContext throws outside the provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Probe />)).toThrow(/ProfileDraftProvider/)
    spy.mockRestore()
  })
})
