import { unwrapOk } from '../../../test-support/outcome'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  CONFIG_HANDLERS,
  type ConfigProfile,
  type PreviewProfileResult,
} from '@shared/modules/config'
import { type Installation, type Outcome } from '@shared/types'
import { type AppContext } from '../../context'
import { StateStore } from '../../services/state'
import { type ModuleHandler } from '../types'
import { configModule } from './index'
import {
  collectHandlers,
  idleState,
  installation,
  log,
  profile,
  installConfigTestDir,
} from './index.test-helpers'
import { seedConfigProfiles } from '../../../test-support/config-state'

vi.mock('electron', async () => {
  const h = await import('./index.test-helpers')
  return { app: { getPath: () => h.userDataBox.current }, shell: h.shellMock }
})

const getDir = installConfigTestDir()
let dir: string
beforeEach(() => {
  dir = getDir()
})

/**
 * Unlike the pure `previewProfileFiles`, whether a rendered file
 * already exists on disk is fs-dependent and so is only ever known by the
 * `preview` IPC handler itself, not by the pure function. Goes through
 * `configModule.setup()` with a minimal duck-typed `app` (only the pieces the
 * handler and its setup actually touch: `installations.find`/`.list` and a
 * real, temp-file-backed `StateStore`, per the same precedent `profiles.test.ts`
 * uses) rather than a real `AppContext`, since nothing else in this file boots
 * the full Electron machinery either.
 */
describe('CONFIG_HANDLERS.preview handler', () => {
  async function previewHandlerFor(inst: Installation): Promise<ModuleHandler> {
    const state = new StateStore(join(dir, 'state.json'))
    await state.load()
    const handlers = new Map<string, ModuleHandler>()
    await configModule.setup({
      handle: collectHandlers(handlers),
      emit: () => {},
      onDispose: () => {},
      app: {
        installations: {
          find: (id: string) => (id === inst.id ? inst : undefined),
          list: () => [inst],
        },
        state,
      } as unknown as AppContext,
      log,
    })
    seedConfigProfiles(state, [profile()])
    await state.settle()
    return handlers.get(CONFIG_HANDLERS.preview)!
  }

  it('reports onDisk: false before the rendered file exists on disk, and true once it is created', async () => {
    const inst = installation()
    const preview = await previewHandlerFor(inst)

    const before = (await preview({
      profileId: 'p1',
      installationId: inst.id,
    })) as Outcome<PreviewProfileResult>
    if (!before.ok) throw new Error('expected preview to succeed')
    expect(before.value.files.length).toBeGreaterThan(0)
    expect(before.value.files.every((file) => file.onDisk === false)).toBe(true)

    const target = before.value.files.find((file) => file.path.endsWith('Profile.cfg'))!
    await mkdir(join(target.path, '..'), { recursive: true })
    await writeFile(target.path, 'irrelevant', 'latin1')

    const after = (await preview({
      profileId: 'p1',
      installationId: inst.id,
    })) as Outcome<PreviewProfileResult>
    if (!after.ok) throw new Error('expected preview to succeed')
    const created = after.value.files.find((file) => file.path === target.path)!
    expect(created.onDisk).toBe(true)
    const others = after.value.files.filter((file) => file.path !== target.path)
    expect(others.every((file) => file.onDisk === false)).toBe(true)
  })
})

/**
 * Order is array position, and the IPC contract itself (not just `ProfilesStore`) must preserve it:
 * `setActions`'s strict schema parse must not reorder, dedupe or otherwise
 * reshuffle the array before it reaches `ProfilesStore.setActions`, and
 * `list` must hand the same order back.
 */
describe('CONFIG_HANDLERS.setActions / list round trip', () => {
  it('returns the actions array from list in the exact order sent through setActions', async () => {
    const state = new StateStore(join(dir, 'state.json'))
    await state.load()
    const handlers = new Map<string, ModuleHandler>()
    await configModule.setup({
      handle: collectHandlers(handlers),
      emit: () => {},
      onDispose: () => {},
      app: {
        installations: { find: () => undefined, list: () => [] },
        // `setActions` reads the launch state to decide whether a target is running, so
        // this fixture needs a `launch` even though the test is only about ordering.
        launch: { getState: () => idleState() },
        state,
      } as unknown as AppContext,
      log,
    })
    seedConfigProfiles(state, [profile()])
    await state.settle()

    const category = { id: 'movement', name: 'Movement' }
    const other = { id: 'weapons', name: 'Weapons' }
    const orderedActions = [
      {
        id: 'a3',
        categoryId: other.id,
        name: 'Third',
        kind: 'bind' as const,
        commands: [{ kind: 'raw' as const, text: '+forward' }],
      },
      {
        id: 'a1',
        categoryId: category.id,
        name: 'First',
        kind: 'bind' as const,
        commands: [{ kind: 'raw' as const, text: '+back' }],
      },
      {
        id: 'a2',
        categoryId: category.id,
        name: '+test',
        kind: 'alias' as const,
        commands: [{ kind: 'raw' as const, text: 'echo test' }],
      },
    ]

    const setActions = handlers.get(CONFIG_HANDLERS.setActions)!
    const setResult = unwrapOk<ConfigProfile[]>(
      await setActions({
        profileId: 'p1',
        categories: [category, other],
        actions: orderedActions,
      }),
    )
    const setProfile = setResult.find((p) => p.id === 'p1')!
    expect(setProfile.actions!.map((a) => a.id)).toEqual(['a3', 'a1', 'a2'])

    const list = handlers.get(CONFIG_HANDLERS.list)!
    const listResult = unwrapOk<ConfigProfile[]>(await list(undefined))
    const listedProfile = listResult.find((p) => p.id === 'p1')!
    expect(listedProfile.actions!.map((a) => a.id)).toEqual(['a3', 'a1', 'a2'])
    expect(listedProfile.actions).toEqual(setProfile.actions)
  })
})
