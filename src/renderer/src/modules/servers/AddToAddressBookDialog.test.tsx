// @vitest-environment jsdom
import { createElement } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { ConfigProfile } from '@shared/modules/config'
import { CONFIG_HANDLERS } from '@shared/modules/config'
import { initI18n } from '../../i18n'
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
  if (args?.moduleId === 'config' && args?.type === CONFIG_HANDLERS.setCvars) {
    const payload = args.payload as { profileId: string; cvars: Record<string, string> }
    PROFILES = PROFILES.map((p) => (p.id === payload.profileId ? { ...p, cvars: payload.cvars } : p))
    return Promise.resolve({ ok: true, value: PROFILES })
  }
  return Promise.resolve({ ok: false, error: { key: 'unhandled' } })
}

;(globalThis as unknown as { q2: unknown }).q2 = {
  invoke: vi.fn(invokeImpl),
  on: vi.fn(() => () => {}),
}

let AddToAddressBookDialog: typeof AddToAddressBookDialogType

beforeAll(async () => {
  await initI18n('en')
  ;({ AddToAddressBookDialog } = await import('./AddToAddressBookDialog'))
})

afterEach(() => {
  cleanup()
  PROFILES = [
    makeProfile({
      id: 'a',
      name: 'Profile A',
      cvars: { adr0: '9.9.9.9:27910' },
      assignments: [{ installationId: 'inst-1', isDefault: true }],
    }),
    makeProfile({ id: 'b', name: 'Profile B', cvars: { adr2: '8.8.8.8:27910' } }),
  ]
  ;(globalThis as unknown as { q2: { invoke: ReturnType<typeof vi.fn> } }).q2.invoke.mockImplementation(
    invokeImpl,
  )
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

    await waitFor(() => expect(screen.getByTestId('servers-address-book-slot-2').textContent).toContain(
      '8.8.8.8:27910',
    ))
    expect(screen.getByTestId('servers-address-book-slot-0').textContent).toContain('Empty')
    expect(screen.queryByText('9.9.9.9:27910')).toBeNull()

    const callsAfterSwitch = invokeMock().mock.calls.filter(
      (c: unknown[]) => (c[1] as { type: string }).type === CONFIG_HANDLERS.list,
    ).length
    expect(callsAfterSwitch).toBeGreaterThan(callsBeforeSwitch)
  })

  it('confirm writes the full cvars map through config setCvars only', async () => {
    renderDialog('1.2.3.4:27910')

    await waitFor(() => expect(screen.getByTestId('servers-address-book-slot-1')).toBeTruthy())

    // adr1 is the lowest empty slot on the preselected Profile A - already preselected by default.
    const confirm = screen.getByTestId('servers-address-book-confirm') as HTMLButtonElement
    await waitFor(() => expect(confirm.disabled).toBe(false))

    await act(async () => {
      fireEvent.click(confirm)
      await Promise.resolve()
      await Promise.resolve()
    })

    const setCvarsCall = invokeMock().mock.calls.find(
      (c: unknown[]) => (c[1] as { type: string }).type === CONFIG_HANDLERS.setCvars,
    )
    expect(setCvarsCall).toBeTruthy()
    const [, args] = setCvarsCall as [string, { moduleId: string; payload: { profileId: string; cvars: Record<string, string> } }]
    expect(args.moduleId).toBe('config')
    expect(args.payload.profileId).toBe('a')
    // Keeps the profile's other cvar (adr0) and adds the new one (adr1).
    expect(args.payload.cvars).toEqual({ adr0: '9.9.9.9:27910', adr1: '1.2.3.4:27910' })

    const serversModuleCalls = invokeMock().mock.calls.filter(
      (c: unknown[]) => (c[1] as { moduleId: string }).moduleId === 'servers',
    )
    expect(serversModuleCalls).toHaveLength(0)
  })

  it('an address that fails validation cannot be written', async () => {
    renderDialog('not a valid address')

    await waitFor(() => expect(screen.getByTestId('servers-address-book-slot-0')).toBeTruthy())

    const confirm = screen.getByTestId('servers-address-book-confirm') as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    expect(screen.getByText(/single address/i)).toBeTruthy()
  })
})
