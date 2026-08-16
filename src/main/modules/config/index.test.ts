import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ConfigProfile } from '@shared/modules/config'
import type { Installation, LaunchState } from '@shared/types'
import { scopedLogger } from '../../lib/logger'
import {
  previewProfileFiles,
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

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'q2-launcher-config-index-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
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
    const content = await readFile(join(dir, 'baseq2', 'q2l-profile-p1.cfg'), 'latin1')
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
    const content = await readFile(join(dir, 'baseq2', 'q2l-profile-p1.cfg'), 'latin1')
    expect(content).toContain('set sensitivity "3"')
  })

  it("also writes the installation's default profile file when saving a different, non-default profile, so the loader's exec target always exists (F1)", async () => {
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
    const ownFile = await readFile(join(dir, 'baseq2', 'q2l-profile-p1.cfg'), 'latin1')
    expect(ownFile).toContain('set sensitivity "5"')
    // ...and so does the default's own file, which is what the loader execs.
    const defaultFile = await readFile(join(dir, 'baseq2', 'q2l-profile-p-default.cfg'), 'latin1')
    expect(defaultFile).toContain('set crosshair "1"')
    const loader = await readFile(join(dir, 'baseq2', 'autoexec.cfg'), 'latin1')
    expect(loader).toContain('exec q2l-profile-p-default.cfg')
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
    expect(loader).toContain('exec q2l-profile-p-duel.cfg')
    expect(loader).toContain('exec q2l-profile-p-ctf.cfg')
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
    const other = profile({
      id: 'p-default',
      cvars: {},
      assignments: [{ installationId: 'i1', isDefault: true }],
    })
    const p = profile({ id: 'p1', assignments: [{ installationId: 'i1', isDefault: false }] })
    const inst = installation()

    const [, , loader] = previewProfileFiles(p, [p, other], inst)

    expect(loader!.content).toContain('p-default')
    expect(loader!.content).not.toContain('exec q2l-profile-p1.cfg')
  })

  it("also includes the default profile's own file when previewing a different, non-default profile (F1)", () => {
    const defaultProfile = profile({
      id: 'p-default',
      cvars: { crosshair: '1' },
      assignments: [{ installationId: 'i1', isDefault: true }],
    })
    const p = profile({ id: 'p1', assignments: [{ installationId: 'i1', isDefault: false }] })
    const inst = installation()

    const files = previewProfileFiles(p, [defaultProfile, p], inst)

    expect(files.map((f) => f.path.split(/[/\\]/).pop())).toEqual([
      'q2l-profile-p-default.cfg',
      'q2l-profile-p1.cfg',
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

  it('story 007: omits the chain when no switchBindKey is given (today\'s default)', () => {
    const p = profile()
    const inst = installation()

    const files = previewProfileFiles(p, [p], inst)
    const loader = files.find((f) => f.path.endsWith('autoexec.cfg'))

    expect(loader!.content).not.toContain('q2l_switch')
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
