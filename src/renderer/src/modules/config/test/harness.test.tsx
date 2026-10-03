// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { stubBridge } from './bridge'
import { renderWithProviders } from './render'
import { useProfileDraftContext } from '../lib/ProfileDraftProvider'

function ProfileName() {
  return <p>{useProfileDraftContext().draft.name}</p>
}

describe('config test harness', () => {
  it('renderWithProviders mounts with a stubbed bridge', async () => {
    const bridge = stubBridge()
    const { container, profile } = renderWithProviders(<ProfileName />)
    expect(container.textContent).toBe(profile.name)
    await expect(bridge.invoke('x')).resolves.toEqual({ ok: true, value: [] })
  })
})
