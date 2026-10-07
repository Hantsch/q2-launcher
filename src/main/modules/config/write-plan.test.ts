import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConfigProfile } from '@shared/modules/config'
import type { LaunchState } from '@shared/types'
import {
  idleState,
  installation,
  installConfigTestDir,
  log,
  profile as seededProfile,
  userDataBox,
} from './index.test-helpers'
import { syncProfile } from './sync'
import {
  assignedProfilesFor,
  defaultProfileFor,
  isInstallationRunning,
  previewProfileFiles,
  validatePlayedMods,
} from './write-plan'

vi.mock('electron', async () => {
  const h = await import('./index.test-helpers')
  return { app: { getPath: () => h.userDataBox.current }, shell: h.shellMock }
})

const getDir = installConfigTestDir()
let dir: string
beforeEach(() => {
  dir = getDir()
})

function profile(overrides: Partial<ConfigProfile> = {}): ConfigProfile {
  return {
    id: 'p1',
    name: 'Profile',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    cvars: {},
    binds: {},
    assignments: [],
    ...overrides,
  }
}

describe('defaultProfileFor', () => {
  it('finds the profile whose assignment is the default for the given installation', () => {
    const profiles = [
      profile({ id: 'p1', assignments: [{ installationId: 'i1', isDefault: false }] }),
      profile({ id: 'p2', assignments: [{ installationId: 'i1', isDefault: true }] }),
      profile({ id: 'p3', assignments: [{ installationId: 'i2', isDefault: true }] }),
    ]

    expect(defaultProfileFor(profiles, 'i1')?.id).toBe('p2')
    expect(defaultProfileFor(profiles, 'i2')?.id).toBe('p3')
  })

  it('returns null when no profile has a default assignment for the installation', () => {
    const profiles = [
      profile({ id: 'p1', assignments: [{ installationId: 'i1', isDefault: false }] }),
      profile({ id: 'p2', assignments: [] }),
    ]

    expect(defaultProfileFor(profiles, 'i1')).toBeNull()
    expect(defaultProfileFor([], 'i1')).toBeNull()
  })
})

describe('assignedProfilesFor', () => {
  it('filters to only profiles assigned to the given installation, preserving list order', () => {
    const profiles = [
      profile({ id: 'p1', name: 'One', assignments: [{ installationId: 'i1', isDefault: true }] }),
      profile({ id: 'p2', name: 'Two', assignments: [{ installationId: 'i2', isDefault: true }] }),
      profile({
        id: 'p3',
        name: 'Three',
        assignments: [{ installationId: 'i1', isDefault: false }],
      }),
    ]

    expect(assignedProfilesFor(profiles, 'i1')).toEqual([
      { id: 'p1', name: 'One' },
      { id: 'p3', name: 'Three' },
    ])
  })

  it('returns an empty array when the installation has no assignments', () => {
    const profiles = [
      profile({ id: 'p1', assignments: [{ installationId: 'i2', isDefault: true }] }),
    ]

    expect(assignedProfilesFor(profiles, 'i1')).toEqual([])
  })

  it('returns {id, name} shape only, dropping cvars/binds/assignments', () => {
    const profiles = [
      profile({
        id: 'p1',
        name: 'One',
        cvars: { sensitivity: '3' },
        assignments: [{ installationId: 'i1', isDefault: true }],
      }),
    ]

    expect(assignedProfilesFor(profiles, 'i1')).toEqual([{ id: 'p1', name: 'One' }])
  })
})

function launchState(overrides: Partial<LaunchState> = {}): LaunchState {
  return { phase: 'idle', installationId: null, ...overrides }
}

describe('isInstallationRunning', () => {
  it('is true for the matching installation while starting or running', () => {
    expect(
      isInstallationRunning(launchState({ phase: 'starting', installationId: 'i1' }), 'i1'),
    ).toBe(true)
    expect(
      isInstallationRunning(launchState({ phase: 'running', installationId: 'i1' }), 'i1'),
    ).toBe(true)
  })

  it('is false for exited, failed or idle phases', () => {
    expect(
      isInstallationRunning(launchState({ phase: 'exited', installationId: 'i1' }), 'i1'),
    ).toBe(false)
    expect(
      isInstallationRunning(launchState({ phase: 'failed', installationId: 'i1' }), 'i1'),
    ).toBe(false)
    expect(isInstallationRunning(launchState({ phase: 'idle', installationId: null }), 'i1')).toBe(
      false,
    )
  })

  it('is false when a different installation is running', () => {
    expect(
      isInstallationRunning(launchState({ phase: 'running', installationId: 'i2' }), 'i1'),
    ).toBe(false)
  })
})

describe('previewProfileFiles', () => {
  it('matches exactly what a write under the same conditions produces', async () => {
    const inst = installation()
    const p = seededProfile()

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
    const other = seededProfile({
      id: 'p-default',
      name: 'Default',
      cvars: {},
      assignments: [{ installationId: 'i1', isDefault: true }],
    })
    const p = seededProfile({ id: 'p1', assignments: [{ installationId: 'i1', isDefault: false }] })
    const inst = installation()

    const [, , loader] = previewProfileFiles(p, [p, other], inst)

    expect(loader!.content).toContain('p-default')
    expect(loader!.content).not.toContain('exec Profile.cfg')
  })

  it("also includes the default profile's own file when previewing a different, non-default profile (F1)", () => {
    // Named distinctly from `p` below so the two never collide under
    // `resolveProfileFileNames`.
    const defaultProfile = seededProfile({
      id: 'p-default',
      name: 'Default',
      // Not the catalogue default, for the same reason as the F1 write test above.
      cvars: { crosshair: '3' },
      assignments: [{ installationId: 'i1', isDefault: true }],
    })
    const p = seededProfile({ id: 'p1', assignments: [{ installationId: 'i1', isDefault: false }] })
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
    const duel = seededProfile({
      id: 'p-duel',
      name: 'Duel',
      assignments: [{ installationId: 'i1', isDefault: true }],
    })
    const ctf = seededProfile({
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
    const p = seededProfile()
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
