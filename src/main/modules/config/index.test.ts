import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CONFIG_HANDLERS,
  type ConfigProfile,
  type PreviewProfileResult,
  type ProfileSyncState,
  type RawFilesResult,
  type TidyUpApplyResult,
  type WriteTargetResult,
} from '@shared/modules/config'
import { fail, type Installation, type LaunchState, type Outcome } from '@shared/types'
import { pathExists } from '../../lib/fs-utils'
import { scopedLogger } from '../../lib/logger'
import type { AppContext } from '../../context'
import { StateStore } from '../../services/state'
import type { ModuleHandler, ModuleSetup } from '../types'
import { scanRedundantCopies } from './cleanup'
import { renderProfileFile } from './render'
import {
  applyCleanupIfNotRunning,
  configModule,
  previewProfileFiles,
  restoreCleanupIfNotRunning,
  validatePlayedMods,
  writeProfileToAssignedInstallations,
} from './index'

/**
 * Covers the story 004 D3 acceptance line: "a save writes all non-running
 * targets and a faked running state yields `pending` that a later `write`
 * picks up." Goes straight at `writeProfileToAssignedInstallations`,
 * `previewProfileFiles` and `validatePlayedMods` rather than through
 * `configModule.setup()` - these are the pure/IO-orchestration pieces this
 * deliverable pulled out of the handlers specifically to be testable without
 * booting the whole `ModuleSetup`/`AppContext` machinery.
 */

const log = scopedLogger('config-index-test')

/**
 * The fake `handle` every harness in this file uses.
 *
 * Story 036 D5: `ModuleSetup.handle` takes the payload schema and
 * `MainModuleRegistry.invoke()` validates against it before entering the
 * handler. A harness that took the schema and dropped it would leave every test
 * in this file green while validation was off in the tests and on in production,
 * so this collector mirrors the registry instead: `safeParse`, and a rejected
 * payload answers `fail('ipc.error.invalidPayload')` without the handler ever
 * being called. Tests reach the collected handlers directly, so this is the only
 * place that validation can come from here.
 */
function collectHandlers(handlers: Map<string, ModuleHandler>): ModuleSetup['handle'] {
  return (type, schema, handler) => {
    handlers.set(type, (payload) => {
      const parsed = schema.safeParse(payload)
      if (!parsed.success) return fail('ipc.error.invalidPayload')
      return handler(parsed.data)
    })
  }
}

/**
 * Story 022 D7: the mutating handlers now resolve the canonical profile
 * directory through `lib/paths`' `userDataDir()`, i.e. `app.getPath('userData')`.
 * Under plain vitest `import('electron')` resolves to a path *string*, so `app`
 * would be `undefined` and any handler touching it would throw - hence a real
 * mock, pointed at a per-test temp folder through a hoisted box.
 */
const userDataBox = vi.hoisted(() => ({ current: '' }))

/**
 * Story 023 D2: the `openFile` handler is the module's one privileged path, so
 * `shell` is mocked rather than left out of the `electron` mock - a test must be
 * able to assert that nothing was handed to the OS on a rejected call, which
 * needs a spy, not an absent property that would throw either way.
 */
const shellMock = vi.hoisted(() => ({
  openPath: vi.fn(async (_path: string): Promise<string> => ''),
  showItemInFolder: vi.fn((_path: string): void => {}),
}))
vi.mock('electron', () => ({ app: { getPath: () => userDataBox.current }, shell: shellMock }))

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'q2-launcher-config-index-'))
  userDataBox.current = join(dir, 'userData')
  shellMock.openPath.mockClear()
  shellMock.showItemInFolder.mockClear()
})

afterEach(async () => {
  // maxRetries/retryDelay work around a Windows ENOTEMPTY race where the OS
  // hasn't released a just-closed file handle by the time rmdir runs.
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

function installation(overrides: Partial<Installation> = {}): Installation {
  return {
    id: 'i1',
    name: 'Test',
    rootPath: dir,
    engineKind: 'r1q2',
    launchArgs: [],
    activeGameDir: '',
    source: 'manual',
    status: 'ok',
    checks: [],
    gameDirs: ['baseq2'],
    favorite: false,
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    totalPlaytimeSeconds: 0,
    ...overrides,
  }
}

function profile(overrides: Partial<ConfigProfile> = {}): ConfigProfile {
  return {
    id: 'p1',
    name: 'Profile',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    cvars: { sensitivity: '3' },
    binds: {},
    assignments: [{ installationId: 'i1', isDefault: true }],
    ...overrides,
  }
}

function idleState(): LaunchState {
  return { phase: 'idle', installationId: null }
}

function runningState(installationId: string): LaunchState {
  return { phase: 'running', installationId }
}

describe('writeProfileToAssignedInstallations', () => {
  it('writes all non-running targets to disk', async () => {
    const inst = installation()
    const p = profile()

    const { results, pendingWrites } = await writeProfileToAssignedInstallations({
      profile: p,
      allProfiles: [p],
      installations: { find: (id) => (id === inst.id ? inst : undefined) },
      launchState: idleState(),
      playedModsFor: () => [],
      pendingWrites: {},
      log,
    })

    expect(results).toEqual([{ installationId: 'i1', status: 'written' }])
    expect(pendingWrites).toEqual({})
    // `Profile.cfg` is the sanitized-name file `resolveProfileFileNames` resolves
    // for the default fixture's name ('Profile'), not the old id-based name.
    const content = await readFile(join(dir, 'baseq2', 'Profile.cfg'), 'latin1')
    expect(content).toContain('set sensitivity "3"')
  })

  it('marks a running installation pending, touches no files, and persists the pending entry', async () => {
    const inst = installation()
    const p = profile()

    const { results, pendingWrites } = await writeProfileToAssignedInstallations({
      profile: p,
      allProfiles: [p],
      installations: { find: () => inst },
      launchState: runningState('i1'),
      playedModsFor: () => [],
      pendingWrites: {},
      log,
    })

    expect(results).toEqual([{ installationId: 'i1', status: 'pending' }])
    expect(pendingWrites).toEqual({ i1: 'p1' })
    await expect(readFile(join(dir, 'baseq2', 'q2l-profile-p1.cfg'), 'latin1')).rejects.toThrow()
  })

  it('a later write, once the installation stops running, clears the pending entry and writes', async () => {
    const inst = installation()
    const p = profile()

    const first = await writeProfileToAssignedInstallations({
      profile: p,
      allProfiles: [p],
      installations: { find: () => inst },
      launchState: runningState('i1'),
      playedModsFor: () => [],
      pendingWrites: {},
      log,
    })
    expect(first.pendingWrites).toEqual({ i1: 'p1' })

    const second = await writeProfileToAssignedInstallations({
      profile: p,
      allProfiles: [p],
      installations: { find: () => inst },
      launchState: idleState(),
      playedModsFor: () => [],
      pendingWrites: first.pendingWrites,
      log,
    })

    expect(second.results).toEqual([{ installationId: 'i1', status: 'written' }])
    expect(second.pendingWrites).toEqual({})
    const content = await readFile(join(dir, 'baseq2', 'Profile.cfg'), 'latin1')
    expect(content).toContain('set sensitivity "3"')
  })

  it("also writes the installation's default profile file when saving a different, non-default profile, so the loader's exec target always exists (F1)", async () => {
    const inst = installation()
    // Named distinctly from `other` below so the two never collide under
    // `resolveProfileFileNames` - this test is about F1's default+other
    // file writing, not about collision handling.
    const defaultProfile = profile({
      id: 'p-default',
      name: 'Default',
      cvars: { crosshair: '1' },
      assignments: [{ installationId: 'i1', isDefault: true }],
    })
    const other = profile({
      id: 'p1',
      cvars: { sensitivity: '5' },
      assignments: [{ installationId: 'i1', isDefault: false }],
    })

    const { results } = await writeProfileToAssignedInstallations({
      profile: other,
      allProfiles: [defaultProfile, other],
      installations: { find: () => inst },
      launchState: idleState(),
      playedModsFor: () => [],
      pendingWrites: {},
      log,
    })

    expect(results).toEqual([{ installationId: 'i1', status: 'written' }])
    // The saved profile's own file exists...
    const ownFile = await readFile(join(dir, 'baseq2', 'Profile.cfg'), 'latin1')
    expect(ownFile).toContain('set sensitivity "5"')
    // ...and so does the default's own file, which is what the loader execs.
    const defaultFile = await readFile(join(dir, 'baseq2', 'Default.cfg'), 'latin1')
    expect(defaultFile).toContain('set crosshair "1"')
    const loader = await readFile(join(dir, 'baseq2', 'autoexec.cfg'), 'latin1')
    expect(loader).toContain('exec Default.cfg')
  })

  it('reports unchanged, not written, on a repeat save of a non-default profile once both files exist (F1 aggregation)', async () => {
    const inst = installation()
    const defaultProfile = profile({
      id: 'p-default',
      cvars: { crosshair: '1' },
      assignments: [{ installationId: 'i1', isDefault: true }],
    })
    const other = profile({
      id: 'p1',
      cvars: { sensitivity: '5' },
      assignments: [{ installationId: 'i1', isDefault: false }],
    })
    const deps = {
      profile: other,
      allProfiles: [defaultProfile, other],
      installations: { find: () => inst },
      launchState: idleState(),
      playedModsFor: () => [],
      pendingWrites: {},
      log,
    }

    const first = await writeProfileToAssignedInstallations(deps)
    expect(first.results).toEqual([{ installationId: 'i1', status: 'written' }])

    const second = await writeProfileToAssignedInstallations({ ...deps, pendingWrites: {} })
    expect(second.results).toEqual([{ installationId: 'i1', status: 'unchanged' }])
  })

  it('skips (and does not error on) an assignment whose installation no longer exists', async () => {
    const p = profile({ assignments: [{ installationId: 'ghost', isDefault: true }] })

    const { results } = await writeProfileToAssignedInstallations({
      profile: p,
      allProfiles: [p],
      installations: { find: () => undefined },
      launchState: idleState(),
      playedModsFor: () => [],
      pendingWrites: {},
      log,
    })

    expect(results).toEqual([])
  })

  it('story 007: a 2-profile-assigned installation with a switchBindFor key produces a loader containing the chain', async () => {
    const inst = installation()
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

    const { results } = await writeProfileToAssignedInstallations({
      profile: duel,
      allProfiles: [duel, ctf],
      installations: { find: () => inst },
      launchState: idleState(),
      playedModsFor: () => [],
      switchBindFor: () => 'F9',
      pendingWrites: {},
      log,
    })

    expect(results).toEqual([{ installationId: 'i1', status: 'written' }])
    const loader = await readFile(join(dir, 'baseq2', 'autoexec.cfg'), 'latin1')
    expect(loader).toContain('q2l_switch')
    expect(loader).toContain('exec Duel.cfg')
    expect(loader).toContain('exec CTF.cfg')
    expect(loader).toContain('bind F9 q2l_switch')
  })

  it('story 007: with switchBindFor returning undefined (the default), the loader is byte-identical to a call with no switchBindFor at all', async () => {
    const inst = installation()
    const p = profile()
    const deps = {
      profile: p,
      allProfiles: [p],
      installations: { find: () => inst },
      launchState: idleState(),
      playedModsFor: () => [],
      pendingWrites: {},
      log,
    }

    await writeProfileToAssignedInstallations(deps)
    const withoutSwitchBindFor = await readFile(join(dir, 'baseq2', 'autoexec.cfg'), 'latin1')

    await writeProfileToAssignedInstallations({ ...deps, switchBindFor: () => undefined })
    const withUndefinedSwitchBindFor = await readFile(join(dir, 'baseq2', 'autoexec.cfg'), 'latin1')

    expect(withUndefinedSwitchBindFor).toBe(withoutSwitchBindFor)
    expect(withoutSwitchBindFor).not.toContain('q2l_switch')
  })

  it("story 007: never changes any assignment's isDefault, switch bind or not", async () => {
    const inst = installation()
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
    const before = JSON.parse(JSON.stringify([duel, ctf].map((p) => p.assignments)))

    await writeProfileToAssignedInstallations({
      profile: duel,
      allProfiles: [duel, ctf],
      installations: { find: () => inst },
      launchState: idleState(),
      playedModsFor: () => [],
      switchBindFor: () => 'F9',
      pendingWrites: {},
      log,
    })

    expect([duel, ctf].map((p) => p.assignments)).toEqual(before)
  })
})

describe('previewProfileFiles', () => {
  it('matches exactly what a write under the same conditions produces', async () => {
    const inst = installation()
    const p = profile()

    const preview = previewProfileFiles(p, [p], inst)

    const { results } = await writeProfileToAssignedInstallations({
      profile: p,
      allProfiles: [p],
      installations: { find: () => inst },
      launchState: idleState(),
      playedModsFor: () => [],
      pendingWrites: {},
      log,
    })
    expect(results).toEqual([{ installationId: 'i1', status: 'written' }])

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
      cvars: { crosshair: '1' },
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
    expect(files[0]!.content).toContain('set crosshair "1"')
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
    const setResult = (await setActions({
      profileId: 'p1',
      categories: [category, other],
      actions: orderedActions,
    })) as ConfigProfile[]
    const setProfile = setResult.find((p) => p.id === 'p1')!
    expect(setProfile.actions!.map((a) => a.id)).toEqual(['a3', 'a1', 'a2'])

    const list = handlers.get(CONFIG_HANDLERS.list)!
    const listResult = (await list(undefined)) as ConfigProfile[]
    const listedProfile = listResult.find((p) => p.id === 'p1')!
    expect(listedProfile.actions!.map((a) => a.id)).toEqual(['a3', 'a1', 'a2'])
    expect(listedProfile.actions).toEqual(setProfile.actions)
  })
})

/**
 * Story 022 D7's acceptance line: every mutating handler awaits the sync run
 * before returning (so the file is already on disk by the time the caller sees
 * the list), `setup()` retries persisted failures/pending writes once at start,
 * and `syncState` reports without ever writing.
 *
 * Boots `configModule.setup()` with the same duck-typed `app` + real
 * temp-file-backed `StateStore` pattern as the `preview` handler block above,
 * plus a `launch` (the sync run reads it) and the `electron` mock at the top of
 * this file for `userDataDir()`.
 */
describe('story 022 D7: on-disk sync wired into the config handlers', () => {
  async function boot(
    options: {
      installations?: Installation[]
      launchState?: LaunchState
      /** Runs before `setup()` - for the retry-sweep tests, which need state seeded first. */
      seed?: (state: StateStore) => void
    } = {},
  ): Promise<{ handlers: Map<string, ModuleHandler>; state: StateStore }> {
    const insts = options.installations ?? []
    const state = new StateStore(join(dir, 'state.json'))
    await state.load()
    options.seed?.(state)
    const handlers = new Map<string, ModuleHandler>()
    await configModule.setup({
      handle: collectHandlers(handlers),
      emit: () => {},
      app: {
        installations: {
          find: (id: string) => insts.find((i) => i.id === id),
          list: () => insts,
        },
        launch: { getState: () => options.launchState ?? idleState() },
        state,
      } as unknown as AppContext,
      log,
    })
    return { handlers, state }
  }

  it('create returns the unchanged profile list and the canonical file is already on disk', async () => {
    const { handlers } = await boot({ installations: [installation()] })

    const list = (await handlers.get(CONFIG_HANDLERS.create)!({
      name: 'Fresh',
      from: 'empty',
    })) as ConfigProfile[]

    // Contract unchanged: still a plain `ConfigProfile[]`.
    expect(list).toHaveLength(1)
    const created = list[0]!
    expect(created.name).toBe('Fresh')
    // No extra await needed here - the handler awaited the sync itself.
    expect(await readFile(join(userDataBox.current, 'Fresh.cfg'), 'latin1')).toBe(
      renderProfileFile(created),
    )
  })

  it('creating a profile with no installation at all still produces the canonical file', async () => {
    const { handlers } = await boot()

    const list = (await handlers.get(CONFIG_HANDLERS.create)!({
      name: 'Solo',
      from: 'empty',
    })) as ConfigProfile[]

    expect(list[0]!.assignments).toEqual([])
    expect(await readFile(join(userDataBox.current, 'Solo.cfg'), 'latin1')).toBe(
      renderProfileFile(list[0]!),
    )
  })

  it('setCvars returns the unchanged profile list and both copies are already on disk', async () => {
    const inst = installation()
    const { handlers, state } = await boot({ installations: [inst] })
    state.setConfigProfiles([profile()])
    await state.settle()

    const list = (await handlers.get(CONFIG_HANDLERS.setCvars)!({
      profileId: 'p1',
      cvars: { sensitivity: '7' },
    })) as ConfigProfile[]

    expect(list.map((p) => p.id)).toEqual(['p1'])
    const updated = list.find((p) => p.id === 'p1')!
    expect(updated.cvars['sensitivity']).toBe('7')
    const expected = renderProfileFile(updated)
    expect(await readFile(join(userDataBox.current, 'Profile.cfg'), 'latin1')).toBe(expected)
    // ...and the assigned installation's copy, written by the same run.
    expect(await readFile(join(dir, 'baseq2', 'Profile.cfg'), 'latin1')).toBe(expected)
  })

  it('syncState reports inSync for both copies right after a mutation synced them', async () => {
    const inst = installation()
    const { handlers, state } = await boot({ installations: [inst] })
    state.setConfigProfiles([profile()])
    await state.settle()
    await handlers.get(CONFIG_HANDLERS.setCvars)!({ profileId: 'p1', cvars: { sensitivity: '7' } })

    const result = (await handlers.get(CONFIG_HANDLERS.syncState)!({
      profileId: 'p1',
    })) as Outcome<ProfileSyncState>

    if (!result.ok) throw new Error('expected syncState to succeed')
    expect(result.value.own.status).toBe('inSync')
    expect(result.value.own.fileName).toBe('Profile.cfg')
    expect(result.value.installations).toEqual([
      {
        installationId: 'i1',
        path: join(dir, 'baseq2', 'Profile.cfg'),
        fileName: 'Profile.cfg',
        status: 'inSync',
      },
    ])
  })

  it('setup() retries a persisted write failure once and clears it on success', async () => {
    const seeded = profile({ assignments: [] })
    const { state } = await boot({
      seed: (s) => {
        s.setConfigProfiles([seeded])
        s.setConfigWriteFailures({
          'p1|own': { messageKey: 'config.error.writeFailed', at: '2026-01-01T00:00:00.000Z' },
        })
      },
    })

    expect(await readFile(join(userDataBox.current, 'Profile.cfg'), 'latin1')).toBe(
      renderProfileFile(seeded),
    )
    expect(state.configWriteFailures()).toEqual({})
  })

  it('setup() retries a persisted pending write once and clears it on success', async () => {
    const inst = installation()
    const { state } = await boot({
      installations: [inst],
      seed: (s) => {
        s.setConfigProfiles([profile()])
        s.setConfigPendingWrites({ i1: 'p1' })
      },
    })

    expect(await pathExists(join(dir, 'baseq2', 'Profile.cfg'))).toBe(true)
    expect(state.configPendingWrites()).toEqual({})
  })

  it('setup() skips stale bookkeeping for a profile that no longer exists, without throwing', async () => {
    const { state } = await boot({
      seed: (s) => {
        s.setConfigProfiles([])
        s.setConfigWriteFailures({
          'ghost|own': { messageKey: 'config.error.writeFailed', at: '2026-01-01T00:00:00.000Z' },
        })
        s.setConfigPendingWrites({ i1: 'ghost' })
      },
    })

    // Resolved without throwing (getting here is the assertion) and the
    // dangling entries are simply left alone - cleaning them up is not D7's job.
    expect(state.configWriteFailures()['ghost|own']).toBeDefined()
    expect(await pathExists(userDataBox.current)).toBe(false)
  })

  it('syncState fails with profileNotFound for an unknown id', async () => {
    const { handlers, state } = await boot()
    state.setConfigProfiles([profile({ assignments: [] })])
    await state.settle()

    const result = await handlers.get(CONFIG_HANDLERS.syncState)!({ profileId: 'nope' })

    expect(result).toEqual({ ok: false, error: { key: 'config.error.profileNotFound' } })
  })

  it('syncState is read-only: reports missing and creates nothing', async () => {
    const { handlers, state } = await boot()
    state.setConfigProfiles([profile({ assignments: [] })])
    await state.settle()
    const canonical = join(userDataBox.current, 'Profile.cfg')
    expect(await pathExists(canonical)).toBe(false)

    const result = (await handlers.get(CONFIG_HANDLERS.syncState)!({
      profileId: 'p1',
    })) as Outcome<ProfileSyncState>

    if (!result.ok) throw new Error('expected syncState to succeed')
    expect(result.value.own.status).toBe('missing')
    expect(result.value.installations).toEqual([])
    // The regression this guards: someone rebuilding `syncState` on
    // `syncProfile`, which writes.
    expect(await pathExists(canonical)).toBe(false)
  })

  it('write retries through the new sync engine and clears a persisted failure on success', async () => {
    const inst = installation()
    const { handlers, state } = await boot({
      installations: [inst],
      seed: (s) => {
        s.setConfigProfiles([profile()])
        // Simulates a previous mutation's sync run having failed to write this
        // installation's copy (e.g. a locked directory that has since been
        // fixed) - before story 022 D7's write-handler fix, `write` never
        // touched `configWriteFailures` at all, so this entry would have
        // survived a successful retry forever and `syncState` would have kept
        // reporting `error` regardless of what was actually on disk.
        s.setConfigWriteFailures({
          'p1|i1': { messageKey: 'config.error.writeFailed', at: '2026-01-01T00:00:00.000Z' },
        })
      },
    })

    const result = (await handlers.get(CONFIG_HANDLERS.write)!({
      profileId: 'p1',
    })) as Outcome<WriteTargetResult[]>

    if (!result.ok) throw new Error('expected write to succeed')
    expect(result.value).toEqual([{ installationId: 'i1', status: 'written' }])
    expect(state.configWriteFailures()).toEqual({})

    const synced = (await handlers.get(CONFIG_HANDLERS.syncState)!({
      profileId: 'p1',
    })) as Outcome<ProfileSyncState>
    if (!synced.ok) throw new Error('expected syncState to succeed')
    expect(synced.value.installations).toEqual([
      { installationId: 'i1', path: join(dir, 'baseq2', 'Profile.cfg'), fileName: 'Profile.cfg', status: 'inSync' },
    ])
  })
})

/**
 * Story 023 D1: `rawFiles`' read-only report of the profile's own canonical
 * file plus one entry per assigned installation. Same boot pattern as the
 * story 022 D7 block above (own local helper, since that one is private to
 * its own `describe`) - a duck-typed `app` with a real, temp-file-backed
 * `StateStore`, so mutations actually land on disk and `rawFiles` has
 * something real to read back.
 */
describe('CONFIG_HANDLERS.rawFiles handler (story 023 D1)', () => {
  async function boot(
    installations: Installation[] = [],
  ): Promise<{ handlers: Map<string, ModuleHandler>; state: StateStore }> {
    const state = new StateStore(join(dir, 'state.json'))
    await state.load()
    const handlers = new Map<string, ModuleHandler>()
    await configModule.setup({
      handle: collectHandlers(handlers),
      emit: () => {},
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

  it('reports canonical onDisk: false for a freshly created, unassigned profile, then true after a sync-triggering mutation', async () => {
    const { handlers, state } = await boot()
    state.setConfigProfiles([profile({ assignments: [] })])
    await state.settle()

    const before = (await handlers.get(CONFIG_HANDLERS.rawFiles)!({
      profileId: 'p1',
    })) as Outcome<RawFilesResult>
    if (!before.ok) throw new Error('expected rawFiles to succeed')
    expect(before.value.canonical.onDisk).toBe(false)
    expect(before.value.canonical.content).toBe('')
    expect(before.value.installations).toEqual([])

    await handlers.get(CONFIG_HANDLERS.setCvars)!({
      profileId: 'p1',
      cvars: { sensitivity: '9' },
    })

    const after = (await handlers.get(CONFIG_HANDLERS.rawFiles)!({
      profileId: 'p1',
    })) as Outcome<RawFilesResult>
    if (!after.ok) throw new Error('expected rawFiles to succeed')
    expect(after.value.canonical.onDisk).toBe(true)
    const updated = (await handlers.get(CONFIG_HANDLERS.list)!(undefined)) as ConfigProfile[]
    expect(after.value.canonical.content).toBe(renderProfileFile(updated.find((p) => p.id === 'p1')!))
  })

  it('reports matches: true right after a sync, and false once the on-disk copy is edited independently', async () => {
    const inst = installation()
    const { handlers, state } = await boot([inst])
    state.setConfigProfiles([profile()])
    await state.settle()
    await handlers.get(CONFIG_HANDLERS.setCvars)!({ profileId: 'p1', cvars: { sensitivity: '9' } })

    const inSync = (await handlers.get(CONFIG_HANDLERS.rawFiles)!({
      profileId: 'p1',
    })) as Outcome<RawFilesResult>
    if (!inSync.ok) throw new Error('expected rawFiles to succeed')
    expect(inSync.value.installations).toEqual([
      {
        installationId: inst.id,
        path: join(dir, 'baseq2', 'Profile.cfg'),
        onDisk: true,
        matches: true,
        playedMods: [],
      },
    ])

    await writeFile(join(dir, 'baseq2', 'Profile.cfg'), 'hand-edited\n', 'latin1')

    const outOfSync = (await handlers.get(CONFIG_HANDLERS.rawFiles)!({
      profileId: 'p1',
    })) as Outcome<RawFilesResult>
    if (!outOfSync.ok) throw new Error('expected rawFiles to succeed')
    expect(outOfSync.value.installations[0]!.onDisk).toBe(true)
    expect(outOfSync.value.installations[0]!.matches).toBe(false)
  })

  it('reports one entry per assignment', async () => {
    const inst1 = installation({ id: 'i1' })
    const inst2 = installation({ id: 'i2', rootPath: join(dir, 'inst2') })
    await mkdir(join(inst2.rootPath, 'baseq2'), { recursive: true })
    const { handlers, state } = await boot([inst1, inst2])
    state.setConfigProfiles([
      profile({
        assignments: [
          { installationId: 'i1', isDefault: true },
          { installationId: 'i2', isDefault: true },
        ],
      }),
    ])
    await state.settle()
    await handlers.get(CONFIG_HANDLERS.setCvars)!({ profileId: 'p1', cvars: { sensitivity: '9' } })

    const result = (await handlers.get(CONFIG_HANDLERS.rawFiles)!({
      profileId: 'p1',
    })) as Outcome<RawFilesResult>

    if (!result.ok) throw new Error('expected rawFiles to succeed')
    expect(result.value.installations.map((i) => i.installationId).sort()).toEqual(['i1', 'i2'])
  })

  it('echoes playedMods from app.state.configPlayedMods() for each installation entry', async () => {
    const inst = installation({ gameDirs: ['baseq2', 'ctf'] })
    const { handlers, state } = await boot([inst])
    state.setConfigProfiles([profile()])
    state.setConfigPlayedMods({ i1: ['ctf'] })
    await state.settle()
    await handlers.get(CONFIG_HANDLERS.setCvars)!({ profileId: 'p1', cvars: { sensitivity: '9' } })

    const result = (await handlers.get(CONFIG_HANDLERS.rawFiles)!({
      profileId: 'p1',
    })) as Outcome<RawFilesResult>

    if (!result.ok) throw new Error('expected rawFiles to succeed')
    expect(result.value.installations).toEqual([
      expect.objectContaining({ installationId: 'i1', playedMods: ['ctf'] }),
    ])
  })

  it('fails with config.error.profileNotFound for an unknown profile id', async () => {
    const { handlers, state } = await boot()
    state.setConfigProfiles([])
    await state.settle()

    const result = await handlers.get(CONFIG_HANDLERS.rawFiles)!({ profileId: 'nope' })

    expect(result).toEqual({ ok: false, error: { key: 'config.error.profileNotFound' } })
  })
})

/**
 * Story 023 D2: `openFile`, the module's one privileged path. Every assertion
 * below is about the same thing - that `shell` is only ever reached for a file
 * main itself resolved from ids AND verified to be this profile's own `.cfg`
 * (AC 8). Same boot pattern as the `rawFiles` block above: a duck-typed `app`
 * over a real, temp-file-backed `StateStore`, so a mutation really does put the
 * file on disk and the checks have something real to look at.
 */
describe('CONFIG_HANDLERS.openFile handler (story 023 D2)', () => {
  async function boot(
    installations: Installation[] = [],
  ): Promise<{ handlers: Map<string, ModuleHandler>; state: StateStore }> {
    const state = new StateStore(join(dir, 'state.json'))
    await state.load()
    const handlers = new Map<string, ModuleHandler>()
    await configModule.setup({
      handle: collectHandlers(handlers),
      emit: () => {},
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

  /** Boots, seeds one profile and triggers a sync, so its files are really on disk. */
  async function bootSynced(
    installations: Installation[] = [],
    seeded: ConfigProfile = profile({ assignments: [] }),
  ): Promise<Map<string, ModuleHandler>> {
    const { handlers, state } = await boot(installations)
    state.setConfigProfiles([seeded])
    await state.settle()
    await handlers.get(CONFIG_HANDLERS.setCvars)!({ profileId: seeded.id, cvars: { sensitivity: '9' } })
    return handlers
  }

  it('opens the profile\'s own canonical file with the path main resolved itself', async () => {
    const handlers = await bootSynced()

    const result = await handlers.get(CONFIG_HANDLERS.openFile)!({
      profileId: 'p1',
      installationId: null,
      mode: 'open',
    })

    expect(result).toEqual({ ok: true, value: null })
    expect(shellMock.openPath).toHaveBeenCalledTimes(1)
    expect(shellMock.openPath).toHaveBeenCalledWith(join(userDataBox.current, 'Profile.cfg'))
    expect(shellMock.showItemInFolder).not.toHaveBeenCalled()
  })

  it("reveals an assigned installation's copy, and reveal never opens", async () => {
    const inst = installation()
    const handlers = await bootSynced([inst], profile())

    const result = await handlers.get(CONFIG_HANDLERS.openFile)!({
      profileId: 'p1',
      installationId: 'i1',
      mode: 'reveal',
    })

    expect(result).toEqual({ ok: true, value: null })
    expect(shellMock.showItemInFolder).toHaveBeenCalledTimes(1)
    expect(shellMock.showItemInFolder).toHaveBeenCalledWith(join(dir, 'baseq2', 'Profile.cfg'))
    expect(shellMock.openPath).not.toHaveBeenCalled()
  })

  it('surfaces a non-empty shell.openPath error as config.error.openFailed', async () => {
    const handlers = await bootSynced()
    shellMock.openPath.mockResolvedValueOnce('no application is associated with .cfg')

    const result = await handlers.get(CONFIG_HANDLERS.openFile)!({
      profileId: 'p1',
      installationId: null,
      mode: 'open',
    })

    expect(result).toEqual({
      ok: false,
      error: {
        key: 'config.error.openFailed',
        params: { message: 'no application is associated with .cfg' },
      },
    })
  })

  it('refuses an unknown profile id without touching shell', async () => {
    const handlers = await bootSynced()

    const result = await handlers.get(CONFIG_HANDLERS.openFile)!({
      profileId: 'nope',
      installationId: null,
      mode: 'open',
    })

    expect(result).toEqual({ ok: false, error: { key: 'config.error.profileNotFound' } })
    expect(shellMock.openPath).not.toHaveBeenCalled()
    expect(shellMock.showItemInFolder).not.toHaveBeenCalled()
  })

  it('refuses an unknown installation id without touching shell', async () => {
    const handlers = await bootSynced([installation()], profile())

    const result = await handlers.get(CONFIG_HANDLERS.openFile)!({
      profileId: 'p1',
      installationId: 'ghost',
      mode: 'open',
    })

    expect(result).toEqual({ ok: false, error: { key: 'config.error.installationNotFound' } })
    expect(shellMock.openPath).not.toHaveBeenCalled()
    expect(shellMock.showItemInFolder).not.toHaveBeenCalled()
  })

  it('refuses an installation that exists but is not assigned to this profile', async () => {
    // i2 is a real, registered installation with a real synced file of its own -
    // it is simply not one of p1's targets, which is what must be refused here.
    const inst2 = installation({ id: 'i2', rootPath: join(dir, 'inst2') })
    await mkdir(join(inst2.rootPath, 'baseq2'), { recursive: true })
    const handlers = await bootSynced([installation(), inst2], profile())

    const result = await handlers.get(CONFIG_HANDLERS.openFile)!({
      profileId: 'p1',
      installationId: 'i2',
      mode: 'reveal',
    })

    expect(result).toEqual({ ok: false, error: { key: 'config.error.installationNotFound' } })
    expect(shellMock.showItemInFolder).not.toHaveBeenCalled()
  })

  it('refuses a file that is not on disk without touching shell', async () => {
    // No sync ran, so the canonical file was never written - AC 5's "the file is
    // not on disk" half, surfaced as the reason the UI disables the action with.
    const { handlers, state } = await boot()
    state.setConfigProfiles([profile({ assignments: [] })])
    await state.settle()
    expect(await pathExists(join(userDataBox.current, 'Profile.cfg'))).toBe(false)

    const result = await handlers.get(CONFIG_HANDLERS.openFile)!({
      profileId: 'p1',
      installationId: null,
      mode: 'open',
    })

    expect(result).toEqual({ ok: false, error: { key: 'config.error.fileNotFound' } })
    expect(shellMock.openPath).not.toHaveBeenCalled()
    expect(shellMock.showItemInFolder).not.toHaveBeenCalled()
  })

  it("refuses a foreign file sitting at the resolved path - not this profile's own file", async () => {
    const { handlers, state } = await boot()
    state.setConfigProfiles([profile({ assignments: [] })])
    await state.settle()
    // Exists, is a `.cfg`, sits exactly where this profile's canonical file
    // would - and is somebody else's. The sentinel is what tells them apart.
    await mkdir(userDataBox.current, { recursive: true })
    await writeFile(
      join(userDataBox.current, 'Profile.cfg'),
      'seta sensitivity "1"\n// hand-written\n',
      'latin1',
    )

    const result = await handlers.get(CONFIG_HANDLERS.openFile)!({
      profileId: 'p1',
      installationId: null,
      mode: 'open',
    })

    expect(result).toEqual({ ok: false, error: { key: 'config.error.fileNotFound' } })
    expect(shellMock.openPath).not.toHaveBeenCalled()
    expect(shellMock.showItemInFolder).not.toHaveBeenCalled()
  })

  it('refuses a malformed payload (a path where an id belongs) without touching shell', async () => {
    const handlers = await bootSynced()

    const result = await handlers.get(CONFIG_HANDLERS.openFile)!({
      profileId: 'p1',
      installationId: 'C:\\Windows\\System32\\calc.exe',
      mode: 'launch',
    })

    expect(result).toEqual({ ok: false, error: { key: 'ipc.error.invalidPayload' } })
    expect(shellMock.openPath).not.toHaveBeenCalled()
    expect(shellMock.showItemInFolder).not.toHaveBeenCalled()
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

/**
 * Story 010 D3's own acceptance line: "a test drives scan -> apply -> restore
 * against a temp installation and a faked running launch state makes apply
 * fail without touching disk." `scanRedundantCopies`/`removeRedundantCopies`/
 * `restoreRemovedCopies` themselves are already covered against a real temp
 * tree in `cleanup.test.ts` (D1/D2) - what is uniquely D3's to prove is the
 * running-guard `applyCleanupIfNotRunning`/`restoreCleanupIfNotRunning` add on
 * top, and that `scan` has no such guard at all (decision 12).
 */
describe('applyCleanupIfNotRunning / restoreCleanupIfNotRunning', () => {
  const HAND_WRITTEN = 'bind mouse2 "+attack"\nset name "player"\n'

  async function seed(relativePath: string, content: string): Promise<void> {
    const target = join(dir, relativePath)
    await mkdir(join(target, '..'), { recursive: true })
    await writeFile(target, content, 'latin1')
  }

  async function seedRedundantHud(): Promise<Installation> {
    await seed('baseq2/hud.cfg', HAND_WRITTEN)
    await seed('ctf/hud.cfg', HAND_WRITTEN)
    return installation({ gameDirs: ['baseq2', 'ctf'] })
  }

  it('drives scan -> apply -> restore end to end while idle', async () => {
    const inst = await seedRedundantHud()

    const findings = await scanRedundantCopies(inst)
    expect(findings).toEqual([
      { gameDir: 'ctf', fileName: 'hud.cfg', identical: true, size: HAND_WRITTEN.length },
    ])

    const applyResult = await applyCleanupIfNotRunning(inst, findings, idleState())
    expect(applyResult).toEqual({
      ok: true,
      value: { removed: [{ gameDir: 'ctf', fileName: 'hud.cfg' }], rejected: [] },
    })
    expect(await pathExists(join(dir, 'ctf', 'hud.cfg'))).toBe(false)
    expect(await readFile(join(dir, 'ctf', 'hud.cfg.q2l-backup'), 'latin1')).toBe(HAND_WRITTEN)

    const restoreResult = await restoreCleanupIfNotRunning(
      inst,
      applyResult.ok ? applyResult.value.removed : [],
      idleState(),
    )
    expect(restoreResult).toEqual({
      ok: true,
      value: { restored: [{ gameDir: 'ctf', fileName: 'hud.cfg' }], rejected: [] },
    })
    expect(await readFile(join(dir, 'ctf', 'hud.cfg'), 'latin1')).toBe(HAND_WRITTEN)
  })

  it('refuses apply on a running installation and touches no files', async () => {
    const inst = await seedRedundantHud()
    const findings = await scanRedundantCopies(inst)

    const result = await applyCleanupIfNotRunning(inst, findings, runningState(inst.id))

    expect(result).toEqual({ ok: false, error: { key: 'config.error.installationRunning' } })
    expect(await readFile(join(dir, 'ctf', 'hud.cfg'), 'latin1')).toBe(HAND_WRITTEN)
    expect(await pathExists(join(dir, 'ctf', 'hud.cfg.q2l-backup'))).toBe(false)
  })

  it('refuses restore on a running installation and touches no files', async () => {
    const inst = await seedRedundantHud()
    const findings = await scanRedundantCopies(inst)
    const applyResult = await applyCleanupIfNotRunning(inst, findings, idleState())
    const removed = applyResult.ok ? applyResult.value.removed : []

    const result = await restoreCleanupIfNotRunning(inst, removed, runningState(inst.id))

    expect(result).toEqual({ ok: false, error: { key: 'config.error.installationRunning' } })
    // Still deleted from the earlier (idle) apply, not restored by this call.
    expect(await pathExists(join(dir, 'ctf', 'hud.cfg'))).toBe(false)
  })

  it('scan is never gated by a running installation (decision 12)', async () => {
    const inst = await seedRedundantHud()

    // scanRedundantCopies takes no launchState at all - there is nothing to
    // gate. This test's own existence is the assertion: a running-guard
    // added to scan by mistake would need a `launchState` parameter that
    // does not exist on this function's signature, which would fail to
    // compile, not just fail at runtime.
    const findings = await scanRedundantCopies(inst)

    expect(findings).toEqual([
      { gameDir: 'ctf', fileName: 'hud.cfg', identical: true, size: HAND_WRITTEN.length },
    ])
  })
})

/**
 * Story 025 D3: `tidyUp.apply` - the module's one non-setter mutating handler.
 * Its acceptance is about the *once* guarantees, which only exist at this level
 * and not in the pure applier (`@shared/config/tidy-up`, covered by its own
 * unit tests): one `updatedAt` bump, one commit and one sync run for a whole
 * batch, and none of the three when nothing applied.
 *
 * Same duck-typed `app` + real temp-file-backed `StateStore` boot as the blocks
 * above, plus a `launch` (the sync run reads it).
 */
describe('CONFIG_HANDLERS.tidyUpApply handler (story 025 D3)', () => {
  async function bootTidyUp(
    seeded: ConfigProfile,
    insts: Installation[] = [],
  ): Promise<{ handler: ModuleHandler; state: StateStore; commits: () => number }> {
    const state = new StateStore(join(dir, 'state.json'))
    await state.load()
    const handlers = new Map<string, ModuleHandler>()
    await configModule.setup({
      handle: collectHandlers(handlers),
      emit: () => {},
      app: {
        installations: {
          find: (id: string) => insts.find((i) => i.id === id),
          list: () => insts,
        },
        launch: { getState: () => idleState() },
        state,
      } as unknown as AppContext,
      log,
    })
    state.setConfigProfiles([seeded])
    await state.settle()
    // Spied only *after* seeding, so the count is the handler's own commits.
    const spy = vi.spyOn(state, 'setConfigProfiles')
    return { handler: handlers.get(CONFIG_HANDLERS.tidyUpApply)!, state, commits: () => spy.mock.calls.length }
  }

  const preservedLine = { file: 'config.cfg', line: 7, text: 'alias +test "echo hi"' }

  function messyProfile(): ConfigProfile {
    return profile({
      cvars: {},
      // Two spellings of one key - the duplicate-bind shape an import produces.
      // Deliberately non-catalogue commands, so `commit`'s own `adoptRawBinds`
      // pass has nothing to adopt and cannot muddy what this test asserts.
      binds: { MOUSE1: 'echo one', mouse1: 'echo two' },
      layers: [{ id: 'l1', name: 'Empty', mode: 'hold', triggerKey: 'ALT', overrides: { '1': '  ' } }],
      unrecognized: [preservedLine],
    })
  }

  it('applies a batch, bumps updatedAt exactly once, commits once and syncs once', async () => {
    const inst = installation()
    const seeded = messyProfile()
    const { handler, state, commits } = await bootTidyUp(seeded, [inst])

    const result = (await handler({
      profileId: 'p1',
      ops: [
        {
          kind: 'removeShadowedBind',
          scope: 'base',
          key: 'MOUSE1',
          claim: { source: 'baseBind', command: 'echo one' },
        },
        { kind: 'removeEmptyLayer', layerId: 'l1' },
        {
          kind: 'reclassifyPreservedLine',
          ...preservedLine,
          target: { field: 'cvars', name: 'sensitivity', value: '5' },
        },
      ],
    })) as Outcome<TidyUpApplyResult>

    if (!result.ok) throw new Error('expected tidyUp.apply to succeed')
    expect(result.value.applied).toHaveLength(3)
    expect(result.value.rejected).toEqual([])

    const updated = result.value.profile
    expect(updated.binds).toEqual({ mouse1: 'echo two' })
    expect(updated.layers).toEqual([])
    expect(updated.cvars).toEqual({ sensitivity: '5' })
    expect(updated.unrecognized).toEqual([])

    // One bump for the whole batch, and the value the handler returned is the
    // value that got persisted - not one of three intermediate ones.
    expect(updated.updatedAt).not.toBe(seeded.updatedAt)
    expect(state.configProfiles()[0]!.updatedAt).toBe(updated.updatedAt)
    expect(commits()).toBe(1)

    // ...and the one sync run wrote the fully-tidied file to both places.
    const expected = renderProfileFile(updated)
    expect(await readFile(join(userDataBox.current, 'Profile.cfg'), 'latin1')).toBe(expected)
    expect(await readFile(join(dir, 'baseq2', 'Profile.cfg'), 'latin1')).toBe(expected)
  })

  it('rejects a stale op without bumping updatedAt, committing or syncing', async () => {
    const inst = installation()
    const seeded = messyProfile()
    const { handler, state, commits } = await bootTidyUp(seeded, [inst])

    const stale = { kind: 'removeEmptyLayer' as const, layerId: 'never-existed' }
    const result = (await handler({ profileId: 'p1', ops: [stale] })) as Outcome<TidyUpApplyResult>

    if (!result.ok) throw new Error('expected tidyUp.apply to succeed')
    expect(result.value.applied).toEqual([])
    expect(result.value.rejected).toEqual([stale])
    expect(result.value.profile.updatedAt).toBe(seeded.updatedAt)
    expect(result.value.profile.layers).toHaveLength(1)
    expect(state.configProfiles()[0]!.updatedAt).toBe(seeded.updatedAt)
    expect(commits()).toBe(0)
    // Nothing changed, so nothing was written - not even the canonical copy.
    expect(await pathExists(join(userDataBox.current, 'Profile.cfg'))).toBe(false)
  })

  it('fails a malformed payload without touching the profile', async () => {
    const seeded = messyProfile()
    const { handler, commits } = await bootTidyUp(seeded)

    const badOp = (await handler({
      profileId: 'p1',
      ops: [{ kind: 'removeEmptyLayer' }],
    })) as Outcome<TidyUpApplyResult>
    const unknownKind = (await handler({
      profileId: 'p1',
      ops: [{ kind: 'reformatEverything' }],
    })) as Outcome<TidyUpApplyResult>
    const noProfile = (await handler({ ops: [] })) as Outcome<TidyUpApplyResult>

    for (const result of [badOp, unknownKind, noProfile]) {
      expect(result).toEqual({ ok: false, error: { key: 'ipc.error.invalidPayload' } })
    }
    expect(commits()).toBe(0)
  })

  it('fails an unknown profile id', async () => {
    const { handler } = await bootTidyUp(messyProfile())

    const result = (await handler({ profileId: 'nope', ops: [] })) as Outcome<TidyUpApplyResult>

    expect(result).toEqual({ ok: false, error: { key: 'config.error.profileNotFound' } })
  })
})
