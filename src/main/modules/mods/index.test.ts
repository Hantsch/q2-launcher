import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MODS_HANDLERS, type ModsListResult } from '@shared/modules/mods'
import type { Outcome } from '@shared/types'
import type { AppContext } from '../../context'
import { MainModuleRegistry } from '../registry'
import { modsModule } from './index'

const openPath = vi.hoisted(() => vi.fn<(p: string) => Promise<string>>())

vi.mock('electron', () => ({
  app: { getPath: () => '' },
  shell: { openPath },
}))

const ROOT = join('games', 'q2')

function installation(gameDirs: string[], moduleData?: Record<string, unknown>) {
  return { id: 'inst-1', rootPath: ROOT, gameDirs, moduleData }
}

async function registryFor(inst: ReturnType<typeof installation>) {
  const app = {
    isDev: false,
    installations: { find: (id: string) => (id === inst.id ? inst : undefined) },
    broadcast: { emit: () => {} },
  } as unknown as AppContext
  const registry = new MainModuleRegistry()
  await registry.register(modsModule, app)
  return registry
}

/** The registry wraps a handler's result in its own `{ ok, value }` envelope; unwrap to the module's Outcome. */
async function unwrap<T>(p: Promise<unknown>): Promise<Outcome<T>> {
  const envelope = (await p) as { ok: true; value: Outcome<T> }
  expect(envelope.ok).toBe(true)
  return envelope.value
}
const list = (r: MainModuleRegistry, installationId = 'inst-1') =>
  unwrap<ModsListResult>(
    r.invoke({ moduleId: 'mods', type: MODS_HANDLERS.list, payload: { installationId } }),
  )
const reveal = (r: MainModuleRegistry, gameDir: string, installationId = 'inst-1') =>
  unwrap<null>(
    r.invoke({ moduleId: 'mods', type: MODS_HANDLERS.reveal, payload: { installationId, gameDir } }),
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
    expect(outcome.ok && outcome.value.gameDirs.find((d) => d.gameDir === 'rogue')?.origin).toBe('manual')
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
})
