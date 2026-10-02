import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DownloadsErrorKey } from '@shared/modules/downloads'
import type { ModInstallRecord } from '@shared/modules/mods'
import { fail, ok, type Installation } from '@shared/types'
import type { BinaryArch } from '../../lib/fs-utils'
import { makeJobRunner } from '../../../test-support/job-runner'
import { getExtractDir } from '../../services/package-staging'
import type { StagePackageInput, StagePackageResult } from '../../services/package-staging'
import type { ModCatalogEntryParsed } from './catalog-schema'
import { startEngineUpdate } from '../downloads/engine/update-job'
import { startModInstall } from './install-job'
import { readModsState } from './install-records'
import type { ModUpdatePolicy } from './update-plan'
import {
  MOD_BACKUP_DIR_NAME,
  previewModUpdate,
  startModUpdate,
  type ModUpdateDeps,
} from './update-job'

type Tree = Record<string, string>
type StageSpec = { files: Tree } | { fail: string }

const sha = (text: string): string => createHash('sha256').update(text).digest('hex')
const fileOf = (path: string, content: string) => ({
  path,
  sizeBytes: Buffer.byteLength(content),
  sha256: sha(content),
})

const pkg = (id: string) => ({
  id,
  version: '1',
  url: `https://example.com/${id}.zip`,
  mirrors: [],
  sizeBytes: 100,
  sha256: 'a'.repeat(64),
  contents: [{ from: '.', to: 'gamedir' as const }],
})

const version = (v: string) => ({
  version: v,
  prerelease: false,
  variants: [
    { platform: 'win32' as const, arch: 'x64' as const, packages: [pkg('lib'), pkg('data')] },
  ],
  contentOnly: { packages: [pkg('content')] },
})

const entry: ModCatalogEntryParsed = {
  id: 'fixturemod',
  gamedir: 'fixturemod',
  name: 'Fixture Mod',
  description: '',
  license: 'GPL',
  projectUrl: 'https://example.com',
  sourceUrl: 'https://example.com',
  pinned: '2.0',
  versions: [version('1.0'), version('2.0')],
}

/** Version 1.0 as installed: content only. */
const OLD_FILES: Tree = {
  'pak0.pak': 'old-pak',
  'maps/old.bsp': 'old-map',
  'readme.txt': 'readme-v1',
}
const oldRecord = (): ModInstallRecord => ({
  catalogId: 'fixturemod',
  gameDir: 'fixturemod',
  version: '1.0',
  variantId: 'content-only',
  engineKind: 'q2pro',
  arch: 'x86',
  platform: 'win32',
  contentOnly: true,
  installedAt: 1,
  files: Object.entries(OLD_FILES).map(([path, content]) => fileOf(path, content)),
})

let tmp: string
let root: string
let userData: string
let gameDir: string

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'q2l-mod-update-'))
  root = join(tmp, 'quake2')
  userData = join(tmp, 'userData')
  gameDir = join(root, 'fixturemod')
  await mkdir(join(root, 'baseq2'), { recursive: true })
  await mkdir(userData, { recursive: true })
  await writeTree(gameDir, OLD_FILES)
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

/** Every file under `dir` with its bytes; folders as `name/` -> ''. */
async function readTree(dir: string, prefix = ''): Promise<Tree> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return {}
  }
  const out: Tree = {}
  for (const e of entries) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name
    if (e.isDirectory())
      Object.assign(out, { [`${rel}/`]: '' }, await readTree(join(dir, e.name), rel))
    else out[rel] = await readFile(join(dir, e.name), 'utf8')
  }
  return out
}

function harness(options: { stages: StageSpec[]; arch?: BinaryArch }) {
  const installation = {
    id: 'inst1',
    name: 'Quake II',
    rootPath: root,
    engineKind: 'q2pro',
    executablePath: join(root, 'q2pro.exe'),
    executableKind: 'pe',
    gameDirs: ['baseq2', 'fixturemod'],
    moduleData: { mods: { records: [oldRecord()] } },
  } as unknown as Installation

  const events: string[] = []
  let inGuard = false
  const installations = {
    find: (id: string) => (id === installation.id ? installation : undefined),
    validate: vi.fn(async (_id: string) => ok(installation)),
    setModuleData: vi.fn((_id: string, moduleId: string, value: unknown) => {
      events.push(inGuard ? 'record-in-guard' : 'record-outside-guard')
      installation.moduleData = { ...installation.moduleData, [moduleId]: value }
      return ok(installation)
    }),
  }
  const { runner, jobs, writeGuard } = makeJobRunner({
    validate: (id) => installations.validate(id),
  })
  const realRunWrite = writeGuard.runWrite.bind(writeGuard)
  const runWrite = vi.spyOn(writeGuard, 'runWrite').mockImplementation(async (i, j, s, fn) => {
    events.push('guard-enter')
    inGuard = true
    try {
      await realRunWrite(i, j, s, fn)
    } finally {
      inGuard = false
      events.push('guard-exit')
    }
  })
  const stage = vi.fn(async (input: StagePackageInput): Promise<StagePackageResult> => {
    const spec = options.stages[input.index]!
    const extractDir = getExtractDir(input.userDataPath, `${input.jobId}-${input.index}`)
    await mkdir(extractDir, { recursive: true })
    if ('fail' in spec)
      return {
        ok: false,
        key: spec.fail as DownloadsErrorKey,
        cancelled: false,
        stage: 'download',
        reason: 'test',
      }
    await writeTree(extractDir, spec.files)
    return {
      ok: true,
      archivePath: join(userData, 'a.zip'),
      extractDir,
      url: 'https://example.test/a.zip',
      sizeBytes: 1,
    }
  })

  const deps: ModUpdateDeps = {
    runner,
    installations,
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
    readArch: async () => options.arch ?? 'x86',
    userDataPath: userData,
  }

  const records = (): ModInstallRecord[] => readModsState(installation.moduleData).records
  let lastJobId = ''
  const run = async (changedPolicy: ModUpdatePolicy = 'overwrite') => {
    const started = await startModUpdate(deps, {
      installationId: 'inst1',
      catalogId: 'fixturemod',
      changedPolicy,
    })
    if (!started.ok) throw new Error(started.error.key)
    lastJobId = started.value.jobId
    return started.value.settled
  }
  /** The terminal state of every job, read from the job list the way the UI sees it. */
  const finished = () =>
    jobs.list().map((job) => ({ status: job.status, ...(job.error ? { error: job.error } : {}) }))
  return {
    deps,
    runner,
    installation,
    jobs,
    installations,
    writeGuard: { runWrite },
    stage,
    events,
    finished,
    jobId: () => lastJobId,
    records,
    run,
  }
}

const byPath = (a: { path: string }, b: { path: string }) => a.path.localeCompare(b.path)

async function slotLeft(): Promise<Tree> {
  return readTree(join(root, MOD_BACKUP_DIR_NAME))
}

async function stagingLeft(): Promise<Tree> {
  return readTree(join(userData, 'cache', 'downloads', 'extract'))
}

describe('startModUpdate', () => {
  it('a successful update writes the new files and record', async () => {
    // An x64 engine: 2.0 moves the install from content-only to the full win32-x64 variant.
    const h = harness({
      arch: 'x86_64',
      stages: [
        { files: { 'gamex86_64.dll': 'lib-v2' } },
        { files: { 'pak0.pak': 'new-pak', 'readme.txt': 'readme-v2', 'maps/new.bsp': 'new-map' } },
      ],
    })
    const outcome = await h.run()
    expect(outcome.status).toBe('succeeded')
    expect(h.jobs.list()).toEqual([
      expect.objectContaining({
        kind: 'mod-update',
        labelKey: 'mods.job.update',
        labelParams: { name: 'Fixture Mod', version: '2.0' },
        installationId: 'inst1',
      }),
    ])
    expect(h.events).toEqual(['guard-enter', 'record-in-guard', 'guard-exit'])
    expect(await readTree(gameDir)).toEqual({
      'gamex86_64.dll': 'lib-v2',
      'maps/': '',
      'maps/new.bsp': 'new-map',
      'pak0.pak': 'new-pak',
      'readme.txt': 'readme-v2',
    })
    const [record] = h.records()
    expect(record).toMatchObject({
      catalogId: 'fixturemod',
      gameDir: 'fixturemod',
      version: '2.0',
      variantId: 'win32-x64',
      engineKind: 'q2pro',
      arch: 'x64',
      platform: 'win32',
      contentOnly: false,
    })
    expect([...record!.files].sort(byPath)).toEqual([
      fileOf('gamex86_64.dll', 'lib-v2'),
      fileOf('maps/new.bsp', 'new-map'),
      fileOf('pak0.pak', 'new-pak'),
      fileOf('readme.txt', 'readme-v2'),
    ])
    expect(h.finished()).toEqual([{ status: 'succeeded' }])
    expect(h.installations.validate).toHaveBeenCalledWith('inst1')
    expect(await slotLeft()).toEqual({})
    expect(await stagingLeft()).toEqual({})
  })

  it('update removes obsolete recorded files and keeps unrecorded ones', async () => {
    // The user's own files: one beside the obsolete map, one at the root, one at a path 2.0 ships.
    const userFiles: Tree = {
      'maps/mine.bsp': 'my-map',
      'autoexec.cfg': 'bind x',
      'extra.txt': 'my-notes',
    }
    await writeTree(gameDir, userFiles)
    const h = harness({
      stages: [{ files: { 'pak0.pak': 'new-pak', 'extra.txt': 'their-notes' } }],
    })
    const outcome = await h.run()
    expect(outcome.status).toBe('succeeded')
    expect(await readTree(gameDir)).toEqual({
      ...userFiles,
      'maps/': '',
      'pak0.pak': 'new-pak',
    })
    // `extra.txt` was in no record: left byte-for-byte and not adopted into the new one.
    expect(h.records()[0]!.files).toEqual([fileOf('pak0.pak', 'new-pak')])
    expect(await slotLeft()).toEqual({})
  })

  it('a new path differing only in case is written under the old record spelling and not removed', async () => {
    const h = harness({ stages: [{ files: { 'PAK0.PAK': 'new-pak' } }] })
    expect((await h.run()).status).toBe('succeeded')
    expect(h.records()[0]!.files).toEqual([fileOf('pak0.pak', 'new-pak')])
    // Same listing on case-sensitive and case-insensitive file systems: one file, old spelling.
    expect(await readTree(gameDir)).toEqual({ 'pak0.pak': 'new-pak' })
  })

  it('an obsolete folder left empty is pruned', async () => {
    const h = harness({ stages: [{ files: { 'pak0.pak': 'new-pak' } }] })
    expect((await h.run()).status).toBe('succeeded')
    expect(await readTree(gameDir)).toEqual({ 'pak0.pak': 'new-pak' })
  })

  it('a verify or extract failure leaves the old files and record', async () => {
    for (const key of ['downloads.error.verificationFailed', 'downloads.error.extractionFailed']) {
      const before = await readTree(root)
      const h = harness({
        arch: 'x86_64',
        stages: [{ files: { 'gamex86_64.dll': 'lib-v2' } }, { fail: key }],
      })
      const outcome = await h.run()
      expect(outcome).toEqual({ status: 'failed', key })
      expect(h.finished()).toEqual([{ status: 'failed', error: { key } }])
      expect(h.writeGuard.runWrite).not.toHaveBeenCalled()
      expect(h.installations.setModuleData).not.toHaveBeenCalled()
      expect(h.records()).toEqual([oldRecord()])
      expect(await readTree(root)).toEqual(before)
      expect(await stagingLeft()).toEqual({})
    }
  })

  it('a mid-copy failure restores the backup and keeps the old record', async () => {
    const h = harness({
      stages: [{ files: { 'a-new.txt': 'n', 'pak0.pak': 'new-pak', 'zz.pak': 'z' } }],
    })
    // `zz.pak` vanishes from staging after planning: its copy fails once `a-new.txt` was created,
    // `pak0.pak` overwritten and the obsolete `maps/old.bsp`/`readme.txt` moved into the slot.
    h.writeGuard.runWrite.mockImplementationOnce(async (_i, jobId, _s, fn) => {
      await rm(join(getExtractDir(userData, `${jobId}-0`), 'zz.pak'))
      await fn()
    })
    const outcome = await h.run()
    expect(outcome).toEqual({ status: 'failed', key: 'mods.error.writeFailed' })
    expect(h.finished()).toEqual([{ status: 'failed', error: { key: 'mods.error.writeFailed' } }])
    expect(await readTree(gameDir)).toEqual({ ...OLD_FILES, 'maps/': '' })
    expect(h.installations.setModuleData).not.toHaveBeenCalled()
    expect(h.records()).toEqual([oldRecord()])
    expect(await slotLeft()).toEqual({})
    expect(await readTree(root)).not.toHaveProperty(`${MOD_BACKUP_DIR_NAME}/`)
    expect(await stagingLeft()).toEqual({})
  })

  it('a failed record write restores the backup', async () => {
    const h = harness({ stages: [{ files: { 'pak0.pak': 'new-pak', 'b-new.txt': 'b' } }] })
    h.installations.setModuleData.mockImplementationOnce(() => fail('state.error.write'))
    const outcome = await h.run()
    expect(outcome).toEqual({ status: 'failed', key: 'mods.error.writeFailed' })
    expect(await readTree(gameDir)).toEqual({ ...OLD_FILES, 'maps/': '' })
    expect(h.records()).toEqual([oldRecord()])
    expect(await slotLeft()).toEqual({})
  })

  it('keep leaves a changed file byte-for-byte and out of the new record', async () => {
    await writeFile(join(gameDir, 'pak0.pak'), 'user-edit')
    await writeFile(join(gameDir, 'maps', 'old.bsp'), 'user-map')
    const h = harness({ stages: [{ files: { 'pak0.pak': 'new-pak', 'readme.txt': 'readme-v2' } }] })

    const preview = await previewModUpdate(h.deps, {
      installationId: 'inst1',
      catalogId: 'fixturemod',
    })
    expect(preview.ok && [...preview.value.changedFiles].sort()).toEqual([
      'maps/old.bsp',
      'pak0.pak',
    ])

    const outcome = await h.run('keep')
    expect(outcome.status).toBe('succeeded')
    // The changed file 2.0 ships and the changed obsolete one both stay as the user left them.
    expect(await readTree(gameDir)).toEqual({
      'maps/': '',
      'maps/old.bsp': 'user-map',
      'pak0.pak': 'user-edit',
      'readme.txt': 'readme-v2',
    })
    expect(h.records()[0]!.files).toEqual([fileOf('readme.txt', 'readme-v2')])
    if (outcome.status === 'succeeded')
      expect([...outcome.kept].sort()).toEqual(['maps/old.bsp', 'pak0.pak'])
  })

  it('overwrite replaces a changed file and records the new bytes', async () => {
    await writeFile(join(gameDir, 'pak0.pak'), 'user-edit')
    const h = harness({ stages: [{ files: { 'pak0.pak': 'new-pak' } }] })
    expect((await h.run('overwrite')).status).toBe('succeeded')
    expect(await readFile(join(gameDir, 'pak0.pak'), 'utf8')).toBe('new-pak')
    expect(h.records()[0]!.files).toEqual([fileOf('pak0.pak', 'new-pak')])
  })

  it('is refused before any job exists when busy, up to date or not recorded', async () => {
    const busy = harness({ stages: [] })
    let release!: () => void
    const held = new Promise<void>((resolve) => (release = resolve))
    const other = busy.runner.run(
      {
        moduleId: 'mods',
        kind: 'mods-remove',
        labelKey: 'mods.job.remove',
        installationId: 'inst1',
        exclusive: 'installation',
      },
      async () => {
        await held
        return { status: 'succeeded' }
      },
    )
    expect(other.ok).toBe(true)
    expect(
      await startModUpdate(busy.deps, {
        installationId: 'inst1',
        catalogId: 'fixturemod',
        changedPolicy: 'keep',
      }),
    ).toEqual(fail('jobs.error.installationBusy'))
    expect(
      await previewModUpdate(busy.deps, { installationId: 'inst1', catalogId: 'fixturemod' }),
    ).toEqual(fail('jobs.error.installationBusy'))
    expect(busy.jobs.list()).toHaveLength(1)
    release()
    if (other.ok) await other.value.settled

    const current = harness({ stages: [] })
    current.installation.moduleData = { mods: { records: [{ ...oldRecord(), version: '2.0' }] } }
    expect(
      await startModUpdate(current.deps, {
        installationId: 'inst1',
        catalogId: 'fixturemod',
        changedPolicy: 'keep',
      }),
    ).toEqual(fail('mods.update.refused.upToDate'))

    const manual = harness({ stages: [] })
    manual.installation.moduleData = {}
    expect(
      await startModUpdate(manual.deps, {
        installationId: 'inst1',
        catalogId: 'fixturemod',
        changedPolicy: 'keep',
      }),
    ).toEqual(fail('mods.update.refused.noRecord'))
    expect(current.jobs.list()).toEqual([])
    expect(manual.stage).not.toHaveBeenCalled()
    expect(await readTree(gameDir)).toEqual({ ...OLD_FILES, 'maps/': '' })
  })

  it('a running mod update refuses a mod install and an engine update', async () => {
    const h = harness({ stages: [{ files: { 'pak0.pak': 'new-pak' } }] })
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const realStage = h.stage.getMockImplementation()!
    h.stage.mockImplementationOnce(async (input) => {
      await gate
      return realStage(input)
    })
    const update = await startModUpdate(h.deps, {
      installationId: 'inst1',
      catalogId: 'fixturemod',
      changedPolicy: 'overwrite',
    })
    expect(update.ok).toBe(true)

    // A different mod: the recorded one would be refused as already installed, not as busy.
    const other = { ...entry, id: 'othermod', gamedir: 'othermod' }
    const install = await startModInstall(
      {
        ...h.deps,
        jobs: { setWaiting: vi.fn() },
        askDecision: async () => 'cancel',
        catalog: {
          getCatalog: async () => ({
            status: 'ok',
            entries: [entry, other],
            fetchedAt: new Date().toISOString(),
            fromCache: false,
            ageMs: 0,
          }),
        },
      },
      { installationId: 'inst1', catalogId: 'othermod' },
    )
    expect(install).toEqual(fail('jobs.error.installationBusy'))

    // Real engine update, past every pre-flight refusal: it is the runner that turns it away.
    const engineHost = {
      ...h.installation,
      moduleData: {
        ...h.installation.moduleData,
        downloads: { version: '1.0', packageId: 'q2pro-1.0' },
      },
    }
    const engine = await startEngineUpdate(
      {
        runner: h.runner,
        installations: {
          find: () => engineHost,
          validate: h.installations.validate,
          setEngineState: vi.fn(),
        },
        manifest: {
          resolveEnginePackage: async () => ({
            kind: 'engine',
            engine: 'q2pro',
            id: 'q2pro-2.0',
            version: '2.0',
            sizeBytes: 4096,
            sha256: 'a'.repeat(64),
            url: 'https://content.example.test/engines/q2pro-2.0.zip',
            mirrors: [],
            contents: [],
          }),
          resolveGameDataPackage: async () => undefined,
        },
        extractor: { extract: vi.fn() },
        userDataPath: userData,
        resolveExtractor: () => ({ path: '7za', exists: true }),
      },
      { installationId: 'inst1' },
    )
    expect(engine).toEqual(fail('jobs.error.installationBusy'))
    expect(h.jobs.list()).toHaveLength(1)

    release()
    if (update.ok) expect((await update.value.settled).status).toBe('succeeded')
  })
})
