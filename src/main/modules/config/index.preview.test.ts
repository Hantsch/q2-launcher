import { unwrapOk } from '../../../test-support/outcome'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
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
import { configModule, previewProfileFiles, validatePlayedMods } from './index'
import { syncProfile } from './sync'
import {
  collectHandlers,
  idleState,
  installation,
  log,
  profile,
  useConfigTestDir,
  userDataBox,
} from './index.test-helpers'

vi.mock('electron', async () => {
  const h = await import('./index.test-helpers')
  return { app: { getPath: () => h.userDataBox.current }, shell: h.shellMock }
})

const getDir = useConfigTestDir()
let dir: string
beforeEach(() => {
  dir = getDir()
})

describe('previewProfileFiles', () => {
  it('matches exactly what a write under the same conditions produces', async () => {
    const inst = installation()
    const p = profile()

    const preview = previewProfileFiles(p, [p], inst)

    const result = await syncProfile({
      profile: p,
      allProfiles: [p],
      installations: { find: () => inst },
      launchState: idleState(),
      playedModsFor: () => [],
      canonicalBaseDir: userDataBox.current,
      writeFailures: {},
      log,
    })
    expect(result.state.installations).toEqual([
      {
        installationId: 'i1',
        path: join(dir, 'baseq2', 'Profile.cfg'),
        fileName: 'Profile.cfg',
        status: 'inSync',
      },
    ])

    expect(preview).toHaveLength(2)
    for (const file of preview) {
      const onDisk = await readFile(file.path, 'latin1')
      expect(onDisk).toBe(file.content)
    }
  })

  it('renders the loader for whichever profile is the installation default, not the profile being previewed', () => {
    // Named distinctly from `p` below so the two never collide under
    // `resolveProfileFileNames` - this test is about which profile's file the
    // loader execs, not about collision handling.
    const other = profile({
      id: 'p-default',
      name: 'Default',
      cvars: {},
      assignments: [{ installationId: 'i1', isDefault: true }],
    })
    const p = profile({ id: 'p1', assignments: [{ installationId: 'i1', isDefault: false }] })
    const inst = installation()

    const [, , loader] = previewProfileFiles(p, [p, other], inst)

    expect(loader!.content).toContain('p-default')
    expect(loader!.content).not.toContain('exec Profile.cfg')
  })

  it("also includes the default profile's own file when previewing a different, non-default profile (F1)", () => {
    // Named distinctly from `p` below so the two never collide under
    // `resolveProfileFileNames`.
    const defaultProfile = profile({
      id: 'p-default',
      name: 'Default',
      // Not the catalogue default, for the same reason as the F1 write test above.
      cvars: { crosshair: '3' },
      assignments: [{ installationId: 'i1', isDefault: true }],
    })
    const p = profile({ id: 'p1', assignments: [{ installationId: 'i1', isDefault: false }] })
    const inst = installation()

    const files = previewProfileFiles(p, [defaultProfile, p], inst)

    expect(files.map((f) => f.path.split(/[/\\]/).pop())).toEqual([
      'Default.cfg',
      'Profile.cfg',
      'autoexec.cfg',
    ])
    expect(files[0]!.content).toContain('set crosshair   "3"')
  })

  it('story 007: includes the switch-bind chain in the loader preview when a key and 2 assigned profiles are given', () => {
    const duel = profile({
      id: 'p-duel',
      name: 'Duel',
      assignments: [{ installationId: 'i1', isDefault: true }],
    })
    const ctf = profile({
      id: 'p-ctf',
      name: 'CTF',
      assignments: [{ installationId: 'i1', isDefault: false }],
    })
    const inst = installation()

    const files = previewProfileFiles(duel, [duel, ctf], inst, 'F9')
    const loader = files.find((f) => f.path.endsWith('autoexec.cfg'))

    expect(loader!.content).toContain('q2l_switch')
    expect(loader!.content).toContain('bind F9 q2l_switch')
  })

  it("story 007: omits the chain when no switchBindKey is given (today's default)", () => {
    const p = profile()
    const inst = installation()

    const files = previewProfileFiles(p, [p], inst)
    const loader = files.find((f) => f.path.endsWith('autoexec.cfg'))

    expect(loader!.content).not.toContain('q2l_switch')
  })
})

/**
 * D1 (story 012): unlike `previewProfileFiles` above, whether a rendered file
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
    state.setConfigProfiles([profile()])
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
 * Story 019 D3: order is array position, and the Decisions require the IPC
 * contract itself (not just `ProfilesStore` directly) to preserve it -
 * `setActions`'s strict schema parse must not reorder, dedupe or otherwise
 * reshuffle the array before it reaches `ProfilesStore.setActions`, and
 * `list` must hand the same order back.
 */
describe('CONFIG_HANDLERS.setActions / list round trip (story 019 D3)', () => {
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
        // Story 022 D7: `setActions` now triggers a sync run, which reads the
        // launch state to decide whether a target is running - so this fixture
        // needs a `launch` even though this test is only about ordering.
        launch: { getState: () => idleState() },
        state,
      } as unknown as AppContext,
      log,
    })
    state.setConfigProfiles([profile()])
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
    const setResult = unwrapOk<ConfigProfile[]>(await setActions({
      profileId: 'p1',
      categories: [category, other],
      actions: orderedActions,
    }))
    const setProfile = setResult.find((p) => p.id === 'p1')!
    expect(setProfile.actions!.map((a) => a.id)).toEqual(['a3', 'a1', 'a2'])

    const list = handlers.get(CONFIG_HANDLERS.list)!
    const listResult = unwrapOk<ConfigProfile[]>(await list(undefined))
    const listedProfile = listResult.find((p) => p.id === 'p1')!
    expect(listedProfile.actions!.map((a) => a.id)).toEqual(['a3', 'a1', 'a2'])
    expect(listedProfile.actions).toEqual(setProfile.actions)
  })
})

describe('validatePlayedMods', () => {
  it('keeps only names present in gameDirs', () => {
    expect(validatePlayedMods(['baseq2', 'ctf'], ['ctf', 'not-a-real-mod'])).toEqual(['ctf'])
  })

  it('rejects everything when gameDirs is empty', () => {
    expect(validatePlayedMods([], ['ctf'])).toEqual([])
  })
})
