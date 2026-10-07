// @vitest-environment jsdom
import { fireEvent, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { stubBridge } from '../test/bridge'
import { profileFixture } from '../test/fixtures'
import { renderWithProviders } from '../test/render'
import { KeyBindDialog } from './KeyBindDialog'

describe('KeyBindDialog', () => {
  it('a captured key is confirmed to the caller', async () => {
    const saved = [profileFixture({ binds: { F: '+attack' } })]
    const stub = stubBridge()
    stub.invoke.mockImplementation(() => Promise.resolve({ ok: true, value: saved }))
    const onSaved = vi.fn()
    const profile = profileFixture()
    const { getByRole, getByLabelText } = renderWithProviders(
      <KeyBindDialog
        profile={profile}
        keyName="F"
        keyLabel="F"
        onClose={vi.fn()}
        onSaved={onSaved}
      />,
      { profile },
    )
    fireEvent.change(getByLabelText('Command'), { target: { value: '+attack' } })
    fireEvent.click(getByRole('button', { name: 'Assign' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved))
    expect(stub.invoke).toHaveBeenCalledWith('module:invoke', {
      moduleId: 'config',
      type: 'setBinds',
      payload: { profileId: profile.id, binds: { F: '+attack' } },
    })
  })
})
