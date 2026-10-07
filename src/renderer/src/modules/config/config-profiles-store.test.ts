import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConfigProfile } from '@shared/modules/config'
import type { Outcome } from '@shared/types'
import { makeConfigProfile } from '../../../../test-support/fixtures'
import { mockClient } from '../../test-support/mock-client'

const listConfigProfiles = vi.hoisted(() => vi.fn<() => Promise<Outcome<ConfigProfile[]>>>())

vi.mock('./client', (importOriginal) =>
  mockClient<typeof import('./client')>(importOriginal, {
    listConfigProfiles: () => listConfigProfiles(),
  }),
)

import { useConfigProfiles } from './config-profiles-store'

const p1 = makeConfigProfile({ id: 'p1', name: 'Competitive' })
const p2 = makeConfigProfile({ id: 'p2', name: 'Casual' })

function profiles(): ConfigProfile[] {
  return useConfigProfiles.getState().profiles
}

beforeEach(() => {
  useConfigProfiles.setState({ profiles: [] })
  listConfigProfiles.mockReset()
})

describe('config profiles store', () => {
  it('load fills the list and returns the outcome', async () => {
    const outcome: Outcome<ConfigProfile[]> = { ok: true, value: [p1, p2] }
    listConfigProfiles.mockResolvedValue(outcome)

    await expect(useConfigProfiles.getState().load()).resolves.toBe(outcome)
    expect(profiles()).toEqual([p1, p2])
  })

  it('a failed load leaves the list', async () => {
    useConfigProfiles.setState({ profiles: [p1] })
    const outcome: Outcome<ConfigProfile[]> = {
      ok: false,
      error: { key: 'ipc.error.handlerFailed' },
    }
    listConfigProfiles.mockResolvedValue(outcome)

    await expect(useConfigProfiles.getState().load()).resolves.toBe(outcome)
    expect(profiles()).toEqual([p1])
  })

  it('a load resolving after upsert does not revert it', async () => {
    useConfigProfiles.setState({ profiles: [p1] })
    let answer: (outcome: Outcome<ConfigProfile[]>) => void = () => {}
    listConfigProfiles.mockReturnValue(new Promise((resolve) => (answer = resolve)))

    const pending = useConfigProfiles.getState().load()
    const saved = { ...p1, name: 'Competitive (saved)' }
    useConfigProfiles.getState().upsert(saved)
    // The list main had before the save, answered only now.
    answer({ ok: true, value: [p1] })

    await expect(pending).resolves.toEqual({ ok: true, value: [p1] })
    expect(profiles()).toEqual([saved])
  })

  it('an older load resolving after a newer one does not overwrite it', async () => {
    const answers: ((outcome: Outcome<ConfigProfile[]>) => void)[] = []
    listConfigProfiles.mockImplementation(() => new Promise((resolve) => answers.push(resolve)))

    const older = useConfigProfiles.getState().load()
    const newer = useConfigProfiles.getState().load()
    answers[1]!({ ok: true, value: [p1, p2] })
    await newer
    answers[0]!({ ok: true, value: [p1] })
    await older

    expect(profiles()).toEqual([p1, p2])
  })

  it('replaceAll, upsert and remove', () => {
    const { replaceAll, upsert, remove } = useConfigProfiles.getState()

    replaceAll([p1])
    expect(profiles()).toEqual([p1])

    const renamed = { ...p1, name: 'Renamed' }
    upsert(renamed)
    expect(profiles()).toEqual([renamed])

    upsert(p2)
    expect(profiles()).toEqual([renamed, p2])

    remove('p1')
    expect(profiles()).toEqual([p2])
  })
})
