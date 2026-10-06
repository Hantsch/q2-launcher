import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MODS_HANDLERS, type ModInstallChoice, type ModsListResult } from '@shared/modules/mods'
import { ok, type Outcome } from '@shared/types'
import type { AppContext } from '../../context'
import { resolveUiHarness } from '../../lib/ui-harness'
import { PersistenceRegistry } from '../../services/persistence'
import { MainModuleRegistry } from '../registry'
import { modsModule } from './index'
import { startModInstall } from './install-job'
import { previewModUpdate, startModUpdate } from './update-job'

vi.mock('./install-job', () => ({ startModInstall: vi.fn() }))
vi.mock('./update-job', () => ({ previewModUpdate: vi.fn(), startModUpdate: vi.fn() }))

const catalogGet = vi.hoisted(() => vi.fn())
const stagePackage = vi.hoisted(() => vi.fn())
vi.mock('./catalog-service', () => ({
  CatalogService: class {
    getCatalog = catalogGet
  },
}))
vi.mock('../../services/package-staging', () => ({
  stagePackage,
  resolveVendoredExtractor: (_isPackaged: boolean) => ({ path: '', exists: false }),
}))

// The cache services resolve their file under `userDataDir()`; point it at a harmless relative path.
vi.mock('../../lib/paths', () => ({ userDataDir: () => '' }))

const openPath = vi.fn<(p: string) => Promise<string>>()

const ROOT = join('games', 'q2')

function installation(gameDirs: string[], moduleData?: Record<string, unknown>) {
  return { id: 'inst-1', rootPath: ROOT, gameDirs, moduleData }
}

const emitted: unknown[][] = []

async function registryFor(
  inst: ReturnType<typeof installation>,
  manifest: { getManifest: () => Promise<unknown> } = {
    getManifest: async () => ({ packages: [] }),
  },
  installations: unknown = { find: (id: string) => (id === inst.id ? inst : undefined) },
) {
  const app = {
    isDev: false,
    harness: resolveUiHarness({}),
    isPackaged: false,
    userDataDir: '',
    os: { openPath },
    persistence: new PersistenceRegistry(),
    content: { manifest },
    installations,
    broadcast: { emit: (...args: unknown[]) => emitted.push(args) },
  } as unknown as AppContext
  const registry = new MainModuleRegistry()
  await registry.register(modsModule, app)
  return registry
}

/** The registry passes the module's own Outcome through unchanged. */
async function unwrap<T>(p: Promise<unknown>): Promise<Outcome<T>> {
  return (await p) as Outcome<T>
}
const list = (r: MainModuleRegistry, installationId = 'inst-1') =>
  unwrap<ModsListResult>(
    r.invoke({ moduleId: 'mods', type: MODS_HANDLERS.list, payload: { installationId } }),
  )
const reveal = (r: MainModuleRegistry, gameDir: string, installationId = 'inst-1') =>
  unwrap<null>(
    r.invoke({
      moduleId: 'mods',
      type: MODS_HANDLERS.reveal,
      payload: { installationId, gameDir },
    }),
  )

describe('mods module', () => {
  beforeEach(() => {
    openPath.mockReset()
    openPath.mockResolvedValue('')
  })

  it('list refuses an unknown installation id', async () => {
    const r = await registryFor(installation(['rogue']))
    const outcome = await list(r, 'nope')
    expect(outcome).toMatchObject({ ok: false, error: { key: 'mods.error.installationNotFound' } })
  })

  it('reveal refuses an unknown installation id and calls no shell', async () => {
    const r = await registryFor(installation(['rogue']))
    const outcome = await reveal(r, 'rogue', 'nope')
    expect(outcome).toMatchObject({ ok: false, error: { key: 'mods.error.installationNotFound' } })
    expect(openPath).not.toHaveBeenCalled()
  })

  it('reveal refuses a gamedir the installation does not have', async () => {
    const r = await registryFor(installation(['rogue']))
    const outcome = await reveal(r, 'xatrix')
    expect(outcome).toMatchObject({ ok: false, error: { key: 'mods.error.gameDirNotFound' } })
    // baseq2 is never a mod, even though the installation has it
    const r2 = await registryFor(installation(['baseq2', 'rogue']))
    expect(await reveal(r2, 'baseq2')).toMatchObject({ ok: false })
    expect(openPath).not.toHaveBeenCalled()
  })

  it('list returns every game directory except baseq2', async () => {
    const r = await registryFor(installation(['baseq2', 'rogue', 'BaseQ2', 'xatrix']))
    const outcome = await list(r)
    expect(outcome).toEqual({
      ok: true,
      value: {
        installationId: 'inst-1',
        activeInstalls: [],
        gameDirs: [
          { gameDir: 'rogue', folderPath: join(ROOT, 'rogue'), origin: 'manual' },
          { gameDir: 'xatrix', folderPath: join(ROOT, 'xatrix'), origin: 'manual' },
        ],
      },
    })
  })

  it('a game directory without an install record is manual', async () => {
    const r = await registryFor(
      installation(['rogue', 'xatrix'], { mods: { records: [{ gameDir: 'xatrix' }, { bad: 1 }] } }),
    )
    const outcome = await list(r)
    expect(outcome.ok && outcome.value.gameDirs.find((d) => d.gameDir === 'rogue')?.origin).toBe(
      'manual',
    )
  })

  it('a game directory with an install record is catalog', async () => {
    const r = await registryFor(
      installation(['rogue', 'xatrix'], { mods: { records: [{ gameDir: 'XATRIX' }] } }),
    )
    const outcome = await list(r)
    expect(outcome.ok && outcome.value.gameDirs.map((d) => [d.gameDir, d.origin])).toEqual([
      ['rogue', 'manual'],
      ['xatrix', 'catalog'],
    ])
  })

  it('reveal opens the gamedir folder under the installation root', async () => {
    const r = await registryFor(installation(['baseq2', 'Rogue']))
    const outcome = await reveal(r, 'rogue')
    expect(outcome).toEqual({ ok: true, value: null })
    expect(openPath).toHaveBeenCalledTimes(1)
    expect(openPath).toHaveBeenCalledWith(join(ROOT, 'Rogue'))

    openPath.mockResolvedValueOnce('boom')
    expect(await reveal(r, 'rogue')).toMatchObject({
      ok: false,
      error: { key: 'mods.error.revealFailed', params: { message: 'boom' } },
    })
  })

  describe('install', () => {
    const install = (r: MainModuleRegistry, payload: unknown) =>
      unwrap<{ jobId: string }>(
        r.invoke({ moduleId: 'mods', type: MODS_HANDLERS.install, payload }),
      )
    const resolveInstall = (r: MainModuleRegistry, jobId: string, choice: ModInstallChoice) =>
      unwrap<null>(
        r.invoke({
          moduleId: 'mods',
          type: MODS_HANDLERS.resolveInstall,
          payload: { jobId, choice },
        }),
      )

    beforeEach(() => {
      vi.mocked(startModInstall).mockReset()
      emitted.length = 0
    })

    it('install refuses an invalid payload without starting a job', async () => {
      const r = await registryFor(installation(['rogue']))
      for (const payload of [
        {},
        { installationId: '', catalogId: 'rogue' },
        { installationId: 'inst-1', catalogId: '' },
        { installationId: 'inst-1', catalogId: 'rogue', path: 'C:\\evil' },
      ]) {
        const envelope = (await r.invoke({
          moduleId: 'mods',
          type: MODS_HANDLERS.install,
          payload,
        })) as { ok: boolean }
        expect(envelope.ok).toBe(false)
      }
      expect(startModInstall).not.toHaveBeenCalled()
    })

    function startWithDecision(): { answer: Promise<string> | undefined } {
      const state: { answer: Promise<string> | undefined } = { answer: undefined }
      vi.mocked(startModInstall).mockImplementation(async (deps) => {
        state.answer = deps.askDecision('job-1', { folder: 'rogue', conflicts: ['pak0.pak'] })
        return {
          ok: true,
          value: { jobId: 'job-1', settled: new Promise(() => {}) },
        }
      })
      return state
    }

    it('resolveInstall settles the pending decision', async () => {
      const r = await registryFor(installation(['rogue']))
      const state = startWithDecision()
      expect(await install(r, { installationId: 'inst-1', catalogId: 'rogue' })).toEqual({
        ok: true,
        value: { jobId: 'job-1' },
      })
      expect(emitted.some((e) => JSON.stringify(e).includes('"conflicts":["pak0.pak"]'))).toBe(true)
      const listed = await list(r)
      expect(listed.ok && listed.value.activeInstalls).toEqual([
        {
          catalogId: 'rogue',
          jobId: 'job-1',
          decision: { folder: 'rogue', conflicts: ['pak0.pak'] },
        },
      ])

      expect(await resolveInstall(r, 'job-1', 'keep')).toEqual({ ok: true, value: null })
      await expect(state.answer).resolves.toBe('keep')
      // already settled
      expect(await resolveInstall(r, 'job-1', 'keep')).toMatchObject({
        ok: false,
        error: { key: 'mods.error.noPendingDecision' },
      })
    })

    it('resolveInstall with an unknown jobId is refused', async () => {
      const r = await registryFor(installation(['rogue']))
      expect(await resolveInstall(r, 'nope', 'overwrite')).toMatchObject({
        ok: false,
        error: { key: 'mods.error.noPendingDecision' },
      })
    })
  })
})

describe('mods module mapPresence', () => {
  it('refuses an unknown installation id and never takes a root path from the payload', async () => {
    const r = await registryFor(installation(['rogue']))
    const unknown = await unwrap<{ available: boolean }>(
      r.invoke({
        moduleId: 'mods',
        type: MODS_HANDLERS.mapPresence,
        payload: { installationId: 'nope', map: 'q2dm1' },
      }),
    )
    expect(unknown).toMatchObject({ ok: false, error: { key: 'mods.error.installationNotFound' } })

    const withRoot = (await r.invoke({
      moduleId: 'mods',
      type: MODS_HANDLERS.mapPresence,
      payload: { installationId: 'inst-1', map: 'q2dm1', rootPath: '/' },
    })) as { ok: boolean }
    expect(withRoot.ok).toBe(false)
  })
})

describe('mods module update (story 194)', () => {
  const record = (over: Record<string, unknown> = {}) => ({
    catalogId: 'rogue',
    gameDir: 'rogue',
    version: '1.0',
    variantId: 'content-only',
    engineKind: 'r1q2',
    arch: 'x64',
    platform: 'win32',
    contentOnly: true,
    installedAt: 1,
    files: [{ path: 'pak0.pak', sizeBytes: 3, sha256: 'a'.repeat(64) }],
    ...over,
  })
  const invoke = (r: MainModuleRegistry, type: string, payload: unknown) =>
    unwrap<unknown>(r.invoke({ moduleId: 'mods', type, payload }))

  beforeEach(() => {
    vi.mocked(startModUpdate).mockReset()
    vi.mocked(previewModUpdate).mockReset()
    catalogGet.mockReset()
    stagePackage.mockReset()
  })

  it('update refuses a manual mod', async () => {
    const r = await registryFor(installation(['rogue'], { mods: { records: [] } }))
    const payload = { installationId: 'inst-1', catalogId: 'rogue', changedPolicy: 'keep' }
    expect(await invoke(r, MODS_HANDLERS.update, payload)).toMatchObject({
      ok: false,
      error: { key: 'mods.update.refused.noRecord' },
    })
    expect(startModUpdate).not.toHaveBeenCalled()
    expect(
      await invoke(r, MODS_HANDLERS.update, { ...payload, installationId: 'nope' }),
    ).toMatchObject({
      ok: false,
      error: { key: 'mods.error.installationNotFound' },
    })
  })

  it('updatePreview lists changed files', async () => {
    vi.mocked(previewModUpdate).mockResolvedValue({
      ok: true,
      value: {
        installationName: 'Main',
        modName: 'Rogue',
        gameDir: 'rogue',
        installedVersion: '1.0',
        targetVersion: '1.1',
        changedFiles: ['pak0.pak'],
      },
    })
    const r = await registryFor(installation(['rogue'], { mods: { records: [record()] } }))
    expect(
      await invoke(r, MODS_HANDLERS.updatePreview, {
        installationId: 'inst-1',
        catalogId: 'rogue',
      }),
    ).toEqual({
      ok: true,
      value: expect.objectContaining({
        changedFiles: ['pak0.pak'],
        installedVersion: '1.0',
        targetVersion: '1.1',
      }),
    })
  })

  it('the list reports update-available without touching the gamedir', async () => {
    const root = mkdtempSync(join(tmpdir(), 'q2l-mods-'))
    mkdirSync(join(root, 'rogue'))
    mkdirSync(join(root, 'xatrix'))
    const file = join(root, 'rogue', 'pak0.pak')
    writeFileSync(file, 'abc')
    const before = { bytes: readFileSync(file, 'utf8'), mtime: statSync(file).mtimeMs }
    catalogGet.mockResolvedValue({
      status: 'ok',
      entries: [
        { id: 'rogue', pinned: '1.1' },
        { id: 'xatrix', pinned: '2.0' },
      ],
    })
    const inst = {
      ...installation(['rogue', 'xatrix', 'manual'], {
        mods: {
          records: [
            record(),
            record({ catalogId: 'xatrix', gameDir: 'xatrix', version: '2.0', files: [] }),
          ],
        },
      }),
      rootPath: root,
    }
    const r = await registryFor(inst)
    const out = await list(r)
    const dirs = out.ok ? out.value.gameDirs : []
    expect(dirs.find((d) => d.gameDir === 'rogue')).toMatchObject({
      status: 'update-available',
      installedVersion: '1.0',
      pinnedVersion: '1.1',
      contentOnly: true,
    })
    expect(dirs.find((d) => d.gameDir === 'xatrix')?.status).toBeUndefined()
    expect(dirs.find((d) => d.gameDir === 'manual')?.status).toBeUndefined()
    expect(stagePackage).not.toHaveBeenCalled()
    expect(startModUpdate).not.toHaveBeenCalled()
    expect({ bytes: readFileSync(file, 'utf8'), mtime: statSync(file).mtimeMs }).toEqual(before)
  })
})

describe('mods module manifest', () => {
  it("mods reads the app's one ManifestService", async () => {
    const getManifest = vi.fn(async () => ({ packages: [] }))
    vi.mocked(startModInstall).mockReset()
    vi.mocked(startModInstall).mockImplementation(async (deps) => {
      await deps.enginePackages()
      return { ok: false, error: { key: 'mods.error.notFound' } } as never
    })
    const r = await registryFor(installation(['rogue']), { getManifest })
    await r.invoke({
      moduleId: 'mods',
      type: MODS_HANDLERS.install,
      payload: { installationId: 'inst-1', catalogId: 'rogue' },
    })
    expect(getManifest).toHaveBeenCalledTimes(1)
  })
})

describe('mods module persistence', () => {
  it('registers its caches with app.persistence', async () => {
    const labels: string[] = []
    const app = {
      isDev: false,
      harness: resolveUiHarness({}),
      persistence: { register: (label: string) => void labels.push(label) },
      content: { manifest: {} },
      installations: { find: () => undefined },
    } as unknown as AppContext
    await new MainModuleRegistry().register(modsModule, app)
    expect(labels.sort()).toEqual(['mods-catalog'])
  })
})

describe('mods module remembered launch', () => {
  type Inst = ReturnType<typeof installation>

  it('launch.last.remember then get round-trips per installation', async () => {
    const records = [{ catalogId: 'rogue', gameDir: 'rogue' }]
    const store = new Map<string, Inst>([
      ['inst-1', installation(['rogue'], { mods: { records } })],
      ['inst-2', { ...installation(['baseq2']), id: 'inst-2' }],
    ])
    const installations = {
      find: (id: string) => store.get(id),
      setModuleData: (id: string, moduleId: string, value: unknown) => {
        const inst = store.get(id)
        if (!inst) throw new Error(`unknown ${id}`)
        const next = { ...inst, moduleData: { ...inst.moduleData, [moduleId]: value } }
        store.set(id, next)
        return ok(next)
      },
    }
    const r = await registryFor(store.get('inst-1') as Inst, undefined, installations)
    const call = <T>(type: string, payload: unknown) =>
      unwrap<T>(r.invoke({ moduleId: 'mods', type, payload }))
    const get = (installationId: string) => call(MODS_HANDLERS.lastLaunchGet, { installationId })

    expect(await get('inst-1')).toEqual({ ok: true, value: null })
    const one = { gameDir: 'rogue', map: 'rmine1', gameType: 'single' }
    const two = { gameDir: '', map: null, gameType: 'deathmatch' }
    expect(
      await call(MODS_HANDLERS.lastLaunchRemember, { installationId: 'inst-1', ...one }),
    ).toEqual({ ok: true, value: null })
    await call(MODS_HANDLERS.lastLaunchRemember, { installationId: 'inst-2', ...two })

    expect(await get('inst-1')).toEqual({ ok: true, value: one })
    expect(await get('inst-2')).toEqual({ ok: true, value: two })
    // The launcher still knows which mods it installed after remembering a launch.
    expect(store.get('inst-1')?.moduleData?.['mods']).toMatchObject({ records })
    expect(await get('nope')).toMatchObject({
      ok: false,
      error: { key: 'mods.error.installationNotFound' },
    })
    expect(
      await call(MODS_HANDLERS.lastLaunchRemember, { installationId: 'nope', ...one }),
    ).toMatchObject({ ok: false, error: { key: 'mods.error.installationNotFound' } })
  })
})
