import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DownloadsErrorKey } from '@shared/modules/downloads'
import type { ModInstallRecord } from '@shared/modules/mods'
import { fail, ok, type Installation, type Job } from '@shared/types'
import type { BinaryArch } from '../../lib/fs-utils'
import { inspectInstallation } from '../../services/inspector'
import type { CreateJobInput } from '../../services/jobs'
import { WriteCancelledError } from '../../services/write-guard'
import { getExtractDir } from '../downloads/pipeline'
import type { StagePackageInput, StagePackageResult } from '../downloads/stage-package'
import type { ModCatalogEntryParsed } from './catalog-schema'
import { readModsState } from './install-records'
import {
  placedGameLibraryName,
  startModInstall,
  type ModInstallDecision,
  type ModInstallDeps,
} from './install-job'

type Tree = Record<string, string>
type StageSpec = { files: Tree } | { fail: string }

const sha = (text: string): string => createHash('sha256').update(text).digest('hex')

const pkg = (id: string) => ({
  id,
  version: '1',
  url: `https://example.com/${id}.zip`,
  mirrors: [],
  sizeBytes: 100,
  sha256: 'a'.repeat(64),
  contents: [{ from: '.', to: 'gamedir' as const }],
})

const entry: ModCatalogEntryParsed = {
  id: 'fixturemod',
  gamedir: 'fixturemod',
  name: 'Fixture Mod',
  description: '',
  license: 'GPL',
  projectUrl: 'https://example.com',
  sourceUrl: 'https://example.com',
  pinned: '1.0',
  versions: [
    {
      version: '1.0',
      prerelease: false,
      variants: [{ platform: 'win32', arch: 'x64', packages: [pkg('lib'), pkg('data')] }],
      contentOnly: { packages: [pkg('content')] },
    },
  ],
}

let tmp: string
let root: string
let userData: string

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'q2l-mod-install-'))
  root = join(tmp, 'quake2')
  userData = join(tmp, 'userData')
  await mkdir(join(root, 'baseq2'), { recursive: true })
  await mkdir(userData, { recursive: true })
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

async function writeTree(base: string, tree: Tree): Promise<void> {
  for (const [rel, content] of Object.entries(tree)) {
    await mkdir(dirname(join(base, rel)), { recursive: true })
    await writeFile(join(base, rel), content)
  }
}

async function listTree(dir: string, prefix = ''): Promise<string[]> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const out: string[] = []
  for (const e of entries) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name
    if (e.isDirectory()) out.push(`${rel}/`, ...(await listTree(join(dir, e.name), rel)))
    else out.push(rel)
  }
  return out.sort()
}

function harness(options: {
  stages: StageSpec[]
  arch?: BinaryArch
  decision?: ModInstallDecision
  moduleData?: Record<string, unknown>
}) {
  const installation = {
    id: 'inst1',
    name: 'Quake II',
    rootPath: root,
    engineKind: 'q2pro',
    executablePath: join(root, 'q2pro.exe'),
    executableKind: 'pe',
    gameDirs: ['baseq2'],
    moduleData: options.moduleData ?? {},
  } as unknown as Installation

  const events: string[] = []
  let inGuard = false
  const finished: { status: string; error?: Job['error'] }[] = []
  const jobs = {
    create: vi.fn((_input: CreateJobInput) => ({ id: 'job1' }) as Job),
    progress: vi.fn(),
    setWaiting: vi.fn(),
    finish: vi.fn((_id: string, outcome: { status: string; error?: Job['error'] }) => {
      finished.push(outcome)
    }),
  }
  const installations = {
    find: (id: string) => (id === installation.id ? installation : undefined),
    validate: vi.fn(async () => {
      const result = await inspectInstallation(root)
      installation.gameDirs = result.gameDirs
      return ok(installation)
    }),
    setModuleData: vi.fn((_id: string, moduleId: string, value: unknown) => {
      events.push(inGuard ? 'record-in-guard' : 'record-outside-guard')
      installation.moduleData = { ...installation.moduleData, [moduleId]: value }
      return ok(installation)
    }),
  }
  const writeGuard = {
    runWrite: vi.fn(async (_i: string, _j: string, _s: AbortSignal, fn: () => Promise<void>) => {
      events.push('guard-enter')
      inGuard = true
      try {
        await fn()
      } finally {
        inGuard = false
        events.push('guard-exit')
      }
    }),
  }
  const stage = vi.fn(async (input: StagePackageInput): Promise<StagePackageResult> => {
    const spec = options.stages[input.index]!
    const extractDir = getExtractDir(input.userDataPath, `${input.jobId}-${input.index}`)
    await mkdir(extractDir, { recursive: true })
    if ('fail' in spec) {
      return { ok: false, key: spec.fail as DownloadsErrorKey, cancelled: false }
    }
    await writeTree(extractDir, spec.files)
    return { ok: true, archivePath: join(userData, 'a.zip'), extractDir }
  })
  const askDecision = vi.fn(async () => options.decision ?? 'overwrite')

  const deps: ModInstallDeps = {
    jobs,
    installations,
    writeGuard,
    catalog: {
      getCatalog: async () => ({
        status: 'ok',
        entries: [entry],
        fetchedAt: new Date().toISOString(),
        fromCache: false,
        ageMs: 0,
      }),
    },
    enginePackages: () => [],
    stage,
    resolveExtractor: () => ({ path: '7za', exists: true }),
    readArch: async () => options.arch ?? 'x86_64',
    askDecision,
    userDataPath: userData,
  }

  const records = (): ModInstallRecord[] => readModsState(installation.moduleData).records
  const run = async () => {
    const started = await startModInstall(deps, {
      installationId: 'inst1',
      catalogId: 'fixturemod',
    })
    if (!started.ok) throw new Error(started.error.key)
    return started.value.settled
  }
  return {
    deps,
    installation,
    jobs,
    installations,
    writeGuard,
    stage,
    askDecision,
    events,
    finished,
    records,
    run,
  }
}

async function stagingLeft(): Promise<string[]> {
  return listTree(join(userData, 'cache', 'downloads', 'extract'))
}

describe('placedGameLibraryName', () => {
  it('a suffixed game library is placed under its plain name', () => {
    expect(placedGameLibraryName('gamex86-opentdm-r388~add8f3c.dll')).toBe('gamex86.dll')
    expect(placedGameLibraryName('gamex86_64-opentdm-r388~add8f3c.so')).toBe('gamex86_64.so')
    expect(placedGameLibraryName('GameX86-foo.DLL')).toBe('GameX86.DLL')
    expect(placedGameLibraryName('gamex86.dll')).toBe('gamex86.dll')
    expect(placedGameLibraryName('lib/gamex86-foo.dll')).toBe('lib/gamex86-foo.dll')
    expect(placedGameLibraryName('pak0-extra.pak')).toBe('pak0-extra.pak')
  })
})

describe('startModInstall', () => {
  it('a verification failure writes nothing and records nothing', async () => {
    const h = harness({
      stages: [{ fail: 'downloads.error.verificationFailed' }, { files: { 'pak0.pak': 'x' } }],
    })
    const outcome = await h.run()
    expect(outcome).toEqual({ status: 'failed', key: 'downloads.error.verificationFailed' })
    expect(h.finished).toEqual([
      { status: 'failed', error: { key: 'downloads.error.verificationFailed' } },
    ])
    expect(await listTree(root)).toEqual(['baseq2/'])
    expect(h.records()).toEqual([])
    expect(h.writeGuard.runWrite).not.toHaveBeenCalled()
    expect(await stagingLeft()).toEqual([])
  })

  it('a second package failing leaves the gamedir untouched', async () => {
    await writeTree(join(root, 'fixturemod'), { 'pak0.pak': 'mine' })
    const h = harness({
      stages: [{ files: { 'pak0.pak': 'theirs' } }, { fail: 'downloads.error.network' }],
    })
    const outcome = await h.run()
    expect(outcome).toEqual({ status: 'failed', key: 'downloads.error.network' })
    expect(await listTree(join(root, 'fixturemod'))).toEqual(['pak0.pak'])
    expect(await readFile(join(root, 'fixturemod', 'pak0.pak'), 'utf8')).toBe('mine')
    expect(h.askDecision).not.toHaveBeenCalled()
    expect(h.records()).toEqual([])
    expect(await stagingLeft()).toEqual([])
  })

  it('the write runs inside runWrite', async () => {
    const h = harness({
      stages: [{ files: { 'gamex86_64.dll': 'lib' } }, { files: { 'pak0.pak': 'data' } }],
    })
    // The write is deferred (a running game) and the user cancels while it waits: nothing may
    // reach the installation before the guard runs the write.
    h.writeGuard.runWrite.mockImplementationOnce(async () => {
      expect(await listTree(root)).toEqual(['baseq2/'])
      h.jobs.create.mock.calls[0]![0].onCancel?.()
      throw new WriteCancelledError()
    })
    expect(await h.run()).toEqual({ status: 'cancelled' })
    expect(await listTree(root)).toEqual(['baseq2/'])
    expect(h.records()).toEqual([])

    const outcome = await h.run()
    expect(outcome.status).toBe('succeeded')
    expect(h.writeGuard.runWrite).toHaveBeenLastCalledWith(
      'inst1',
      'job1',
      expect.any(AbortSignal),
      expect.any(Function),
    )
    expect(h.events).toEqual(['guard-enter', 'record-in-guard', 'guard-exit'])
    expect(await listTree(join(root, 'fixturemod'))).toEqual(['gamex86_64.dll', 'pak0.pak'])
    expect(h.installations.validate).toHaveBeenCalledWith('inst1')
  })

  it('the record lists every written file with size and hash', async () => {
    const h = harness({
      stages: [
        { files: { 'gamex86_64-opentdm-r388~add8f3c.dll': 'library-bytes' } },
        { files: { 'pak0.pak': 'pak-bytes', 'maps/q2dm1.bsp': 'map' } },
      ],
    })
    const outcome = await h.run()
    expect(outcome.status).toBe('succeeded')
    expect(h.events).toEqual(['guard-enter', 'record-in-guard', 'guard-exit'])
    const [record] = h.records()
    expect(record).toMatchObject({
      catalogId: 'fixturemod',
      gameDir: 'fixturemod',
      version: '1.0',
      variantId: 'win32-x64',
      engineKind: 'q2pro',
      arch: 'x64',
      platform: 'win32',
      contentOnly: false,
    })
    expect([...record!.files].sort((a, b) => a.path.localeCompare(b.path))).toEqual([
      { path: 'gamex86_64.dll', sizeBytes: 13, sha256: sha('library-bytes') },
      { path: 'maps/q2dm1.bsp', sizeBytes: 3, sha256: sha('map') },
      { path: 'pak0.pak', sizeBytes: 9, sha256: sha('pak-bytes') },
    ])
    expect(await listTree(join(root, 'fixturemod'))).toEqual([
      'gamex86_64.dll',
      'maps/',
      'maps/q2dm1.bsp',
      'pak0.pak',
    ])
    expect(h.finished).toEqual([{ status: 'succeeded' }])
    expect(await stagingLeft()).toEqual([])
  })

  it("keep leaves the user's file and keeps it out of the record", async () => {
    await writeTree(join(root, 'FixtureMod'), { 'pak0.pak': 'mine', 'readme.txt': 'same' })
    const h = harness({
      decision: 'keep',
      stages: [
        { files: { 'gamex86_64.dll': 'lib' } },
        { files: { 'pak0.pak': 'theirs', 'readme.txt': 'same' } },
      ],
    })
    const outcome = await h.run()
    expect(outcome.status).toBe('succeeded')
    expect(h.askDecision).toHaveBeenCalledWith('job1', {
      folder: 'FixtureMod',
      conflicts: ['pak0.pak'],
    })
    expect(h.jobs.setWaiting).toHaveBeenCalledWith(
      'job1',
      expect.objectContaining({ key: 'mods.job.waitingForDecision' }),
    )
    expect(await readFile(join(root, 'FixtureMod', 'pak0.pak'), 'utf8')).toBe('mine')
    expect(await listTree(root)).toEqual([
      'FixtureMod/',
      'FixtureMod/gamex86_64.dll',
      'FixtureMod/pak0.pak',
      'FixtureMod/readme.txt',
      'baseq2/',
    ])
    const [record] = h.records()
    expect(record!.gameDir).toBe('FixtureMod')
    expect(record!.files.map((f) => f.path)).toEqual(['gamex86_64.dll'])
  })

  it('overwrite replaces and records the file', async () => {
    await writeTree(join(root, 'fixturemod'), { 'pak0.pak': 'mine', 'readme.txt': 'same' })
    const h = harness({
      decision: 'overwrite',
      stages: [
        { files: { 'gamex86_64.dll': 'lib' } },
        { files: { 'pak0.pak': 'theirs', 'readme.txt': 'same' } },
      ],
    })
    const outcome = await h.run()
    expect(outcome.status).toBe('succeeded')
    expect(await readFile(join(root, 'fixturemod', 'pak0.pak'), 'utf8')).toBe('theirs')
    const paths = h
      .records()[0]!
      .files.map((f) => f.path)
      .sort()
    expect(paths).toEqual(['gamex86_64.dll', 'pak0.pak'])
    expect(h.records()[0]!.files.find((f) => f.path === 'pak0.pak')!.sha256).toBe(sha('theirs'))
    expect(await stagingLeft()).toEqual([])
  })

  it('cancel at the decision writes nothing', async () => {
    await writeTree(join(root, 'fixturemod'), { 'pak0.pak': 'mine' })
    const h = harness({
      decision: 'cancel',
      stages: [{ files: { 'gamex86_64.dll': 'lib' } }, { files: { 'pak0.pak': 'theirs' } }],
    })
    const outcome = await h.run()
    expect(outcome).toEqual({ status: 'cancelled' })
    expect(h.finished).toEqual([{ status: 'cancelled' }])
    expect(h.writeGuard.runWrite).not.toHaveBeenCalled()
    expect(await listTree(join(root, 'fixturemod'))).toEqual(['pak0.pak'])
    expect(await readFile(join(root, 'fixturemod', 'pak0.pak'), 'utf8')).toBe('mine')
    expect(h.records()).toEqual([])
    expect(await stagingLeft()).toEqual([])
  })

  it('a failed copy restores the overwritten file', async () => {
    // `zfile.txt` is a folder in the user's game dir, so the second package's file cannot be
    // placed there - after `new.txt` was created and `pak0.pak` was already overwritten.
    await writeTree(join(root, 'fixturemod'), { 'pak0.pak': 'mine', 'zfile.txt/keep.me': 'k' })
    const h = harness({
      decision: 'overwrite',
      stages: [
        { files: { 'new.txt': 'new', 'pak0.pak': 'theirs' } },
        { files: { 'zfile.txt': 'z' } },
      ],
    })
    const outcome = await h.run()
    expect(outcome).toEqual({ status: 'failed', key: 'mods.error.writeFailed' })
    expect(h.finished).toEqual([{ status: 'failed', error: { key: 'mods.error.writeFailed' } }])
    expect(await readFile(join(root, 'fixturemod', 'pak0.pak'), 'utf8')).toBe('mine')
    expect(await listTree(join(root, 'fixturemod'))).toEqual([
      'pak0.pak',
      'zfile.txt/',
      'zfile.txt/keep.me',
    ])
    expect(h.records()).toEqual([])
    expect(h.installations.setModuleData).not.toHaveBeenCalled()
    expect(await stagingLeft()).toEqual([])
  })

  it('a file appearing after planning is backed up and survives a rollback', async () => {
    const h = harness({
      stages: [
        { files: { 'gamex86_64.dll': 'lib', 'new.txt': 'new' } },
        { files: { 'zfile.txt': 'z' } },
      ],
    })
    // Appears between planning and writing: new.txt is the user's, zfile.txt is a folder that fails the run.
    h.writeGuard.runWrite.mockImplementationOnce(async (_i, _j, _s, fn) => {
      await writeTree(join(root, 'fixturemod'), { 'new.txt': 'user', 'zfile.txt/keep.me': 'k' })
      await fn()
    })
    const outcome = await h.run()
    expect(outcome).toEqual({ status: 'failed', key: 'mods.error.writeFailed' })
    expect(await readFile(join(root, 'fixturemod', 'new.txt'), 'utf8')).toBe('user')
    expect(await listTree(join(root, 'fixturemod'))).toEqual([
      'new.txt',
      'zfile.txt/',
      'zfile.txt/keep.me',
    ])
    expect(h.records()).toEqual([])
    expect(await stagingLeft()).toEqual([])
  })

  it('an existing record is refused before any job exists', async () => {
    const h = harness({
      stages: [{ files: { 'pak0.pak': 'x' } }],
      moduleData: { mods: { records: [{ gameDir: 'FIXTUREMOD' }] } },
    })
    const started = await startModInstall(h.deps, {
      installationId: 'inst1',
      catalogId: 'fixturemod',
    })
    expect(started).toEqual(fail('mods.error.alreadyInstalled'))
    expect(h.jobs.create).not.toHaveBeenCalled()
    expect(h.stage).not.toHaveBeenCalled()
    expect(await listTree(root)).toEqual(['baseq2/'])

    const unknown = await startModInstall(h.deps, {
      installationId: 'nope',
      catalogId: 'fixturemod',
    })
    expect(unknown).toEqual(fail('installations.error.notFound'))
    const badVersion = await startModInstall(harness({ stages: [] }).deps, {
      installationId: 'inst1',
      catalogId: 'fixturemod',
      version: '9.9',
    })
    expect(badVersion).toEqual(fail('mods.error.unknownMod'))
    expect(h.jobs.create).not.toHaveBeenCalled()
  })

  it('a content-only variant records contentOnly', async () => {
    // An x86 engine and an x64-only library variant: only the content package set fits.
    const h = harness({ arch: 'x86', stages: [{ files: { 'pak0.pak': 'content' } }] })
    const outcome = await h.run()
    expect(outcome.status).toBe('succeeded')
    expect(h.stage).toHaveBeenCalledTimes(1)
    const [record] = h.records()
    expect(record).toMatchObject({
      contentOnly: true,
      variantId: 'content-only',
      arch: 'x86',
      platform: 'win32',
    })
    expect(record!.files).toEqual([{ path: 'pak0.pak', sizeBytes: 7, sha256: sha('content') }])
    // Story 193: the real inspector (through validate) lists the content-only folder as a game dir.
    expect(h.installation.gameDirs).toContain('fixturemod')
  })

  it('a content-only install with an unknown arch records unknown and shows no bitness', async () => {
    const h = harness({ arch: 'unknown', stages: [{ files: { 'pak0.pak': 'content' } }] })
    expect((await h.run()).status).toBe('succeeded')
    const [record] = h.records()
    expect(record).toMatchObject({ contentOnly: true, arch: 'unknown' })
  })

  it('a second install of the same gamedir while one runs is refused before any job exists', async () => {
    const h = harness({
      stages: [{ files: { 'gamex86_64.dll': 'lib' } }, { files: { 'pak0.pak': 'data' } }],
    })
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const realStage = h.stage.getMockImplementation()!
    h.stage.mockImplementationOnce(async (input) => {
      await gate
      return realStage(input)
    })
    const first = await startModInstall(h.deps, {
      installationId: 'inst1',
      catalogId: 'fixturemod',
    })
    expect(first.ok).toBe(true)
    const second = await startModInstall(h.deps, {
      installationId: 'inst1',
      catalogId: 'fixturemod',
    })
    expect(second).toEqual(fail('mods.error.alreadyInstalled'))
    expect(h.jobs.create).toHaveBeenCalledTimes(1)
    release()
    if (first.ok) expect((await first.value.settled).status).toBe('succeeded')
  })

  it('the in-flight slot is released when the install fails', async () => {
    const h = harness({
      stages: [{ fail: 'downloads.error.network' }, { files: { 'pak0.pak': 'x' } }],
    })
    expect((await h.run()).status).toBe('failed')
    const again = await startModInstall(h.deps, {
      installationId: 'inst1',
      catalogId: 'fixturemod',
    })
    expect(again.ok).toBe(true)
    if (again.ok) await again.value.settled
  })
})
