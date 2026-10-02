// @vitest-environment jsdom
import { createElement } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { ConfigProfile } from '@shared/modules/config'
import { CONFIG_HANDLERS } from '@shared/modules/config'
import { initI18n } from '../../i18n'
import type { useLauncher as useLauncherType } from '../../store/useLauncher'
import type { AddToAddressBookDialog as AddToAddressBookDialogType } from './AddToAddressBookDialog'

function makeProfile(overrides: Partial<ConfigProfile> = {}): ConfigProfile {
  return {
    id: 'p1',
    name: 'Profile 1',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    cvars: {},
    binds: {},
    assignments: [],
    ...overrides,
  }
}

const PROFILE_A = makeProfile({
  id: 'a',
  name: 'Profile A',
  cvars: { adr0: '9.9.9.9:27910' },
  assignments: [{ installationId: 'inst-1', isDefault: true }],
})
const PROFILE_B = makeProfile({
  id: 'b',
  name: 'Profile B',
  cvars: { adr2: '8.8.8.8:27910' },
})

let PROFILES: ConfigProfile[] = [PROFILE_A, PROFILE_B]

function invokeImpl(_channel: string, args: { moduleId: string; type: string; payload?: unknown }) {
  if (args?.moduleId === 'config' && args?.type === CONFIG_HANDLERS.list) {
    return Promise.resolve({ ok: true, value: PROFILES })
  }
  if (args?.moduleId === 'config' && args?.type === CONFIG_HANDLERS.commitCvars) {
    const payload = args.payload as { profileId: string; cvars: Record<string, string> }
    const updated = PROFILES.map((p) =>
      p.id === payload.profileId ? { ...p, cvars: { ...p.cvars, ...payload.cvars } } : p,
    )
    PROFILES = updated
    return Promise.resolve({ ok: true, value: updated.find((p) => p.id === payload.profileId) })
  }
  return Promise.resolve({ ok: false, error: { key: 'unhandled' } })
}

;(globalThis as unknown as { q2: unknown }).q2 = {
  invoke: vi.fn(invokeImpl),
  on: vi.fn(() => () => {}),
}

let AddToAddressBookDialog: typeof AddToAddressBookDialogType
let useLauncher: typeof useLauncherType

beforeAll(async () => {
  await initI18n('en')
  ;({ AddToAddressBookDialog } = await import('./AddToAddressBookDialog'))
  ;({ useLauncher } = await import('../../store/useLauncher'))
})

afterEach(() => {
  cleanup()
  useLauncher.setState({ toasts: [] })
  PROFILES = [
    makeProfile({
      id: 'a',
      name: 'Profile A',
      cvars: { adr0: '9.9.9.9:27910' },
      assignments: [{ installationId: 'inst-1', isDefault: true }],
    }),
    makeProfile({ id: 'b', name: 'Profile B', cvars: { adr2: '8.8.8.8:27910' } }),
  ]
  ;(
    globalThis as unknown as { q2: { invoke: ReturnType<typeof vi.fn> } }
  ).q2.invoke.mockImplementation(invokeImpl)
})

function invokeMock() {
  return (globalThis as unknown as { q2: { invoke: ReturnType<typeof vi.fn> } }).q2.invoke
}

function renderDialog(address = '1.2.3.4:27910') {
  return render(createElement(AddToAddressBookDialog, { open: true, address, onClose: vi.fn() }))
}

describe('AddToAddressBookDialog', () => {
  it('lists every profile with the active one preselected', async () => {
    renderDialog()

    const select = await waitFor(() => {
      const el = within(screen.getByTestId('servers-address-book-profile')).getByRole(
        'combobox',
      ) as HTMLSelectElement
      expect(el.value).toBe('a')
      return el
    })

    const optionLabels = [...select.options].map((o) => o.textContent)
    expect(optionLabels).toEqual(['Profile A', 'Profile B'])
  })

  it('shows all nine slots with empty and occupied told apart in text', async () => {
    renderDialog()

    await waitFor(() => expect(screen.getByTestId('servers-address-book-slot-0')).toBeTruthy())

    // adr0 is occupied on Profile A ("9.9.9.9:27910"), the rest are empty.
    expect(screen.getByTestId('servers-address-book-slot-0').textContent).toContain('9.9.9.9:27910')
    expect(screen.getByTestId('servers-address-book-slot-1').textContent).toContain('Empty')
    expect(screen.getByTestId('servers-address-book-slot-8').textContent).toContain('Empty')
  })

  it("switching profile re-reads and shows that profile's own slots", async () => {
    renderDialog()

    const select = await waitFor(() => {
      const el = within(screen.getByTestId('servers-address-book-profile')).getByRole(
        'combobox',
      ) as HTMLSelectElement
      expect(el.value).toBe('a')
      return el
    })

    const callsBeforeSwitch = invokeMock().mock.calls.filter(
      (c: unknown[]) => (c[1] as { type: string }).type === CONFIG_HANDLERS.list,
    ).length

    fireEvent.change(select, { target: { value: 'b' } })

    // While the fresh read is in flight (or right after), Profile A's adr0 value must not appear.
    expect(screen.queryByText('9.9.9.9:27910')).toBeNull()

    await waitFor(() =>
      expect(screen.getByTestId('servers-address-book-slot-2').textContent).toContain(
        '8.8.8.8:27910',
      ),
    )
    expect(screen.getByTestId('servers-address-book-slot-0').textContent).toContain('Empty')
    expect(screen.queryByText('9.9.9.9:27910')).toBeNull()

    const callsAfterSwitch = invokeMock().mock.calls.filter(
      (c: unknown[]) => (c[1] as { type: string }).type === CONFIG_HANDLERS.list,
    ).length
    expect(callsAfterSwitch).toBeGreaterThan(callsBeforeSwitch)
  })

  async function confirmAdd(): Promise<void> {
    await waitFor(() => expect(screen.getByTestId('servers-address-book-slot-1')).toBeTruthy())
    const confirm = screen.getByTestId('servers-address-book-confirm') as HTMLButtonElement
    await waitFor(() => expect(confirm.disabled).toBe(false))
    await act(async () => {
      fireEvent.click(confirm)
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  it('confirm commits only the chosen slot through config commitCvars', async () => {
    renderDialog('1.2.3.4:27910')
    await confirmAdd()

    const commitCalls = invokeMock().mock.calls.filter(
      (c: unknown[]) => (c[1] as { type: string }).type === CONFIG_HANDLERS.commitCvars,
    )
    expect(commitCalls).toHaveLength(1)
    const [, args] = commitCalls[0] as [
      string,
      { moduleId: string; type: string; payload: unknown },
    ]
    expect(args.moduleId).toBe('config')
    expect(args.type).toBe('commitCvars')
    // Only the chosen slot (adr1, lowest empty) - not the profile's other cvar adr0.
    expect(args.payload).toEqual({ profileId: 'a', cvars: { adr1: '1.2.3.4:27910' } })

    const setCvarsCalls = invokeMock().mock.calls.filter(
      (c: unknown[]) => (c[1] as { type: string }).type === CONFIG_HANDLERS.setCvars,
    )
    expect(setCvarsCalls).toHaveLength(0)
    const serversModuleCalls = invokeMock().mock.calls.filter(
      (c: unknown[]) => (c[1] as { moduleId: string }).moduleId === 'servers',
    )
    expect(serversModuleCalls).toHaveLength(0)
  })

  it('a successful add toasts the saved key', async () => {
    const onClose = vi.fn()
    render(createElement(AddToAddressBookDialog, { open: true, address: '1.2.3.4:27910', onClose }))
    await confirmAdd()

    expect(onClose).toHaveBeenCalled()
    const toasts = useLauncher.getState().toasts
    expect(toasts.map((toast) => toast.messageKey)).toContain('servers.addressBook.saved')
    expect(toasts.map((toast) => toast.messageKey)).not.toContain('servers.addressBook.written')
    expect(
      toasts.find((toast) => toast.messageKey === 'servers.addressBook.saved')?.params,
    ).toEqual({
      profile: 'Profile A',
      slot: 'adr1',
    })
  })

  it('a failed commit keeps the dialog open with the error as text and no toast', async () => {
    const onClose = vi.fn()
    invokeMock().mockImplementation((channel: string, args: { moduleId: string; type: string }) =>
      args?.type === CONFIG_HANDLERS.commitCvars
        ? Promise.resolve({ ok: false, error: { key: 'config.error.commitConflict' } })
        : invokeImpl(channel, args),
    )
    render(createElement(AddToAddressBookDialog, { open: true, address: '1.2.3.4:27910', onClose }))
    await confirmAdd()

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('changed on disk')
    expect(onClose).not.toHaveBeenCalled()
    expect(useLauncher.getState().toasts).toHaveLength(0)
  })

  it('an address that fails validation cannot be written', async () => {
    renderDialog('not a valid address')

    await waitFor(() => expect(screen.getByTestId('servers-address-book-slot-0')).toBeTruthy())

    const confirm = screen.getByTestId('servers-address-book-confirm') as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    expect(screen.getByText(/single address/i)).toBeTruthy()
  })
})
