import type { IpcMainInvokeEvent } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppContext } from '../context'

/**
 * Story 130 D2: `features:getUnlocked` is a plain (non-`Outcome`) `handle()` channel, mirroring
 * `app:getInfo` - it just mirrors the frozen `FeatureGate`'s `unlockedFeatures()` to the renderer.
 * `electron` is mocked the same minimal way as `app.test.ts` / `index.test.ts`.
 */

const registered = vi.hoisted(
  () => new Map<string, (event: unknown, payload: unknown) => unknown>(),
)

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, fn: (event: unknown, payload: unknown) => unknown) => {
      registered.set(channel, fn)
    }),
  },
}))

const fakeEvent = {} as unknown as IpcMainInvokeEvent

async function setup(unlocked: string[]): Promise<{
  getUnlocked: (event: unknown, payload: unknown) => unknown
}> {
  const { registerFeaturesIpc } = await import('./features')
  const app = {
    features: {
      isFeatureUnlocked: (name: string) => unlocked.includes(name),
      unlockedFeatures: () => unlocked,
    },
  } as unknown as AppContext
  registerFeaturesIpc(app)
  return { getUnlocked: registered.get('features:getUnlocked')! }
}

beforeEach(() => {
  registered.clear()
  vi.resetModules()
})

describe('features:getUnlocked', () => {
  it('returns exactly what the FeatureGate reports as unlocked', async () => {
    const { getUnlocked } = await setup(['test-only-feature'])

    const result = await getUnlocked(fakeEvent, undefined)

    expect(result).toEqual(['test-only-feature'])
  })

  it('returns an empty array when nothing is unlocked', async () => {
    const { getUnlocked } = await setup([])

    const result = await getUnlocked(fakeEvent, undefined)

    expect(result).toEqual([])
  })

  it('rejects a non-void payload synchronously, per the plain handle() contract', async () => {
    const { getUnlocked } = await setup(['test-only-feature'])

    expect(() => getUnlocked(fakeEvent, { unexpected: true })).toThrow()
  })
})
