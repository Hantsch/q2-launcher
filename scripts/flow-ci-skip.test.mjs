import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./lib/fixture.mjs', () => ({ writePlayWithFixture: () => ({ spawnable: false }) }))
vi.mock('./lib/flow-common.mjs', () => ({
  invoke: async () => ({}),
  launchLines: () => [],
  nextLaunchLine: async () => '',
}))

const { default: run, setup } = await import('./flows/launch-with-scope.mjs')
const ctx = () => ({ page: {}, step() {}, shot() {} })

describe('launch-with-scope without the stand-in client', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('launch-with-scope fails under CI when the stand-in client is missing', async () => {
    vi.stubEnv('CI', 'true')
    await setup()
    await expect(run(ctx())).rejects.toThrow(/7za/)
  })

  it('launch-with-scope logs and returns locally when the stand-in client is missing', async () => {
    vi.stubEnv('CI', '')
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await setup()
    await expect(run(ctx())).resolves.toBeUndefined()
    expect(log.mock.calls.some(([m]) => String(m).includes('SKIPPING LOUDLY'))).toBe(true)
  })
})
