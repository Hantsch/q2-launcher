import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { fail } from '@shared/types'
import type { ConfigProfile } from '@shared/modules/config'
import { seedConfigProfiles } from '../../../test-support/config-state'
import { unwrapOk } from '../../../test-support/outcome'
import { installTempDir } from '../../../test-support/temp-dir'
import { pathExists } from '../../lib/fs-utils'
import { installation, profile, runningState } from './index.test-helpers'
import { ORIGINAL_CONFIGS_DIR_NAME } from './original-backup'
import { writesHarness, type WritesHarness } from './profile-writes.test-helpers'

const getDir = installTempDir('q2-launcher-restore-originals-')
let dir: string
beforeEach(() => {
  dir = getDir()
})

const FOREIGN = 'set name "hand written"\nbind mouse2 "+attack"\n'
const PROFILE_CFG = 'Profile.cfg'
const gamePath = (...segments: string[]): string => join(dir, 'baseq2', ...segments)

/** Profiles assigned to `i1` whose installation already holds a foreign `Profile.cfg`. */
async function managedInstallation(
  options: Parameters<typeof writesHarness>[1] = {},
  profiles: ConfigProfile[] = [profile()],
): Promise<WritesHarness> {
  const h = await writesHarness(dir, {
    installations: [installation({ rootPath: dir })],
    ...options,
  })
  seedConfigProfiles(h.state, profiles)
  await h.state.settle()
  await mkdir(gamePath(), { recursive: true })
  await writeFile(gamePath(PROFILE_CFG), FOREIGN, 'latin1')
  // The first write into the installation is what takes the backup.
  unwrapOk(await h.writes.write({ profileId: 'p1', installationId: 'i1' }))
  return h
}

describe('restoring an installation to its original configs', () => {
  it('restore unassigns every profile from the installation', async () => {
    const second = profile({
      id: 'p2',
      name: 'Second',
      assignments: [{ installationId: 'i1', isDefault: false }],
    })
    const h = await managedInstallation({}, [profile(), second])
    expect(h.profiles.list().filter((p) => p.assignments.length > 0)).toHaveLength(2)
    expect(await readFile(gamePath(PROFILE_CFG), 'latin1')).not.toBe(FOREIGN)
    await writeFile(gamePath('autoexec.cfg'), 'exec Profile.cfg\n', 'latin1')

    const list = unwrapOk<ConfigProfile[]>(
      await h.writes.restoreOriginalConfigs({ installationId: 'i1' }),
    )

    expect(list).toHaveLength(2)
    expect(list.flatMap((p) => p.assignments)).toEqual([])
    expect(h.profiles.list().flatMap((p) => p.assignments)).toEqual([])
    expect(await readFile(gamePath(PROFILE_CFG), 'latin1')).toBe(FOREIGN)
    expect(await pathExists(join(dir, ORIGINAL_CONFIGS_DIR_NAME))).toBe(false)
  })

  it('restore removes the config the launcher created where there was no original', async () => {
    const h = await writesHarness(dir, { installations: [installation({ rootPath: dir })] })
    seedConfigProfiles(h.state, [profile()])
    await h.state.settle()
    unwrapOk(await h.writes.write({ profileId: 'p1', installationId: 'i1' }))
    expect(await pathExists(gamePath(PROFILE_CFG))).toBe(true)

    unwrapOk(await h.writes.restoreOriginalConfigs({ installationId: 'i1' }))

    expect(await pathExists(gamePath(PROFILE_CFG))).toBe(false)
  })

  it('restore is refused while the installation runs and touches nothing', async () => {
    const h = await managedInstallation({ launchState: runningState('i1') })
    const written = await readFile(gamePath(PROFILE_CFG), 'latin1')

    const outcome = await h.writes.restoreOriginalConfigs({ installationId: 'i1' })

    expect(outcome).toEqual(fail('config.error.installationRunning'))
    expect(h.profiles.list()[0]!.assignments).toHaveLength(1)
    expect(await readFile(gamePath(PROFILE_CFG), 'latin1')).toBe(written)
    expect(await pathExists(join(dir, ORIGINAL_CONFIGS_DIR_NAME, 'manifest.json'))).toBe(true)
  })

  it('restore without a backup fails and keeps the assignments', async () => {
    const h = await writesHarness(dir, { installations: [installation({ rootPath: dir })] })
    seedConfigProfiles(h.state, [profile()])
    await h.state.settle()

    const outcome = await h.writes.restoreOriginalConfigs({ installationId: 'i1' })

    expect(outcome).toEqual(fail('config.error.noOriginalBackup'))
    expect(h.profiles.list()[0]!.assignments).toHaveLength(1)
  })

  it('restore with an unreadable backup touches neither files nor assignments', async () => {
    const h = await managedInstallation()
    await writeFile(join(dir, ORIGINAL_CONFIGS_DIR_NAME, 'manifest.json'), '{ not json', 'utf8')
    const written = await readFile(gamePath(PROFILE_CFG), 'latin1')

    const outcome = await h.writes.restoreOriginalConfigs({ installationId: 'i1' })

    expect(outcome).toEqual(fail('config.error.originalBackupInvalid'))
    expect(h.profiles.list()[0]!.assignments).toHaveLength(1)
    expect(await readFile(gamePath(PROFILE_CFG), 'latin1')).toBe(written)
  })

  it('restore of an unknown installation is refused', async () => {
    const h = await writesHarness(dir)

    expect(await h.writes.restoreOriginalConfigs({ installationId: 'nope' })).toEqual(
      fail('installations.error.notFound'),
    )
  })

  it('list returns only installations with a backup', async () => {
    const other = join(dir, 'other')
    const broken = join(dir, 'broken')
    await mkdir(join(broken, ORIGINAL_CONFIGS_DIR_NAME), { recursive: true })
    await writeFile(join(broken, ORIGINAL_CONFIGS_DIR_NAME, 'manifest.json'), 'nope', 'utf8')
    await mkdir(other, { recursive: true })
    const h = await writesHarness(dir, {
      installations: [
        installation({ id: 'i1', rootPath: dir }),
        installation({ id: 'i2', rootPath: other }),
        installation({ id: 'i3', rootPath: broken }),
      ],
    })
    seedConfigProfiles(h.state, [profile()])
    await h.state.settle()
    unwrapOk(await h.writes.write({ profileId: 'p1', installationId: 'i1' }))

    expect(unwrapOk<string[]>(await h.writes.listOriginalConfigs())).toEqual(['i1'])
  })
})
