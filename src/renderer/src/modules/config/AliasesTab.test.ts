// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { ConfigAction, ConfigProfile } from '@shared/modules/config'
import { initI18n } from '../../i18n'
import { AliasesTab } from './AliasesTab'

/**
 * Story 055 D4: the Aliases tab's own copy of the two drop toggles (the User's decision - they
 * show here too, not only on Controls), wired to the same `applyDropAmmo`/`applyDropMessage`
 * (`lib/catalog-binds.ts`) D3 already wrote for Controls. `updateProfileActions` is mocked here
 * (rather than stubbing `window.q2` and letting the real IPC call reject, as
 * `ControlsTab.dialogs.test.ts` does for its dialog-only tests) because these tests need to see
 * *what* gets saved - the resulting `commands` array a toggle click produces - not just that a
 * save was attempted.
 *
 * `.ts` extension with `createElement`, matching `ControlsTab.dialogs.test.ts`'s and
 * `DropToggles.test.ts`'s own precedent for a renderer test that mounts real components without a
 * `.tsx` file.
 */

vi.mock('./client', () => ({
  updateProfileActions: vi.fn(async (input: { actions: ConfigAction[] }) => ({
    ok: true,
    value: [{ ...baseProfile(), actions: input.actions }],
  })),
}))

beforeAll(async () => {
  await initI18n('en')
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function baseProfile(): ConfigProfile {
  return {
    id: 'profile-1',
    name: 'Profile',
    createdAt: '',
    updatedAt: '',
    cvars: {},
    binds: {},
    assignments: [],
  }
}

/** A `drop_shotgun`-shaped alias, editable (`kind: 'alias'`), with a known-ammo item so the ammo
 * toggle starts enabled but off. */
function dropAction(overrides: Partial<ConfigAction> = {}): ConfigAction {
  return {
    id: 'a-drop',
    categoryId: 'drops',
    name: 'Drop shotgun',
    kind: 'alias',
    aliasName: 'drop_shotgun',
    commands: [{ kind: 'raw', text: 'drop shotgun' }],
    ...overrides,
  }
}

/** A plain, editable alias with no `drop` command at all - `isDropEntry` must read this as false. */
function plainAliasAction(): ConfigAction {
  return {
    id: 'a-plain',
    categoryId: 'movement',
    name: 'My alias',
    kind: 'alias',
    aliasName: 'my_alias',
    commands: [{ kind: 'raw', text: 'echo hi' }],
  }
}

/** A `kind: 'bind'` entry (non-`editable` in the Aliases tab, `origin: 'generated'`) whose
 * `aliasName`/body would otherwise satisfy `isDropEntry` - proving the toggles are gated on
 * `row.editable` too, not only on dropness. */
function generatedDropLikeAction(): ConfigAction {
  return {
    id: 'a-bind',
    categoryId: 'drops',
    name: 'Some bound row',
    kind: 'bind',
    aliasName: 'drop_bound',
    commands: [{ kind: 'raw', text: 'drop railgun' }],
    keys: [{ key: 'Q' }],
  }
}

function renderTab(actions: ConfigAction[]) {
  const profile = { ...baseProfile(), actions }
  return render(
    createElement(AliasesTab, {
      profile,
      draft: profile,
      patch: () => {},
      onChanged: () => {},
      onNavigateToAction: () => {},
      onNavigateToLayer: () => {},
    }),
  )
}

describe('AliasesTab drop toggles (story 055 D4)', () => {
  it('shows the two drop toggles on an editable drop alias row and toggles ammo through applyDropAmmo', async () => {
    renderTab([dropAction()])

    const ammoButton = screen.getByTestId('alias-drop-ammo-a-drop').querySelector('button')!
    const messageButton = screen.getByTestId('alias-drop-message-a-drop').querySelector('button')!
    expect(ammoButton).toBeTruthy()
    expect(messageButton).toBeTruthy()
    // Ammo enabled (shotgun has known ammo `shells`) but currently off - no `drop shells` yet.
    expect(ammoButton.getAttribute('aria-pressed')).toBe('false')
    expect((ammoButton as HTMLButtonElement).disabled).toBe(false)

    const { updateProfileActions } = await import('./client')
    fireEvent.click(ammoButton)

    expect(updateProfileActions).toHaveBeenCalledWith(
      expect.objectContaining({
        actions: [
          expect.objectContaining({
            id: 'a-drop',
            commands: [
              { kind: 'raw', text: 'drop shotgun' },
              { kind: 'raw', text: 'drop shells' },
            ],
          }),
        ],
      }),
    )
  })

  /**
   * Story 055 review, finding 2: turning the message toggle ON must NOT write a command. It used to
   * call `applyDropMessage(..., true)` with no text, i.e. write an argument-less `say_team` into
   * the rendered `.cfg` - and since the toggle's pressed state is "a non-empty stored message", it
   * snapped straight back to off, leaving that command unremovable through the UI. Controls reveals
   * story 029's inline row instead; this tab reveals the same `MessageEditor` modal, and only its
   * save writes.
   */
  it('reveals the message editor on toggle-on and writes nothing until text is saved', async () => {
    renderTab([dropAction()])
    const messageButton = screen.getByTestId('alias-drop-message-a-drop').querySelector('button')!
    expect(messageButton.getAttribute('aria-pressed')).toBe('false')

    const { updateProfileActions } = await import('./client')
    fireEvent.click(messageButton)

    expect(updateProfileActions).not.toHaveBeenCalled()
    const dialog = screen.getByRole('dialog')

    const input = dialog.querySelector('input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'dropped shotgun' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(updateProfileActions).toHaveBeenCalledWith(
      expect.objectContaining({
        actions: [
          expect.objectContaining({
            id: 'a-drop',
            commands: [
              { kind: 'raw', text: 'drop shotgun' },
              { kind: 'message', channel: 'say_team', text: 'dropped shotgun' },
            ],
          }),
        ],
      }),
    )
  })

  it('removes the message command on toggle-off, leaving the drop and its extras in place', async () => {
    renderTab([
      dropAction({
        commands: [
          { kind: 'raw', text: 'drop shotgun' },
          { kind: 'message', channel: 'say_team', text: 'dropped shotgun' },
          { kind: 'raw', text: 'wave 1' },
        ],
      }),
    ])
    const messageButton = screen.getByTestId('alias-drop-message-a-drop').querySelector('button')!
    expect(messageButton.getAttribute('aria-pressed')).toBe('true')

    const { updateProfileActions } = await import('./client')
    fireEvent.click(messageButton)

    expect(updateProfileActions).toHaveBeenCalledWith(
      expect.objectContaining({
        actions: [
          expect.objectContaining({
            id: 'a-drop',
            commands: [
              { kind: 'raw', text: 'drop shotgun' },
              { kind: 'raw', text: 'wave 1' },
            ],
          }),
        ],
      }),
    )
  })

  it('shows no toggles on a non-drop editable alias row', () => {
    renderTab([plainAliasAction()])
    expect(screen.queryByTestId('alias-drop-ammo-a-plain')).toBeNull()
    expect(screen.queryByTestId('alias-drop-message-a-plain')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Drop ammo too' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Announce to team' })).toBeNull()
  })

  it('shows no toggles on a non-editable (generated) row even when its body looks like a drop', () => {
    renderTab([generatedDropLikeAction()])
    // Only visible once "show all" (origin: user default filter hides generated/layer rows) -
    // widen to it so the row is actually rendered, and still assert no toggles.
    fireEvent.click(screen.getByLabelText(/Show generated/i))
    expect(screen.queryByTestId('alias-drop-ammo-a-bind')).toBeNull()
    expect(screen.queryByTestId('alias-drop-message-a-bind')).toBeNull()
  })
})
