import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderProfileFile } from '@shared/config/render/render'
import type { ConfigProfile } from '@shared/modules/config'
import { installTempDir } from '../../../test-support/temp-dir'
import { seedConfigProfiles } from '../../../test-support/config-state'
import { makeConfigProfile } from '../../../test-support/fixtures'
import { scopedLogger } from '../../lib/logger'
import { StateStore } from '../../services/state'
import { configState } from './persisted'
import { ProfilesStore } from './profiles'
import { runConfigStartup } from './startup'

const log = scopedLogger('config-startup-test')
const FAILURE = { messageKey: 'config.error.writeFailed', at: '2026-01-01T00:00:00.000Z' }

const getDir = installTempDir('q2-launcher-startup-')
let dir: string
let state: StateStore
let profiles: ProfilesStore

beforeEach(async () => {
  dir = getDir()
  await mkdir(join(dir, 'userData'))
  state = new StateStore(join(dir, 'state.json'))
  await state.load()
  profiles = new ProfilesStore(state)
})

function start(
  syncAndPersist: Parameters<typeof runConfigStartup>[0]['syncAndPersist'],
  canonicalBaseDir: () => string = () => join(dir, 'userData'),
): Promise<void> {
  return runConfigStartup({
    profiles,
    config: configState(state),
    canonicalBaseDir,
    syncAndPersist,
    log,
  })
}

function seedWithFailures(list: ConfigProfile[], keys: string[]): void {
  seedConfigProfiles(state, list)
  configState(state).writeFailures.update(() =>
    Object.fromEntries(keys.map((key) => [key, FAILURE])),
  )
}

describe('config startup', () => {
  it('retries every profile with a persisted write failure, one at a time', async () => {
    seedWithFailures(
      [makeConfigProfile({ id: 'p1' }), makeConfigProfile({ id: 'p2', name: 'Second' })],
      ['p1|own', 'p1|inst-1', 'p2|own'],
    )
    let running = 0
    let maxRunning = 0
    const order: string[] = []
    const spy = vi.fn(async (profile: ConfigProfile) => {
      running++
      maxRunning = Math.max(maxRunning, running)
      await new Promise((resolve) => setTimeout(resolve, 5))
      order.push(profile.id)
      running--
      return null
    })

    await start(spy)

    expect(order).toEqual(['p1', 'p2'])
    expect(maxRunning).toBe(1)
  })

  it('skips a write failure whose profile no longer exists', async () => {
    seedWithFailures([], ['ghost|own'])
    const spy = vi.fn(async () => null)

    await start(spy)

    expect(spy).not.toHaveBeenCalled()
    expect(configState(state).writeFailures.get()['ghost|own']).toBeDefined()
  })

  it('a failing file-source startup leaves the module on cached state', async () => {
    seedWithFailures([makeConfigProfile({ id: 'p1' })], ['p1|own'])
    const error = vi.spyOn(log, 'error').mockImplementation(() => {})
    const spy = vi.fn(async () => null)

    await start(spy, () => {
      throw new Error('canonical dir unreadable')
    })

    expect(error).toHaveBeenCalledOnce()
    expect(profiles.list().map((p) => p.id)).toEqual(['p1'])
    expect(spy).toHaveBeenCalledOnce()
    error.mockRestore()
  })

  it('rebuilds a profile from an owned file before resolving', async () => {
    const owned = makeConfigProfile({ id: 'owned-1', name: 'From Disk', assignments: [] })
    seedConfigProfiles(state, [])
    await writeFile(join(dir, 'userData', 'From Disk.cfg'), renderProfileFile(owned), 'latin1')

    await start(vi.fn(async () => null))

    expect(profiles.list().map((p) => p.id)).toEqual(['owned-1'])
  })
})
