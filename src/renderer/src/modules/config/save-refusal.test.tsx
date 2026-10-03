// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConfigProfile } from '@shared/modules/config'
import { initI18n } from '../../i18n'
import { ProfileChangesProvider } from './lib/profile-changes'
import { SAVE_DEBOUNCE_MS } from './lib/useProfileSave'

// `lib/bridge.ts` resolves `window.q2` at module scope, so the stub must exist before the surfaces
// are imported.
const bridge = vi.hoisted(() => {
  const stub = {
    invoke: vi.fn(),
    on: () => () => {},
  }
  ;(globalThis as unknown as { q2: unknown }).q2 = stub
  return stub
})

const { SettingsTab } = await import('./SettingsTab')
const { ControlsTab } = await import('./ControlsTab')
const { AliasesTab } = await import('./AliasesTab')
const { LayersPanel } = await import('./LayersPanel')
const { ProfileAssignmentsPanel } = await import('./ProfileAssignmentsPanel')
const { Toasts } = await import('../../components/ui/Toasts')
const { useLauncher } = await import('../../store/useLauncher')
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const REFUSAL_TEXT = "Could not write this profile's files to disk."

function profileFixture(): ConfigProfile {
  return {
    id: 'p1',
    name: 'Profile',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    cvars: { name: 'player' },
    binds: {},
    assignments: [],
    cvarSections: [{ id: 's', name: 'Section', cvars: ['name'] }],
    writeCatalogDefaults: false,
  }
}

let container: HTMLDivElement
let root: Root

beforeAll(async () => {
  await initI18n('en')
})

beforeEach(() => {
  vi.useFakeTimers()
  // jsdom implements no scrolling; ControlsTab scrolls the selected category chip into view.
  HTMLElement.prototype.scrollIntoView = () => {}
  bridge.invoke.mockResolvedValue({ ok: false, error: { key: 'config.error.writeFailed' } })
  useLauncher.setState({ toasts: [] })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
  bridge.invoke.mockReset()
})

function ControlsHarness({ profile }: { profile: ConfigProfile }) {
  const [draft, setDraft] = useState(profile)
  return (
    <ProfileChangesProvider profile={profile}>
      <ControlsTab
        profile={profile}
        draft={draft}
        patch={(partial) =>
          setDraft((prev) => ({
            ...prev,
            ...(typeof partial === 'function' ? partial(prev) : partial),
          }))
        }
        onChanged={() => {}}
      />
    </ProfileChangesProvider>
  )
}

function SettingsHarness({ profile }: { profile: ConfigProfile }) {
  const [draft, setDraft] = useState(profile)
  return (
    <ProfileChangesProvider profile={profile}>
      <SettingsTab
        profile={profile}
        draft={draft}
        patch={(partial) =>
          setDraft((prev) => ({
            ...prev,
            ...(typeof partial === 'function' ? partial(prev) : partial),
          }))
        }
        onChanged={() => {}}
      />
    </ProfileChangesProvider>
  )
}

async function settle(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS + 10)
  })
}

describe('a refused profile save', () => {
  it('SettingsTab shows the refusal toast', async () => {
    act(() => {
      root.render(
        <>
          <SettingsHarness profile={profileFixture()} />
          <Toasts />
        </>,
      )
    })
    const input = container.querySelector<HTMLInputElement>('[data-cvar-name="name"] input')
    if (!input) throw new Error('no cvar input rendered')
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, 'renamed')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await settle()
    expect(container.textContent).toContain(REFUSAL_TEXT)
  })

  it('ControlsTab shows the refusal toast', async () => {
    const profile: ConfigProfile = {
      ...profileFixture(),
      categories: [{ id: 'movement', name: 'Movement' }],
      actions: [
        { id: 'free', categoryId: 'movement', name: 'My own bind', kind: 'bind', commands: [] },
      ],
    }
    act(() => {
      root.render(
        <>
          <ControlsHarness profile={profile} />
          <Toasts />
        </>,
      )
    })
    const remove = container.querySelector<HTMLButtonElement>('button[aria-label="Remove…"]')
    if (!remove) throw new Error('no remove-action button rendered')
    act(() => remove.click())
    await settle()
    expect(container.textContent).toContain(REFUSAL_TEXT)
  })

  it('AliasesTab shows the refusal toast', async () => {
    const profile: ConfigProfile = {
      ...profileFixture(),
      categories: [{ id: 'movement', name: 'Movement' }],
      actions: [
        { id: 'own', categoryId: 'movement', name: 'My alias', kind: 'alias', commands: [] },
      ],
    }
    act(() => {
      root.render(
        <>
          <AliasesTab
            profile={profile}
            draft={profile}
            patch={() => {}}
            onChanged={() => {}}
            onNavigateToAction={() => {}}
            onNavigateToLayer={() => {}}
          />
          <Toasts />
        </>,
      )
    })
    const remove = container.querySelector<HTMLButtonElement>('button[aria-label^="Delete"]')
    if (!remove) throw new Error('no delete button rendered')
    act(() => remove.click())
    await settle()
    expect(container.textContent).toContain(REFUSAL_TEXT)
  })

  it('LayersPanel shows the refusal toast', async () => {
    const profile: ConfigProfile = {
      ...profileFixture(),
      layers: [{ id: 'l1', name: 'Layer', mode: 'hold', triggerKey: null, overrides: {} }],
    }
    act(() => {
      root.render(
        <>
          <ProfileChangesProvider profile={profile}>
            <LayersPanel
              profile={profile}
              activeLayerId={null}
              onSelectLayer={() => {}}
              onChanged={() => {}}
            />
          </ProfileChangesProvider>
          <Toasts />
        </>,
      )
    })
    const select = container.querySelector<HTMLSelectElement>('select')
    if (!select) throw new Error('no mode select rendered')
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
      setter?.call(select, 'toggle')
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await settle()
    expect(container.textContent).toContain(REFUSAL_TEXT)
  })

  it('ProfileAssignmentsPanel shows the refusal toast', async () => {
    useLauncher.setState({
      installations: [{ id: 'i1', name: 'Install', engineKind: 'r1q2' }] as never,
    })
    act(() => {
      root.render(
        <>
          <ProfileAssignmentsPanel profile={profileFixture()} onChanged={() => {}} />
          <Toasts />
        </>,
      )
    })
    const box = container.querySelector<HTMLInputElement>('input[type="checkbox"]')
    if (!box) throw new Error('no assignment checkbox rendered')
    act(() => box.click())
    await settle()
    expect(container.textContent).toContain(REFUSAL_TEXT)
  })
})
