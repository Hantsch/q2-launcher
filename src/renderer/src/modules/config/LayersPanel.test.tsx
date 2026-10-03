// @vitest-environment jsdom
import { act, fireEvent, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { stubBridge } from './test/bridge'
import { renderWithProviders } from './test/render'
import { LayersPanel } from './LayersPanel'

describe('LayersPanel', () => {
  it('adding a layer saves it through the bridge', async () => {
    const bridge = stubBridge()
    const { getByRole, getByLabelText, profile } = renderWithProviders(
      <LayersPanel activeLayerId={null} onSelectLayer={vi.fn()} />,
    )
    fireEvent.click(getByRole('button', { name: 'New layer' }))
    fireEvent.change(getByLabelText('Name'), { target: { value: 'Drops' } })
    await act(async () => {
      fireEvent.click(getByRole('button', { name: 'Create layer' }))
    })
    await waitFor(() => expect(bridge.invoke).toHaveBeenCalled())
    const [channel, envelope] = bridge.invoke.mock.calls[0] as [
      string,
      { moduleId: string; type: string; payload: { profileId: string; layers: unknown[] } },
    ]
    expect(channel).toBe('module:invoke')
    expect(envelope.moduleId).toBe('config')
    expect(envelope.type).toBe('setLayers')
    expect(envelope.payload.profileId).toBe(profile.id)
    expect(envelope.payload.layers).toEqual([
      expect.objectContaining({ name: 'Drops', mode: 'hold', triggerKey: null, overrides: {} }),
    ])
  })
})
