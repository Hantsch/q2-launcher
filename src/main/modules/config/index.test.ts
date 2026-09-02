import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CONFIG_HANDLERS,
  type ConfigProfile,
  type DiscardProfileResult,
  type PreviewProfileResult,
  type ProfileSyncState,
  type RawFilesResult,
  type RefreshFromFilesResult,
  type SaveProfileResult,
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
import { hashCanonicalFileContent, readFileState } from './file-source'
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
 * Story 043 D5: `readFileState` is wrapped (delegating to the real implementation by default) so
 * `refreshFromFiles`' `unparseable`/`readError` branches - both documented in `file-source.ts` as
 * defensive boundaries a real file cannot realistically trigger (the parser degrades to a warning
 * rather than throwing) - can still be exercised with `mockResolvedValueOnce`, without weakening
 * any of the other, disk-backed tests in this file that exercise the real read path.
 */
vi.mock('./file-source', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./file-source')>()
  return { ...actual, readFileState: vi.fn(actual.readFileState) }
})

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
      // Deliberately not `crosshair`'s catalogue default ("1"): since story 048 D2 every rendered
      // file carries every catalogue cvar, so a stored value equal to the default would show up in
      // *both* profiles' files and the assertion below would no longer tell them apart.
      cvars: { crosshair: '3' },
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
    expect(defaultFile).toContain('set crosshair   "3"')
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

  it('setCvars persists the edit and marks the profile dirty, and writes no file at all (story 043 D4)', async () => {
    const inst = installation()
    const { handlers, state } = await boot({ installations: [inst] })
    state.setConfigProfiles([profile()])
    await state.settle()

    const list = (await handlers.get(CONFIG_HANDLERS.setCvars)!({
      profileId: 'p1',
      cvars: { sensitivity: '7' },
    })) as ConfigProfile[]

    // Story 022 decision 8, deliberately inverted by story 043 D4: the edit is in `state.json`
    // immediately (a crash must not lose it) and marked as not-yet-in-the-file, but nothing on disk
    // was touched - only `save` writes profile content now.
    expect(list.map((p) => p.id)).toEqual(['p1'])
    const updated = list.find((p) => p.id === 'p1')!
    expect(updated.cvars['sensitivity']).toBe('7')
    expect(updated.dirty).toBe(true)
    expect(state.configProfiles()[0]!.cvars['sensitivity']).toBe('7')
    expect(state.configProfiles()[0]!.dirty).toBe(true)
    expect(await pathExists(join(userDataBox.current, 'Profile.cfg'))).toBe(false)
    expect(await pathExists(join(dir, 'baseq2', 'Profile.cfg'))).toBe(false)
  })

  it('every content mutation marks the profile dirty and leaves an existing canonical file byte-identical (story 043 D4)', async () => {
    const inst = installation()
    const { handlers, state } = await boot({ installations: [inst] })
    state.setConfigProfiles([profile()])
    await state.settle()
    // One save first, so there ARE files the mutations below could have clobbered.
    await handlers.get(CONFIG_HANDLERS.save)!({ profileId: 'p1' })
    const canonical = join(userDataBox.current, 'Profile.cfg')
    const installationCopy = join(dir, 'baseq2', 'Profile.cfg')
    const saved = await readFile(canonical, 'latin1')
    const savedCopy = await readFile(installationCopy, 'latin1')

    const mutations: [string, unknown][] = [
      [CONFIG_HANDLERS.setCvars, { profileId: 'p1', cvars: { sensitivity: '11' } }],
      [CONFIG_HANDLERS.setBinds, { profileId: 'p1', binds: { x: '+attack' } }],
      [CONFIG_HANDLERS.setLayers, { profileId: 'p1', layers: [] }],
      [CONFIG_HANDLERS.setActions, { profileId: 'p1', categories: [], actions: [] }],
      [CONFIG_HANDLERS.setWriteUnbindall, { profileId: 'p1', writeUnbindall: false }],
      [CONFIG_HANDLERS.setSectionHeaderStyle, { profileId: 'p1', sectionHeaderStyle: 'brackets' }],
      // `rename` last, and named `id` rather than `profileId`: it is the one whose file name would
      // move on disk, so it is also the one whose skipped write is most visible below.
      [CONFIG_HANDLERS.rename, { id: 'p1', name: 'Renamed' }],
    ]
    for (const [type, payload] of mutations) {
      // Each mutation is checked on its own: one handler still calling the sync engine would show
      // up here as a changed file, and nowhere else.
      const list = (await handlers.get(type)!(payload)) as ConfigProfile[]
      expect(list.find((p) => p.id === 'p1')!.dirty, `${type} marks the profile dirty`).toBe(true)
      expect(await readFile(canonical, 'latin1'), `${type} wrote no canonical file`).toBe(saved)
      expect(await readFile(installationCopy, 'latin1'), `${type} wrote no copy`).toBe(savedCopy)
      // Not even under the name a renamed profile now resolves to.
      expect(await pathExists(join(userDataBox.current, 'Renamed.cfg'))).toBe(false)
      expect(await pathExists(join(dir, 'baseq2', 'Renamed.cfg'))).toBe(false)
    }
  })

  it('discard restores the baseline and leaves both files byte-identical (story 049 D3)', async () => {
    const inst = installation()
    const { handlers, state } = await boot({ installations: [inst] })
    state.setConfigProfiles([profile()])
    await state.settle()
    // The save is what seeds the baseline, and what puts the files there that a discard could clobber.
    await handlers.get(CONFIG_HANDLERS.save)!({ profileId: 'p1' })
    const canonical = join(userDataBox.current, 'Profile.cfg')
    const installationCopy = join(dir, 'baseq2', 'Profile.cfg')
    const saved = await readFile(canonical, 'latin1')
    const savedCopy = await readFile(installationCopy, 'latin1')

    // Unsaved edits of three kinds, including the rename that a save would move the file for.
    await handlers.get(CONFIG_HANDLERS.setCvars)!({ profileId: 'p1', cvars: { sensitivity: '99' } })
    await handlers.get(CONFIG_HANDLERS.setBinds)!({ profileId: 'p1', binds: { x: '+attack' } })
    await handlers.get(CONFIG_HANDLERS.rename)!({ id: 'p1', name: 'Renamed' })

    const result = (await handlers.get(CONFIG_HANDLERS.discard)!({
      profileId: 'p1',
    })) as DiscardProfileResult
    expect(result.status).toBe('discarded')
    if (result.status !== 'discarded') throw new Error('unreachable')

    // The returned profile is back at what the file on disk says...
    const restored = result.profiles.find((p) => p.id === 'p1')!
    expect(restored.cvars['sensitivity']).toBe('3')
    expect(restored.binds).toEqual({})
    expect(restored.name).toBe('Profile')
    expect(restored.dirty).toBe(false)
    expect(state.configProfiles()[0]!.name).toBe('Profile')

    // ...and getting there wrote nothing: same bytes in both places, and no file under the name the
    // profile briefly had. Rendering the restored profile reproduces the file it never touched.
    expect(await readFile(canonical, 'latin1')).toBe(saved)
    expect(await readFile(installationCopy, 'latin1')).toBe(savedCopy)
    expect(renderProfileFile(restored)).toBe(saved)
    expect(await pathExists(join(userDataBox.current, 'Renamed.cfg'))).toBe(false)
    expect(await pathExists(join(dir, 'baseq2', 'Renamed.cfg'))).toBe(false)
  })

  it('setSectionHeaderStyle (story 042 D7) persists the new style, marks the profile dirty and writes nothing until a save', async () => {
    const inst = installation()
    const { handlers, state } = await boot({ installations: [inst] })
    state.setConfigProfiles([profile()])
    await state.settle()

    const list = (await handlers.get(CONFIG_HANDLERS.setSectionHeaderStyle)!({
      profileId: 'p1',
      sectionHeaderStyle: 'brackets',
    })) as ConfigProfile[]

    expect(list.map((p) => p.id)).toEqual(['p1'])
    const updated = list.find((p) => p.id === 'p1')!
    expect(updated.sectionHeaderStyle).toBe('brackets')
    // Story 043 D4: this setter is write-affecting (it changes what `renderProfileFile` emits), so
    // it is a content mutation and takes the same explicit-save route as `setCvars` - no file yet.
    expect(updated.dirty).toBe(true)
    expect(await pathExists(join(userDataBox.current, 'Profile.cfg'))).toBe(false)
    expect(await pathExists(join(dir, 'baseq2', 'Profile.cfg'))).toBe(false)

    // ...and the save that follows writes the NEW rendering to both places.
    await handlers.get(CONFIG_HANDLERS.save)!({ profileId: 'p1' })
    const expected = renderProfileFile(updated)
    expect(await readFile(join(userDataBox.current, 'Profile.cfg'), 'latin1')).toBe(expected)
    expect(await readFile(join(dir, 'baseq2', 'Profile.cfg'), 'latin1')).toBe(expected)
  })

  it('syncState reports inSync for both copies right after a save synced them', async () => {
    const inst = installation()
    const { handlers, state } = await boot({ installations: [inst] })
    state.setConfigProfiles([profile()])
    await state.settle()
    await handlers.get(CONFIG_HANDLERS.setCvars)!({ profileId: 'p1', cvars: { sensitivity: '7' } })
    // Story 043 D4: the mutation alone no longer syncs anything - the save does.
    await handlers.get(CONFIG_HANDLERS.save)!({ profileId: 'p1' })

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
 * Story 043 D4: the deliberate inversion of story 022 decision 8 - content mutations stop writing
 * and only `save` does, after re-reading the file it is about to overwrite.
 *
 * The two failure modes this block exists to catch are the ones the story names: a hand-edit
 * clobbered by a write the launcher made without reading the file first, and unsaved edits leaking
 * onto disk (into an installation, which the engine actually loads) through some *other* handler's
 * sync run. Everything is asserted on the real temp-dir bytes, never on the handler's return value
 * alone - a report of a write that did not happen, or of a skip that actually wrote, would look
 * identical from the outside.
 */
describe('story 043 D4: explicit save', () => {
  async function boot(
    installations: Installation[] = [],
    seed?: (state: StateStore) => void,
  ): Promise<{ handlers: Map<string, ModuleHandler>; state: StateStore }> {
    const state = new StateStore(join(dir, 'state.json'))
    await state.load()
    seed?.(state)
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

  const canonicalPath = (fileName: string): string => join(userDataBox.current, fileName)
  const copyPath = (fileName: string): string => join(dir, 'baseq2', fileName)

  async function save(
    handlers: Map<string, ModuleHandler>,
    profileId = 'p1',
  ): Promise<Outcome<SaveProfileResult>> {
    return (await handlers.get(CONFIG_HANDLERS.save)!({ profileId })) as Outcome<SaveProfileResult>
  }

  function only(state: StateStore, profileId = 'p1'): ConfigProfile {
    return state.configProfiles().find((p) => p.id === profileId)!
  }

  it('writes the canonical file and the installation copy, clears dirty and seeds the hash baseline', async () => {
    const inst = installation()
    const { handlers, state } = await boot([inst])
    state.setConfigProfiles([profile()])
    await state.settle()
    await handlers.get(CONFIG_HANDLERS.setCvars)!({ profileId: 'p1', cvars: { sensitivity: '7' } })

    const result = await save(handlers)

    if (!result.ok) throw new Error('expected save to succeed')
    if (result.value.status !== 'saved') throw new Error(`expected saved, got ${result.value.status}`)
    const expected = renderProfileFile(result.value.profile)
    expect(await readFile(canonicalPath('Profile.cfg'), 'latin1')).toBe(expected)
    // The installation cascade is unchanged by this deliverable - it still runs, from the same
    // canonical content (story AC6).
    expect(await readFile(copyPath('Profile.cfg'), 'latin1')).toBe(expected)
    expect(result.value.sync.own.status).toBe('inSync')

    const saved = only(state)
    expect(saved.dirty).toBe(false)
    // Seeded from exactly the bytes on disk, which is what keeps this write from being read back as
    // an external edit by the very next save.
    expect(saved.fileHash).toBe(hashCanonicalFileContent(expected))
    expect(saved.fileSeenAt).toBeTypeOf('number')

    // Proof of that property: an immediate second save sees `unchanged`, not a conflict.
    const again = await save(handlers)
    if (!again.ok) throw new Error('expected the second save to succeed')
    expect(again.value.status).toBe('saved')
  })

  it('refuses to write and reports a whole-file conflict when the file changed underneath', async () => {
    const inst = installation()
    const { handlers, state } = await boot([inst])
    state.setConfigProfiles([profile()])
    await state.settle()
    await save(handlers)
    const seededHash = only(state).fileHash

    // A hand-edit in Notepad: the launcher's own file, one line appended.
    const handEdited = `${await readFile(canonicalPath('Profile.cfg'), 'latin1')}// hand-edited\n`
    await writeFile(canonicalPath('Profile.cfg'), handEdited, 'latin1')
    await handlers.get(CONFIG_HANDLERS.setCvars)!({ profileId: 'p1', cvars: { sensitivity: '9' } })

    const result = await save(handlers)

    if (!result.ok) throw new Error('expected save to answer, not fail')
    if (result.value.status !== 'conflict') {
      throw new Error(`expected conflict, got ${result.value.status}`)
    }
    expect(result.value.fileName).toBe('Profile.cfg')
    expect(result.value.diskContent).toBe(handEdited)
    expect(result.value.ourContent).toBe(renderProfileFile(only(state)))
    expect(result.value.ourContent).not.toBe(handEdited)
    // The whole point: nothing was written, and the edits are still recorded as unsaved.
    expect(await readFile(canonicalPath('Profile.cfg'), 'latin1')).toBe(handEdited)
    expect(only(state).dirty).toBe(true)
    expect(only(state).fileHash).toBe(seededHash)
  })

  it('story 043 D8: force: true bypasses the conflict, writes our version and clears dirty', async () => {
    const inst = installation()
    const { handlers, state } = await boot([inst])
    state.setConfigProfiles([profile()])
    await state.settle()
    await save(handlers)

    // A hand-edit in Notepad, plus an unsaved UI edit - the exact conflict shape `save` (without
    // `force`) still refuses, and the shape `ConfigConflictDialog` is built from.
    const handEdited = `${await readFile(canonicalPath('Profile.cfg'), 'latin1')}// hand-edited\n`
    await writeFile(canonicalPath('Profile.cfg'), handEdited, 'latin1')
    await handlers.get(CONFIG_HANDLERS.setCvars)!({ profileId: 'p1', cvars: { sensitivity: '9' } })

    const ordinary = await save(handlers)
    if (!ordinary.ok || ordinary.value.status !== 'conflict') {
      throw new Error('expected the ordinary save to still refuse')
    }

    const forced = (await handlers.get(CONFIG_HANDLERS.save)!({
      profileId: 'p1',
      force: true,
    })) as Outcome<SaveProfileResult>

    if (!forced.ok) throw new Error('expected the forced save to succeed')
    if (forced.value.status !== 'saved') {
      throw new Error(`expected saved, got ${forced.value.status}`)
    }
    const expected = renderProfileFile(forced.value.profile)
    expect(expected).not.toBe(handEdited)
    expect(await readFile(canonicalPath('Profile.cfg'), 'latin1')).toBe(expected)
    expect(only(state).dirty).toBe(false)
    expect(only(state).fileHash).toBe(hashCanonicalFileContent(expected))
  })

  it('looks the file up by its ownership sentinel, so a rename cannot make a hand-edit invisible', async () => {
    const { handlers, state } = await boot()
    state.setConfigProfiles([profile({ assignments: [] })])
    await state.settle()
    await save(handlers)

    // A rename no longer moves the file, so the profile's file still sits under its OLD name -
    // exactly where a naive "read the name this profile now resolves to" check would find nothing
    // and conclude it was free to write.
    await handlers.get(CONFIG_HANDLERS.rename)!({ id: 'p1', name: 'Renamed' })
    const handEdited = `${await readFile(canonicalPath('Profile.cfg'), 'latin1')}// hand-edited\n`
    await writeFile(canonicalPath('Profile.cfg'), handEdited, 'latin1')

    const result = await save(handlers)

    if (!result.ok) throw new Error('expected save to answer, not fail')
    if (result.value.status !== 'conflict') {
      throw new Error(`expected conflict, got ${result.value.status}`)
    }
    expect(result.value.fileName).toBe('Profile.cfg')
    expect(await readFile(canonicalPath('Profile.cfg'), 'latin1')).toBe(handEdited)
    expect(await pathExists(canonicalPath('Renamed.cfg'))).toBe(false)
  })

  it('saving a renamed profile with nothing changed on disk moves the file to its new name', async () => {
    const { handlers, state } = await boot()
    state.setConfigProfiles([profile({ assignments: [] })])
    await state.settle()
    await save(handlers)
    await handlers.get(CONFIG_HANDLERS.rename)!({ id: 'p1', name: 'Renamed' })

    const result = await save(handlers)

    if (!result.ok) throw new Error('expected save to succeed')
    if (result.value.status !== 'saved') throw new Error(`expected saved, got ${result.value.status}`)
    expect(await readFile(canonicalPath('Renamed.cfg'), 'latin1')).toBe(
      renderProfileFile(result.value.profile),
    )
    expect(await pathExists(canonicalPath('Profile.cfg'))).toBe(false)
    expect(only(state).dirty).toBe(false)
  })

  it('reports a file it cannot read at all instead of writing over it', async () => {
    const { handlers, state } = await boot()
    state.setConfigProfiles([profile({ assignments: [] })])
    await state.settle()
    // A directory where the canonical file should be: unreadable, and specifically NOT ENOENT - so
    // it must not be treated as "nothing there, free to create".
    await mkdir(canonicalPath('Profile.cfg'), { recursive: true })

    const result = await save(handlers)

    if (!result.ok) throw new Error('expected save to answer, not fail')
    expect(result.value.status).toBe('unreadable')
    if (result.value.status !== 'unreadable') return
    expect(result.value.reason).toBe('readError')
  })

  it('assign of a DIRTY profile writes the installation from the canonical FILE, never from the unsaved edits', async () => {
    const inst = installation()
    const { handlers, state } = await boot([inst])
    state.setConfigProfiles([profile({ assignments: [] })])
    await state.settle()
    await save(handlers)
    const savedFile = await readFile(canonicalPath('Profile.cfg'), 'latin1')

    // Unsaved edit, then an operation that is NOT a save but does sync (assignment relationships
    // are not profile content, so it still syncs immediately - story decision).
    await handlers.get(CONFIG_HANDLERS.setCvars)!({ profileId: 'p1', cvars: { sensitivity: '99' } })
    const unsavedRender = renderProfileFile(only(state))
    expect(unsavedRender).not.toBe(savedFile)

    const assigned = (await handlers.get(CONFIG_HANDLERS.assign)!({
      profileId: 'p1',
      installationId: 'i1',
    })) as Outcome<ConfigProfile[]>
    if (!assigned.ok) throw new Error('expected assign to succeed')

    // The canonical file is untouched...
    expect(await readFile(canonicalPath('Profile.cfg'), 'latin1')).toBe(savedFile)
    // ...and the installation - the copy the engine actually loads - got the FILE's content, not
    // the unsaved edit. This is the specific leak D4 exists to close.
    expect(await readFile(copyPath('Profile.cfg'), 'latin1')).toBe(savedFile)
    expect(await readFile(copyPath('Profile.cfg'), 'latin1')).not.toBe(unsavedRender)
    expect(only(state).dirty).toBe(true)
    // The loader still went out, so the installation is usable.
    expect(await pathExists(copyPath('autoexec.cfg'))).toBe(true)
  })

  it('the retry trigger `write` publishes the canonical file too, not a dirty profile\'s unsaved edits', async () => {
    const inst = installation()
    const { handlers, state } = await boot([inst])
    state.setConfigProfiles([profile()])
    await state.settle()
    await save(handlers)
    const savedFile = await readFile(canonicalPath('Profile.cfg'), 'latin1')
    await handlers.get(CONFIG_HANDLERS.setCvars)!({ profileId: 'p1', cvars: { sensitivity: '99' } })
    // Delete the installation copy so the retry has something real to do.
    await rm(copyPath('Profile.cfg'))

    const result = (await handlers.get(CONFIG_HANDLERS.write)!({
      profileId: 'p1',
    })) as Outcome<WriteTargetResult[]>

    if (!result.ok) throw new Error('expected write to succeed')
    expect(await readFile(canonicalPath('Profile.cfg'), 'latin1')).toBe(savedFile)
    expect(await readFile(copyPath('Profile.cfg'), 'latin1')).toBe(savedFile)
    expect(only(state).dirty).toBe(true)
  })

  it('is per profile: syncing a clean profile does not publish a DIRTY sibling assigned to the same installation', async () => {
    const inst = installation()
    const { handlers, state } = await boot([inst])
    state.setConfigProfiles([
      profile({ id: 'p1', name: 'One' }),
      profile({ id: 'p2', name: 'Two', assignments: [{ installationId: 'i1', isDefault: false }] }),
    ])
    await state.settle()
    await save(handlers, 'p1')
    await save(handlers, 'p2')
    const siblingFile = await readFile(canonicalPath('Two.cfg'), 'latin1')

    // The sibling has unsaved edits; the OTHER profile is the one being synced.
    await handlers.get(CONFIG_HANDLERS.setCvars)!({ profileId: 'p2', cvars: { sensitivity: '99' } })
    const siblingUnsaved = renderProfileFile(state.configProfiles().find((p) => p.id === 'p2')!)
    await handlers.get(CONFIG_HANDLERS.setDefault)!({ profileId: 'p1', installationId: 'i1' })

    // `syncOneProfile` writes EVERY profile assigned to the installation, so the sibling's copy was
    // rewritten by this run - from its canonical file, not from its unsaved state.
    expect(await readFile(canonicalPath('Two.cfg'), 'latin1')).toBe(siblingFile)
    expect(await readFile(copyPath('Two.cfg'), 'latin1')).toBe(siblingFile)
    expect(await readFile(copyPath('Two.cfg'), 'latin1')).not.toBe(siblingUnsaved)
    expect(state.configProfiles().find((p) => p.id === 'p2')!.dirty).toBe(true)
  })

  it('assign still syncs a NON-dirty profile immediately, exactly as before', async () => {
    const inst = installation()
    const { handlers, state } = await boot([inst])
    state.setConfigProfiles([profile({ assignments: [] })])
    await state.settle()
    await save(handlers)

    const assigned = (await handlers.get(CONFIG_HANDLERS.assign)!({
      profileId: 'p1',
      installationId: 'i1',
    })) as Outcome<ConfigProfile[]>

    if (!assigned.ok) throw new Error('expected assign to succeed')
    const expected = renderProfileFile(only(state))
    expect(await readFile(canonicalPath('Profile.cfg'), 'latin1')).toBe(expected)
    expect(await readFile(copyPath('Profile.cfg'), 'latin1')).toBe(expected)
    expect(only(state).dirty).toBe(false)
  })

  it('syncState and rawFiles judge a dirty profile\'s installation copy against the FILE, so a retry can still clear it', async () => {
    const inst = installation()
    const { handlers, state } = await boot([inst])
    state.setConfigProfiles([profile()])
    await state.settle()
    await save(handlers)
    await handlers.get(CONFIG_HANDLERS.setCvars)!({ profileId: 'p1', cvars: { sensitivity: '99' } })

    // The unsaved edits live on the canonical row (the file does not say what the profile says)...
    const dirtyState = (await handlers.get(CONFIG_HANDLERS.syncState)!({
      profileId: 'p1',
    })) as Outcome<ProfileSyncState>
    if (!dirtyState.ok) throw new Error('expected syncState to succeed')
    expect(dirtyState.value.own.status).toBe('outOfSync')
    // ...while the installation copy holds exactly what the canonical file authorises, and says so -
    // the same answer the sync run that wrote it gave, and a state a Retry can actually reach.
    expect(dirtyState.value.installations[0]!.status).toBe('inSync')

    const raw = (await handlers.get(CONFIG_HANDLERS.rawFiles)!({
      profileId: 'p1',
    })) as Outcome<RawFilesResult>
    if (!raw.ok) throw new Error('expected rawFiles to succeed')
    expect(raw.value.installations[0]!.matches).toBe(true)

    // A hand-edited installation copy is still reported out of sync, exactly as before.
    await writeFile(copyPath('Profile.cfg'), 'hand-edited\n', 'latin1')
    const edited = (await handlers.get(CONFIG_HANDLERS.syncState)!({
      profileId: 'p1',
    })) as Outcome<ProfileSyncState>
    if (!edited.ok) throw new Error('expected syncState to succeed')
    expect(edited.value.installations[0]!.status).toBe('outOfSync')

    // ...and the retry trigger fixes it without publishing the unsaved edits.
    await handlers.get(CONFIG_HANDLERS.write)!({ profileId: 'p1' })
    const retried = (await handlers.get(CONFIG_HANDLERS.syncState)!({
      profileId: 'p1',
    })) as Outcome<ProfileSyncState>
    if (!retried.ok) throw new Error('expected syncState to succeed')
    expect(retried.value.installations[0]!.status).toBe('inSync')
    expect(await readFile(copyPath('Profile.cfg'), 'latin1')).toBe(
      await readFile(canonicalPath('Profile.cfg'), 'latin1'),
    )
  })

  it('save fails with profileNotFound for an unknown id and writes nothing', async () => {
    const { handlers, state } = await boot()
    state.setConfigProfiles([profile({ assignments: [] })])
    await state.settle()

    const result = await save(handlers, 'nope')

    expect(result).toEqual({ ok: false, error: { key: 'config.error.profileNotFound' } })
    expect(await pathExists(canonicalPath('Profile.cfg'))).toBe(false)
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

  it('reports canonical onDisk: false for a freshly created, unassigned profile, then true after an explicit save', async () => {
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
    // Story 043 D4: only a save puts the file on disk now.
    await handlers.get(CONFIG_HANDLERS.save)!({ profileId: 'p1' })

    const after = (await handlers.get(CONFIG_HANDLERS.rawFiles)!({
      profileId: 'p1',
    })) as Outcome<RawFilesResult>
    if (!after.ok) throw new Error('expected rawFiles to succeed')
    expect(after.value.canonical.onDisk).toBe(true)
    const updated = (await handlers.get(CONFIG_HANDLERS.list)!(undefined)) as ConfigProfile[]
    expect(after.value.canonical.content).toBe(renderProfileFile(updated.find((p) => p.id === 'p1')!))
  })

  it('reports matches: true right after a save, and false once the on-disk copy is edited independently', async () => {
    const inst = installation()
    const { handlers, state } = await boot([inst])
    state.setConfigProfiles([profile()])
    await state.settle()
    await handlers.get(CONFIG_HANDLERS.setCvars)!({ profileId: 'p1', cvars: { sensitivity: '9' } })
    await handlers.get(CONFIG_HANDLERS.save)!({ profileId: 'p1' })

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

  /**
   * Boots, seeds one profile and saves it, so its files are really on disk. Story 043 D4: it is the
   * save that writes now, not the `setCvars` that used to stand in for one here.
   */
  async function bootSynced(
    installations: Installation[] = [],
    seeded: ConfigProfile = profile({ assignments: [] }),
  ): Promise<Map<string, ModuleHandler>> {
    const { handlers, state } = await boot(installations)
    state.setConfigProfiles([seeded])
    await state.settle()
    await handlers.get(CONFIG_HANDLERS.setCvars)!({ profileId: seeded.id, cvars: { sensitivity: '9' } })
    await handlers.get(CONFIG_HANDLERS.save)!({ profileId: seeded.id })
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
    // Two commits, not one, since story 043 D4: the batch itself is still exactly ONE content
    // commit (the `updatedAt` assertions right above are what that means), and the second is the
    // sync run seeding the profile's `fileHash` baseline from the bytes it just confirmed on disk -
    // bookkeeping about the file, which bumps no timestamp and changes no profile content.
    expect(commits()).toBe(2)

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

/**
 * Story 043 D5: `refreshFromFiles` - the re-read side of the story's "re-read on window focus, tab
 * open, and before write" decision. Same duck-typed `app` + real temp-file-backed `StateStore` boot
 * as the sections above.
 */
describe('CONFIG_HANDLERS.refreshFromFiles handler (story 043 D5)', () => {
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

  async function refresh(
    handlers: Map<string, ModuleHandler>,
    profileId?: string,
  ): Promise<Outcome<RefreshFromFilesResult>> {
    return (await handlers.get(CONFIG_HANDLERS.refreshFromFiles)!(
      profileId === undefined ? {} : { profileId },
    )) as Outcome<RefreshFromFilesResult>
  }

  it('reports unchanged and leaves state.json untouched when the file matches the cached hash', async () => {
    const { handlers, state } = await boot()
    state.setConfigProfiles([profile({ assignments: [] })])
    await state.settle()
    await handlers.get(CONFIG_HANDLERS.save)!({ profileId: 'p1' })
    const before = state.configProfiles()[0]!

    const result = await refresh(handlers, 'p1')

    if (!result.ok) throw new Error('expected refreshFromFiles to succeed')
    expect(result.value).toEqual([{ profileId: 'p1', outcome: 'unchanged', fileState: 'unchanged' }])
    // Nothing in state.json changed - not even a re-stamped `fileSeenAt`.
    expect(state.configProfiles()[0]).toEqual(before)
  })

  it('adopts a hand-edit (cvar value and header display name) when the profile carries no unsaved edits', async () => {
    const { handlers, state } = await boot()
    state.setConfigProfiles([profile({ assignments: [] })])
    await state.settle()
    await handlers.get(CONFIG_HANDLERS.save)!({ profileId: 'p1' })
    const path = join(userDataBox.current, 'Profile.cfg')
    const onDisk = await readFile(path, 'latin1')

    // Hand-edit: bump the cvar value and change the header's display-name comment - the exact
    // scenario the acceptance line names ("changes a cvar value or display-name comment").
    const edited = onDisk
      .replace(/sensitivity(\s*)"3"/, 'sensitivity$1"5"')
      .replace('Profile', 'Hand-Edited')
    expect(edited).not.toBe(onDisk)
    await writeFile(path, edited, 'latin1')
    const newHash = hashCanonicalFileContent(edited)

    const result = await refresh(handlers, 'p1')

    if (!result.ok) throw new Error('expected refreshFromFiles to succeed')
    expect(result.value).toHaveLength(1)
    const entry = result.value[0]!
    if (entry.outcome !== 'adopted') throw new Error(`expected adopted, got ${entry.outcome}`)
    expect(entry.profile.id).toBe('p1')
    expect(entry.profile.assignments).toEqual([])
    expect(entry.profile.cvars['sensitivity']).toBe('5')
    expect(entry.profile.name).toBe('Hand-Edited')
    expect(entry.profile.fileHash).toBe(newHash)

    // The store itself was updated, not just the response.
    const stored = state.configProfiles()[0]!
    expect(stored.id).toBe('p1')
    expect(stored.assignments).toEqual([])
    expect(stored.cvars['sensitivity']).toBe('5')
    expect(stored.name).toBe('Hand-Edited')
    expect(stored.fileHash).toBe(newHash)
    expect(stored.dirty).toBe(false)
    expect(stored.fileState).toBe('unchanged')
  })

  it('reports a conflict and adopts nothing when the file changed on disk while the profile carries unsaved edits', async () => {
    const { handlers, state } = await boot()
    state.setConfigProfiles([profile({ assignments: [] })])
    await state.settle()
    await handlers.get(CONFIG_HANDLERS.save)!({ profileId: 'p1' })
    // An unsaved UI edit - marks the profile dirty without writing the file.
    await handlers.get(CONFIG_HANDLERS.setCvars)!({ profileId: 'p1', cvars: { sensitivity: '7' } })
    const before = state.configProfiles()[0]!
    expect(before.dirty).toBe(true)

    const path = join(userDataBox.current, 'Profile.cfg')
    const onDisk = await readFile(path, 'latin1')
    const edited = onDisk.replace(/sensitivity(\s*)"3"/, 'sensitivity$1"9"')
    expect(edited).not.toBe(onDisk)
    await writeFile(path, edited, 'latin1')

    const result = await refresh(handlers, 'p1')

    if (!result.ok) throw new Error('expected refreshFromFiles to succeed')
    expect(result.value).toHaveLength(1)
    const entry = result.value[0]!
    if (entry.outcome !== 'conflict') throw new Error(`expected conflict, got ${entry.outcome}`)
    expect(entry.conflict.status).toBe('conflict')
    expect(entry.conflict.fileName).toBe('Profile.cfg')
    expect(entry.conflict.diskContent).toBe(edited)
    expect(entry.conflict.ourContent).toBe(renderProfileFile(before))

    // Nothing about the cached profile was touched - byte-identical to before the call.
    expect(state.configProfiles()[0]).toEqual(before)
  })

  it('story 043 D8: discardLocalEdits: true adopts the disk version even though the profile is dirty', async () => {
    const { handlers, state } = await boot()
    state.setConfigProfiles([profile({ assignments: [] })])
    await state.settle()
    await handlers.get(CONFIG_HANDLERS.save)!({ profileId: 'p1' })
    // An unsaved UI edit - marks the profile dirty without writing the file.
    await handlers.get(CONFIG_HANDLERS.setCvars)!({ profileId: 'p1', cvars: { sensitivity: '7' } })

    const path = join(userDataBox.current, 'Profile.cfg')
    const onDisk = await readFile(path, 'latin1')
    const edited = onDisk.replace(/sensitivity(\s*)"3"/, 'sensitivity$1"9"')
    expect(edited).not.toBe(onDisk)
    await writeFile(path, edited, 'latin1')
    const newHash = hashCanonicalFileContent(edited)

    const result = (await handlers.get(CONFIG_HANDLERS.refreshFromFiles)!({
      profileId: 'p1',
      discardLocalEdits: true,
    })) as Outcome<RefreshFromFilesResult>

    if (!result.ok) throw new Error('expected refreshFromFiles to succeed')
    expect(result.value).toHaveLength(1)
    const entry = result.value[0]!
    if (entry.outcome !== 'adopted') throw new Error(`expected adopted, got ${entry.outcome}`)
    // The disk version won, not the discarded unsaved edit (sensitivity 7).
    expect(entry.profile.cvars['sensitivity']).toBe('9')
    expect(entry.profile.fileHash).toBe(newHash)

    // The store itself reflects the discard: no longer dirty, disk content adopted.
    const stored = state.configProfiles()[0]!
    expect(stored.dirty).toBe(false)
    expect(stored.cvars['sensitivity']).toBe('9')
    expect(stored.fileHash).toBe(newHash)
  })

  it('sets fileState: missing and never deletes the record when the file is gone', async () => {
    const { handlers, state } = await boot()
    state.setConfigProfiles([profile({ assignments: [] })])
    await state.settle()
    await handlers.get(CONFIG_HANDLERS.save)!({ profileId: 'p1' })
    const before = state.configProfiles()[0]!
    await rm(join(userDataBox.current, 'Profile.cfg'))

    const result = await refresh(handlers, 'p1')

    if (!result.ok) throw new Error('expected refreshFromFiles to succeed')
    expect(result.value).toEqual([{ profileId: 'p1', outcome: 'missing', fileState: 'missing' }])

    const stored = state.configProfiles()[0]!
    expect(stored.id).toBe('p1')
    expect(stored.fileState).toBe('missing')
    // Untouched: neither dirty nor the hash baseline are disturbed by a missing file.
    expect(stored.dirty).toBe(before.dirty)
    expect(stored.fileHash).toBe(before.fileHash)
    expect(stored.cvars).toEqual(before.cvars)
  })

  it('reports the unparseable diagnostic and leaves the cached profile fully usable', async () => {
    const { handlers, state } = await boot()
    state.setConfigProfiles([profile({ assignments: [] })])
    await state.settle()
    await handlers.get(CONFIG_HANDLERS.save)!({ profileId: 'p1' })
    const before = state.configProfiles()[0]!

    vi.mocked(readFileState).mockResolvedValueOnce({
      state: 'unparseable',
      file: 'Profile.cfg',
      line: 42,
      message: 'contrived parse failure for this test',
    })

    const result = await refresh(handlers, 'p1')

    if (!result.ok) throw new Error('expected refreshFromFiles to succeed')
    expect(result.value).toEqual([
      {
        profileId: 'p1',
        outcome: 'unparseable',
        fileState: 'unparseable',
        file: 'Profile.cfg',
        line: 42,
        message: 'contrived parse failure for this test',
      },
    ])

    // The last good cache stays exactly as usable as it was: same content, still listed, still
    // renderable - only the display hint changed.
    const stored = state.configProfiles()[0]!
    expect(stored.cvars).toEqual(before.cvars)
    expect(stored.dirty).toBe(before.dirty)
    expect(stored.fileHash).toBe(before.fileHash)
    expect(stored.fileState).toBe('unparseable')
    expect(() => renderProfileFile(stored)).not.toThrow()
    const list = (await handlers.get(CONFIG_HANDLERS.list)!(undefined)) as ConfigProfile[]
    expect(list.map((p) => p.id)).toEqual(['p1'])
  })

  it('reports readError conservatively, touching nothing about the cached profile but the hint', async () => {
    const { handlers, state } = await boot()
    state.setConfigProfiles([profile({ assignments: [] })])
    await state.settle()
    await handlers.get(CONFIG_HANDLERS.save)!({ profileId: 'p1' })
    const before = state.configProfiles()[0]!

    vi.mocked(readFileState).mockResolvedValueOnce({
      state: 'readError',
      error: new Error('EACCES (contrived for this test)'),
    })

    const result = await refresh(handlers, 'p1')

    if (!result.ok) throw new Error('expected refreshFromFiles to succeed')
    expect(result.value).toEqual([
      {
        profileId: 'p1',
        outcome: 'readError',
        fileState: 'readError',
        message: 'EACCES (contrived for this test)',
      },
    ])
    const stored = state.configProfiles()[0]!
    expect(stored.cvars).toEqual(before.cvars)
    expect(stored.dirty).toBe(before.dirty)
    expect(stored.fileHash).toBe(before.fileHash)
    expect(stored.fileState).toBe('readError')
  })

  it('checks only the given profile when profileId is passed, and every profile when it is omitted', async () => {
    const { handlers, state } = await boot()
    state.setConfigProfiles([
      profile({ id: 'p1', name: 'One', assignments: [] }),
      profile({ id: 'p2', name: 'Two', cvars: { sensitivity: '4' }, assignments: [] }),
    ])
    await state.settle()
    await handlers.get(CONFIG_HANDLERS.save)!({ profileId: 'p1' })
    await handlers.get(CONFIG_HANDLERS.save)!({ profileId: 'p2' })

    const scoped = await refresh(handlers, 'p1')
    if (!scoped.ok) throw new Error('expected refreshFromFiles to succeed')
    expect(scoped.value.map((r) => r.profileId)).toEqual(['p1'])

    const all = await refresh(handlers)
    if (!all.ok) throw new Error('expected refreshFromFiles to succeed')
    expect(all.value.map((r) => r.profileId).sort()).toEqual(['p1', 'p2'])
    expect(all.value.every((r) => r.outcome === 'unchanged')).toBe(true)
  })

  it('fails with config.error.profileNotFound for an unknown profile id', async () => {
    const { handlers } = await boot()

    const result = await refresh(handlers, 'nope')

    expect(result).toEqual({ ok: false, error: { key: 'config.error.profileNotFound' } })
  })
})
