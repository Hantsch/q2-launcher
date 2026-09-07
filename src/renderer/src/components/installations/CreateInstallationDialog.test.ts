// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { SUPPORTED_ENGINE_DEFINITIONS } from '@shared/types/engine'
import { initI18n } from '../../i18n'
import { CreateInstallationDialog } from './CreateInstallationDialog'

/**
 * Story 068 D3: the create-installation dialog's engine dropdown must only offer engines the
 * launcher fully supports (R1Q2, Q2PRO today), derived from `SUPPORTED_ENGINE_DEFINITIONS` rather
 * than a parallel hard-coded list that happens to match it.
 *
 * `CreateInstallationDialog`'s import chain reaches `store/useLauncher.ts` -> `lib/bridge.ts`,
 * which resolves `window.q2` at *module* scope and throws when it is missing - same reasoning
 * `InstallationProfilesPanel.test.ts` gives for the `vi.hoisted` bridge stub.
 */

vi.hoisted(() => {
  ;(globalThis as unknown as { q2: unknown }).q2 = {
    invoke: () => Promise.reject(new Error('IPC is not available in this test')),
    on: () => () => {},
  }
})

beforeAll(async () => {
  await initI18n('en')
})

afterEach(() => {
  cleanup()
})

describe('CreateInstallationDialog', () => {
  it('only supported engines are offered, in table order, under an "Engine" accessible name', () => {
    render(createElement(CreateInstallationDialog))

    const select = screen.getByRole('combobox', { name: /engine/i })
    const options = within(select).getAllByRole('option') as HTMLOptionElement[]

    expect(options.map((option) => option.textContent)).toEqual(['R1Q2', 'Q2PRO'])
  })

  it('defaults the selected value to r1q2', () => {
    render(createElement(CreateInstallationDialog))

    const select = screen.getByRole('combobox', { name: /engine/i }) as HTMLSelectElement
    expect(select.value).toBe('r1q2')
  })

  it('reads the supported set, not a hard-coded list', () => {
    render(createElement(CreateInstallationDialog))

    const select = screen.getByRole('combobox', { name: /engine/i })
    const options = within(select).getAllByRole('option')

    expect(options).toHaveLength(SUPPORTED_ENGINE_DEFINITIONS.length)
  })
})
