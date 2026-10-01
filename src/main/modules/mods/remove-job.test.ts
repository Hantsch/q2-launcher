import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModInstallRecord } from '@shared/modules/mods'
import { ok, type Installation, type Job } from '@shared/types'
import { readModsState } from './install-records'
import { startModRemove, previewModRemoval, type ModRemoveDeps } from './remove-job'

const forced = vi.hoisted(() => ({ failPath: undefined as string | undefined }))

// A failing unlink is not reproducible on every platform; this forces one recorded path to fail.
vi.mock('./remove', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./remove')>()
  return {
    ...actual,
    removeRecordedFiles: async (...args: Parameters<typeof actual.removeRecordedFiles>) => {
      const [r, g, rec, options] = args
      if (!forced.failPath) return actual.removeRecordedFiles(r, g, rec, options)
      const rest = { files: rec.files.filter((f) => f.path !== forced.failPath) }
      const result = await actual.removeRecordedFiles(r, g, rest, options)
      result.failed.push({ path: forced.failPath, code: 'EBUSY' })
      return result
    },
  }
})

const sha = (text: string): string => createHash('sha256').update(text).digest('hex')

let root: string

function record(files: Record<string, string>): ModInstallRecord {
  return {
    catalogId: 'rogue',
    gameDir: 'rogue',
    version: '1.0',
    variantId: 'v',
    engineKind: 'r1q2',
    arch: 'x64',
    platform: 'win32',
    contentOnly: true,
    installedAt: 1,
    files: Object.entries(files).map(([path, text]) => ({
      path,
      sizeBytes: Buffer.byteLength(text),
      sha256: sha(text),
    })),
  }
}

interface Harness {
  deps: ModRemoveDeps
  installation: Installation
  finished: { id: string; status: string; error?: Job['error'] }[]
  toasts: unknown[][]
  validate: ReturnType<typeof vi.fn>
  release: () => void
  guardCalls: string[]
}

/** `gate` holds the write guard closed until `release()`. */
function harness(rec: ModInstallRecord | undefined, opts: { activeGameDir?: string; gate?: boolean; revalidatedActive?: string } = {}): Harness {
  const installation = {
    id: 'inst-1',
    name: 'My Quake',
    rootPath: root,
    gameDirs: ['baseq2', 'rogue'],
    activeGameDir: opts.activeGameDir ?? '',
    moduleData: rec ? { mods: { records: [rec] }, other: 1 } : {},
  } as unknown as Installation
  const state = { installation }
  const finished: Harness['finished'] = []
  const toasts: unknown[][] = []
  const guardCalls: string[] = []
  let release = (): void => {}
  const gate = opts.gate ? new Promise<void>((resolve) => (release = resolve)) : Promise.resolve()
  const validate = vi.fn(async () =>
    ok({ ...state.installation, activeGameDir: opts.revalidatedActive ?? '' } as Installation),
  )
  const jobs: Job[] = []
  const deps: ModRemoveDeps = {
    jobs: {
      create: (input) => {
        const job = { id: `job-${jobs.length + 1}`, status: 'running', ...input } as unknown as Job
        jobs.push(job)
        return job
      },
      progress: () => {},
      finish: (id, outcome) => {
        finished.push({ id, ...outcome })
      },
      list: () => jobs,
    },
    installations: {
      find: (id) => (id === state.installation.id ? state.installation : undefined),
      validate,
      setModuleData: (_id, moduleId, value) => {
        state.installation = {
          ...state.installation,
          moduleData: { ...(state.installation.moduleData as object), [moduleId]: value },
        } as Installation
        return ok(state.installation)
      },
    },
    writeGuard: {
      runWrite: async (_id, jobId, _signal, fn) => {
        await gate
        guardCalls.push(jobId)
        await fn()
      },
    },
    broadcast: { toast: (...args: unknown[]) => toasts.push(args) },
  }
  return {
    deps,
    get installation() {
      return state.installation
    },
    finished,
    toasts,
    validate,
    release: () => release(),
    guardCalls,
  } as Harness
}

async function seed(files: Record<string, string>): Promise<void> {
  for (const [path, text] of Object.entries(files)) {
    const full = join(root, 'rogue', ...path.split('/'))
    await mkdir(join(full, '..'), { recursive: true })
    await writeFile(full, text)
  }
}

const FILES = { 'pak0.pak': 'aaa', 'maps/x.bsp': 'bbb' }

beforeEach(async () => {
  forced.failPath = undefined
  root = await mkdtemp(join(tmpdir(), 'q2l-remove-job-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('startModRemove', () => {
  it('a mod with no install record is refused and nothing is deleted', async () => {
    await seed(FILES)
    const h = harness(record(FILES))
    const started = startModRemove(h.deps, { installationId: 'inst-1', modId: 'other', changedFiles: 'delete' })
    expect(started).toMatchObject({ ok: false, error: { key: 'mods.remove.refused.noRecord' } })
    const preview = await previewModRemoval(h.deps, { installationId: 'inst-1', modId: 'other' })
    expect(preview.ok).toBe(false)
    expect(existsSync(join(root, 'rogue', 'pak0.pak'))).toBe(true)
    expect(h.guardCalls).toEqual([])
  })

  it('nothing is deleted before the write guard grants the lock', async () => {
    await seed(FILES)
    const h = harness(record(FILES), { gate: true })
    const started = startModRemove(h.deps, { installationId: 'inst-1', modId: 'rogue', changedFiles: 'delete' })
    if (!started.ok) throw new Error('expected a started job')
    await new Promise((r) => setTimeout(r, 20))
    expect(existsSync(join(root, 'rogue', 'pak0.pak'))).toBe(true)
    h.release()
    await started.value.settled
    expect(existsSync(join(root, 'rogue', 'pak0.pak'))).toBe(false)
  })

  it('the install record is dropped and the installation revalidated', async () => {
    await seed(FILES)
    const h = harness(record(FILES))
    const started = startModRemove(h.deps, { installationId: 'inst-1', modId: 'rogue', changedFiles: 'delete' })
    if (!started.ok) throw new Error('expected a started job')
    expect(await started.value.settled).toEqual({ status: 'succeeded' })
    expect(readModsState(h.installation.moduleData).records).toEqual([])
    expect((h.installation.moduleData as Record<string, unknown>).other).toBe(1)
    expect(h.validate).toHaveBeenCalledWith('inst-1')
    expect(h.finished[0]).toMatchObject({ status: 'succeeded' })
    expect(existsSync(join(root, 'rogue'))).toBe(false)
  })

  it('a removed active gamedir falls back to the base game with a toast', async () => {
    await seed(FILES)
    const h = harness(record(FILES), { activeGameDir: 'Rogue', revalidatedActive: '' })
    const started = startModRemove(h.deps, { installationId: 'inst-1', modId: 'rogue', changedFiles: 'delete' })
    if (!started.ok) throw new Error('expected a started job')
    await started.value.settled
    expect(h.toasts).toEqual([
      ['info', 'mods.remove.fellBackToBase', { installation: 'My Quake', gameDir: 'rogue' }],
    ])
  })

  it('a partial failure keeps only the remaining files in the record', async () => {
    await seed(FILES)
    const h = harness(record(FILES))
    forced.failPath = 'maps/x.bsp'
    const started = startModRemove(h.deps, { installationId: 'inst-1', modId: 'rogue', changedFiles: 'delete' })
    if (!started.ok) throw new Error('expected a started job')
    const outcome = await started.value.settled
    expect(outcome).toEqual({ status: 'failed', key: 'mods.remove.failed.locked' })
    const files = readModsState(h.installation.moduleData).records[0].files.map((f) => f.path)
    expect(files).toEqual(['maps/x.bsp'])
    expect(h.finished[0].error).toEqual({ key: 'mods.remove.failed.locked', params: { path: 'maps/x.bsp' } })
  })

  it('a second mods job for the same mod is refused', async () => {
    await seed(FILES)
    const h = harness(record(FILES), { gate: true })
    const first = startModRemove(h.deps, { installationId: 'inst-1', modId: 'rogue', changedFiles: 'delete' })
    if (!first.ok) throw new Error('expected a started job')
    const second = startModRemove(h.deps, { installationId: 'inst-1', modId: 'rogue', changedFiles: 'delete' })
    expect(second).toMatchObject({ ok: false, error: { key: 'mods.remove.refused.busy' } })
    h.release()
    await first.value.settled
  })
})
