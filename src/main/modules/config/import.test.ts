import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ConfigProfile } from '@shared/modules/config'
import type { Installation } from '@shared/types'
import { scopedLogger } from '../../lib/logger'
import {
  commitImport,
  gameDirBelongsToInstallation,
  previewImport,
  scanImportCandidates,
  type ImportInstallations,
} from './import'

/**
 * Story 005 D3: the handler logic in `import.ts`, tested directly against a
 * real temp fixture tree (same style as `core/import-reader.test.ts` and
 * `index.test.ts`'s `writeProfileToAssignedInstallations` suite) rather than
 * through `configModule.setup()`.
 */

const log = scopedLogger('config-import-test')

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'q2-launcher-import-handlers-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function write(relativePath: string, content: string): Promise<void> {
  const target = join(root, relativePath)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, Buffer.from(content, 'latin1'))
}

function lines(...parts: string[]): string {
  return `${parts.join('\n')}\n`
}

function installation(overrides: Partial<Installation> = {}): Installation {
  return {
    id: 'i1',
    name: 'Test',
    rootPath: root,
    engineKind: 'r1q2',
    launchArgs: [],
    activeGameDir: '',
    source: 'manual',
    status: 'ok',
    checks: [],
    gameDirs: ['xatrix', 'rogue'],
    favorite: false,
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    totalPlaytimeSeconds: 0,
    ...overrides,
  }
}

function installations(inst: Installation | undefined): ImportInstallations {
  return { find: (id) => (inst && inst.id === id ? inst : undefined) }
}

describe('gameDirBelongsToInstallation', () => {
  it('accepts baseq2 even though it is never listed in gameDirs', () => {
    expect(gameDirBelongsToInstallation(installation({ gameDirs: [] }), 'baseq2')).toBe(true)
  })

  it('accepts a listed gamedir and rejects an unlisted one', () => {
    const inst = installation({ gameDirs: ['xatrix'] })
    expect(gameDirBelongsToInstallation(inst, 'xatrix')).toBe(true)
    expect(gameDirBelongsToInstallation(inst, 'rogue')).toBe(false)
  })
})

describe('scanImportCandidates', () => {
  it('returns only gamedirs with at least one config file, baseq2 first', async () => {
    await write('baseq2/config.cfg', lines('set cl_run "1"'))
    await write('xatrix/autoexec.cfg', lines('set name "x"'))
    // rogue is a listed gamedir with no config files - must be excluded.
    await mkdir(join(root, 'rogue'), { recursive: true })

    const result = await scanImportCandidates(installations(installation()), {
      installationId: 'i1',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.candidates).toEqual([
      { gameDir: 'baseq2', hasConfigCfg: true, hasAutoexecCfg: false },
      { gameDir: 'xatrix', hasConfigCfg: false, hasAutoexecCfg: true },
    ])
  })

  it('fails cleanly, with no filesystem access, for an unknown installation id', async () => {
    const result = await scanImportCandidates(installations(undefined), {
      installationId: 'ghost',
    })

    expect(result).toEqual({ ok: false, error: { key: 'config.error.installationNotFound' } })
  })
})

describe('previewImport', () => {
  it('reports counts and preserved lines without writing anything', async () => {
    await write(
      'baseq2/config.cfg',
      lines('set sensitivity "3"', 'bind x "+attack"', 'alias +wave "say hi"', 'exec extra.cfg'),
    )
    await write('baseq2/extra.cfg', lines('bind y "+jump"'))
    await write('baseq2/autoexec.cfg', lines('set sensitivity "5"'))

    const before = await readdir(join(root, 'baseq2'))

    const result = await previewImport(installations(installation()), log, {
      installationId: 'i1',
      gameDir: 'baseq2',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.cvarCount).toBe(1)
    expect(result.value.bindCount).toBe(2)
    expect(result.value.preserved).toEqual([
      { file: 'config.cfg', line: 3, text: 'alias +wave "say hi"' },
    ])
    expect(result.value.filesRead).toEqual(['config.cfg', 'extra.cfg', 'autoexec.cfg'])

    const after = await readdir(join(root, 'baseq2'))
    expect(after).toEqual(before)
  })

  it('fails with installationNotFound for an unknown installation id, before touching the filesystem', async () => {
    const result = await previewImport(installations(undefined), log, {
      installationId: 'ghost',
      gameDir: 'baseq2',
    })

    expect(result).toEqual({ ok: false, error: { key: 'config.error.installationNotFound' } })
  })

  it("fails with gameDirNotFound for a gamedir that isn't the installation's, without touching a nonexistent root", async () => {
    const inst = installation({ rootPath: join(root, 'does-not-exist'), gameDirs: ['xatrix'] })

    const result = await previewImport(installations(inst), log, {
      installationId: 'i1',
      gameDir: 'not-a-real-gamedir',
    })

    expect(result).toEqual({ ok: false, error: { key: 'config.error.gameDirNotFound' } })
  })
})

describe('commitImport', () => {
  function fakeCreateProfile() {
    const calls: {
      name: string
      cvars: Record<string, string>
      binds: Record<string, string>
      unrecognized: { file: string; line: number; text: string }[]
    }[] = []
    const stubProfiles: ConfigProfile[] = [
      {
        id: 'new-profile',
        name: 'stub',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        cvars: {},
        binds: {},
        assignments: [],
      },
    ]
    const createProfile = (input: (typeof calls)[number]): ConfigProfile[] => {
      calls.push(input)
      return stubProfiles
    }
    return { calls, stubProfiles, createProfile }
  }

  it('re-parses from disk and creates a profile carrying cvars, binds and unrecognized', async () => {
    await write(
      'baseq2/config.cfg',
      lines('set sensitivity "3"', 'bind x "+attack"', 'alias a "b"'),
    )

    const before = await readdir(join(root, 'baseq2'))
    const { calls, stubProfiles, createProfile } = fakeCreateProfile()

    const result = await commitImport(
      installations(installation()),
      log,
      { installationId: 'i1', gameDir: 'baseq2', name: 'Imported' },
      createProfile,
    )

    expect(result).toEqual({ ok: true, value: stubProfiles })
    expect(calls).toEqual([
      {
        name: 'Imported',
        cvars: { sensitivity: '3' },
        binds: { x: '+attack' },
        unrecognized: [{ file: 'config.cfg', line: 3, text: 'alias a "b"' }],
      },
    ])
    // Import is read-only - the source installation's files are untouched.
    const after = await readdir(join(root, 'baseq2'))
    expect(after).toEqual(before)
  })

  it('fails with installationNotFound for an unknown installation id and never calls createProfile', async () => {
    const { calls, createProfile } = fakeCreateProfile()

    const result = await commitImport(
      installations(undefined),
      log,
      { installationId: 'ghost', gameDir: 'baseq2', name: 'Imported' },
      createProfile,
    )

    expect(result).toEqual({ ok: false, error: { key: 'config.error.installationNotFound' } })
    expect(calls).toEqual([])
  })

  it("fails with gameDirNotFound for a gamedir that isn't the installation's, without touching a nonexistent root or calling createProfile", async () => {
    const inst = installation({ rootPath: join(root, 'does-not-exist'), gameDirs: ['xatrix'] })
    const { calls, createProfile } = fakeCreateProfile()

    const result = await commitImport(
      installations(inst),
      log,
      { installationId: 'i1', gameDir: 'not-a-real-gamedir', name: 'Imported' },
      createProfile,
    )

    expect(result).toEqual({ ok: false, error: { key: 'config.error.gameDirNotFound' } })
    expect(calls).toEqual([])
  })
})
