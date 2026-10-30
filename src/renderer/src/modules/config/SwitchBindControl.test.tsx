// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { fail, ok } from '@shared/types'
import { mockClient } from '../../test-support/mock-client'
import { initI18n } from '../../i18n'
import { setSwitchBind } from './client'
import { SwitchBindControl } from './SwitchBindControl'

vi.mock('./client', (importOriginal) =>
  mockClient<typeof import('./client')>(importOriginal, { setSwitchBind: vi.fn() }),
)

beforeAll(async () => {
  await initI18n('en')
})
afterEach(() => {
  cleanup()
  vi.mocked(setSwitchBind).mockReset()
})

function renderControl(currentKey: string | undefined = 'F9'): { onChanged: () => void } {
  const onChanged = vi.fn()
  render(createElement(SwitchBindControl, { installationId: 'i1', currentKey, onChanged }))
  return { onChanged }
}

describe('SwitchBindControl', () => {
  it('shows the refusal as visible alert text and does not report a change', async () => {
    vi.mocked(setSwitchBind).mockResolvedValue(fail('config.error.commitConflict'))
    const { onChanged } = renderControl()

    fireEvent.click(screen.getByTestId('switch-bind-clear'))

    const alert = await screen.findByTestId('switch-bind-error')
    expect(alert.getAttribute('role')).toBe('alert')
    expect(alert.textContent).toContain('changed on disk')
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('clears the refusal after the next successful change', async () => {
    vi.mocked(setSwitchBind)
      .mockResolvedValueOnce(fail('config.error.commitConflict'))
      .mockResolvedValueOnce(ok({}))
    renderControl()

    fireEvent.click(screen.getByTestId('switch-bind-clear'))
    await screen.findByTestId('switch-bind-error')
    fireEvent.click(screen.getByTestId('switch-bind-clear'))

    await waitFor(() => expect(screen.queryByTestId('switch-bind-error')).toBeNull())
  })
})
