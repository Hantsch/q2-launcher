// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConfigAction, ConfigActionCategory, ConfigProfile } from '@shared/modules/config'
import { initI18n } from '../../i18n'
import { ProfileChangesProvider } from './lib/profile-changes'

// `ControlsTab`'s import chain reaches `lib/bridge.ts`, which resolves `window.q2` at *module*
// scope and throws when it is missing - so the bridge has to exist before this file's imports are
// evaluated (same idiom as `ControlsTab.dnd.test.tsx`). `invoke` is replaced per test below.
const bridge = vi.hoisted(() => {
  const stub = {
    invoke: vi.fn(() => Promise.resolve({ ok: true, value: [] })),
    on: () => () => {},
  }
  ;(globalThis as unknown as { q2: unknown }).q2 = stub
  return stub
})

// eslint-disable-next-line import/first -- must be imported after the bridge stub above exists.
const { ControlsTab } = await import('./ControlsTab')
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const CATEGORIES: ConfigActionCategory[] = [
  { id: 'movement', name: 'Movement' },
  { id: 'weapons', name: 'Weapons' },
]

const ACTIONS: ConfigAction[] = [
  // A real catalogue row - `movement:forward` resolves through `allCatalogRows()`/`catalogRowInfo`
  // to the translated label "Forward" (`en.json`'s `config.controls.catalog.movement.forward`).
  {
    id: 'f',
    categoryId: 'movement',
    name: 'movement:forward',
    catalogId: 'movement:forward',
    kind: 'bind',
    commands: [],
  },
  {
    id: 'free',
    categoryId: 'movement',
    name: 'My own bind',
    kind: 'bind',
    commands: [],
  },
]

let bindingKeys: string[] = []

function profileFixture(): ConfigProfile {
  return {
    id: 'p1',
    name: 'Profile',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    cvars: {},
    binds: {},
    assignments: [],
    categories: CATEGORIES.map((category) => ({ ...category })),
    actions: ACTIONS.map((entry) => ({ ...entry, keys: bindingKeys.map((key) => ({ key })) })),
  }
}

let container: HTMLDivElement
let root: Root
/** Every `actions` array `ControlsTab` tried to persist, in order. */
let saved: ConfigAction[][]

beforeAll(async () => {
  await initI18n('en')
})

function Harness() {
  const [draft, setDraft] = useState<ConfigProfile>(profileFixture)
  const profile = profileFixture()
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

function renderTab(): void {
  act(() => {
    root.render(<Harness />)
  })
}

beforeEach(() => {
  // jsdom implements no scrolling at all, so `scrollIntoView` does not even exist to be spied on;
  // `ControlsTab` scrolls the selected chip into view on every category change.
  HTMLElement.prototype.scrollIntoView = () => {}
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  saved = []
  bridge.invoke = vi.fn((_channel: string, payload: unknown) => {
    const envelope = payload as { type: string; payload?: { actions?: ConfigAction[] } }
    if (envelope.payload?.actions) saved.push(envelope.payload.actions)
    return Promise.resolve({ ok: true, value: [] })
  }) as unknown as typeof bridge.invoke
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

describe('ControlsTab binding layout', () => {
  it.each(['f', 'free'])(
    'keeps two bindings inline for %s and folds the third by default',
    async (id) => {
      bindingKeys = ['g', 'h']
      renderTab()
      const row = () => container.querySelector<HTMLElement>('.ctrl-row[data-row-id="' + id + '"]')!
      const extras = () => container.querySelectorAll('.ctrl-keysub-row[data-row-id="' + id + '"]')
      const slots = () => row().querySelectorAll<HTMLButtonElement>('.ctrl-keycell .ctrl-slot')
      expect(slots()[0].textContent).toBe('g')
      expect(slots()[1].textContent).toBe('h')
      expect(extras()).toHaveLength(0)
      expect(row().querySelector('.ctrl-keymore')).toBeNull()
      await act(async () => {
        slots()[2].click()
      })
      await act(async () => {
        window.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'j', code: 'KeyJ', bubbles: true }),
        )
      })
      expect(saved.at(-1)?.find((entry) => entry.id === id)?.keys).toHaveLength(3)
      const toggle = () => row().querySelector<HTMLButtonElement>('.ctrl-keymore')!
      expect(toggle().getAttribute('aria-expanded')).toBe('false')
      expect(extras()).toHaveLength(0)
      act(() => toggle().click())
      expect(toggle().getAttribute('aria-expanded')).toBe('true')
      expect(extras()).toHaveLength(3)
      act(() => toggle().click())
      expect(extras()).toHaveLength(0)
      act(() => toggle().click())
      await act(async () => {
        slots()[0].click()
      })
      await act(async () => {
        window.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Delete', code: 'Delete', bubbles: true }),
        )
      })
      expect(slots()[0].textContent).toBe('h')
      expect(slots()[1].textContent).toBe('j')
      expect(extras()).toHaveLength(0)
      expect(row().querySelector('.ctrl-keymore')).toBeNull()
    },
  )
})
