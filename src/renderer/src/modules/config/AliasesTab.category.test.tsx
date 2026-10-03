// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConfigAction, ConfigProfile } from '@shared/modules/config'
import { initI18n } from '../../i18n'
import { mockClient } from '../../test-support/mock-client'
import { ProfileChangesProvider } from './lib/profile-changes'

// `lib/bridge.ts` resolves `window.q2` at module scope, so the stub must exist before the surfaces
// are imported.
vi.hoisted(() => {
  ;(globalThis as unknown as { q2: unknown }).q2 = { invoke: vi.fn(), on: () => () => {} }
})

vi.mock('./client', (importOriginal) =>
  mockClient<typeof import('./client')>(importOriginal, {
    updateProfileActions: vi.fn(async (input: { actions: ConfigAction[] }) => ({
      ok: true as const,
      value: [{ ...profileWith([{ id: 'my-cat', name: 'Mine' }]), actions: input.actions }],
    })),
  }),
)

const { AliasesTab } = await import('./AliasesTab')
const { ProfileDraftProvider } = await import('./lib/ProfileDraftProvider')
const { ControlsTab } = await import('./ControlsTab')
const { updateProfileActions } = await import('./client')

function profileWith(categories: { id: string; name: string }[]): ConfigProfile {
  return {
    id: 'p1',
    name: 'Profile',
    createdAt: '',
    updatedAt: '',
    cvars: {},
    binds: {},
    assignments: [],
    categories,
    actions: [],
  }
}

function renderAliases(profile: ConfigProfile) {
  return render(
    <ProfileDraftProvider profile={profile}>
      <AliasesTab onNavigateToAction={() => {}} onNavigateToLayer={() => {}} />
    </ProfileDraftProvider>,
  )
}

beforeAll(async () => {
  await initI18n('en')
})

beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = () => {}
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('AliasesTab new alias category', () => {
  it("a new alias lands in the profile's first custom category and shows in the Controls rail", async () => {
    const profile = profileWith([{ id: 'my-cat', name: 'Mine' }])
    renderAliases(profile)
    fireEvent.click(screen.getByRole('button', { name: 'New alias' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Fresh' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create alias' }))
    await waitFor(() => expect(updateProfileActions).toHaveBeenCalled())

    const payload = vi.mocked(updateProfileActions).mock.calls[0][0]
    const created = payload.actions[0]
    expect(created.categoryId).toBe('my-cat')
    cleanup()

    const next = { ...profile, actions: payload.actions }
    render(
      <ProfileChangesProvider profile={next}>
        <ProfileDraftProvider profile={next}>
          <ControlsTab />
        </ProfileDraftProvider>
      </ProfileChangesProvider>,
    )
    expect(screen.getByTestId(`action-edit-${created.id}`)).toBeTruthy()
  })

  it('New alias is disabled with a visible reason when the profile has no categories', () => {
    renderAliases(profileWith([]))
    const button = screen.getByRole('button', { name: 'New alias' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(screen.getByText('Add a category in Controls first.')).toBeTruthy()
  })
})
