import { beforeEach, describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { CONFIG_HANDLERS } from '@shared/modules/config'
import { type Installation } from '@shared/types'
import { type AppContext } from '../../context'
import { StateStore } from '../../services/state'
import { type ModuleHandler } from '../types'
import { configModule } from './index'
import { writeTargetFile } from './writer'
import {
  collectHandlers,
  idleState,
  installation,
  log,
  profile,
  useConfigTestDir,
  userDataBox,
} from './index.test-helpers'

vi.mock('./writer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./writer')>()
  return { ...actual, writeTargetFile: vi.fn(actual.writeTargetFile) }
})

vi.mock('electron', async () => {
  const h = await import('./index.test-helpers')
  return { app: { getPath: () => h.userDataBox.current }, shell: h.shellMock }
})

const getDir = useConfigTestDir()
let dir: string
beforeEach(() => {
  dir = getDir()
})

describe('config write failures under overlapping sync runs', () => {
  async function boot(
    installations: Installation[],
  ): Promise<{ handlers: Map<string, ModuleHandler>; state: StateStore }> {
    const state = new StateStore(join(dir, 'state.json'))
    await state.load()
    const handlers = new Map<string, ModuleHandler>()
    await configModule.setup({
      handle: collectHandlers(handlers),
      emit: () => {},
      onDispose: () => {},
      app: {
        installations: {
          find: (id: string) => installations.find((i) => i.id === id),
          list: () => installations,
        },
        launch: { getState: () => idleState() },
        state,
      } as unknown as AppContext,
      log,
    })
    return { handlers, state }
  }

  it("concurrent syncAndPersist runs keep each other's write failures", async () => {
    const i1 = installation({ id: 'i1', rootPath: join(dir, 'one') })
    const i2 = installation({ id: 'i2', rootPath: join(dir, 'two') })
    const { handlers, state } = await boot([i1, i2])
    state.setConfigProfiles([
      profile({
        id: 'p1',
        name: 'First',
        assignments: [{ installationId: 'i1', isDefault: true }],
      }),
      profile({
        id: 'p2',
        name: 'Second',
        assignments: [{ installationId: 'i2', isDefault: true }],
      }),
    ])
    await state.settle()
    expect(userDataBox.current).toBeTruthy()

    let releaseFirst!: () => void
    const held = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    let calls = 0
    vi.mocked(writeTargetFile).mockImplementation(async () => {
      calls += 1
      if (calls === 1) await held
      throw new Error('disk full')
    })

    const save = (profileId: string): Promise<unknown> =>
      Promise.resolve(handlers.get(CONFIG_HANDLERS.save)!({ profileId }))
    const first = save('p1')
    await vi.waitFor(() => expect(calls).toBe(1))
    await save('p2')
    expect(Object.keys(state.configWriteFailures())).toEqual(['p2|own'])
    releaseFirst()
    await first
    await state.settle()

    expect(Object.keys(state.configWriteFailures()).sort()).toEqual(['p1|own', 'p2|own'])
    vi.mocked(writeTargetFile).mockReset()
  })
})
