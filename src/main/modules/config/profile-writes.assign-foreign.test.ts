import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import type { AssignProfileResult } from '@shared/modules/config'
import { renderProfileFile } from '@shared/config/render/render'
import { seedConfigProfiles } from '../../../test-support/config-state'
import { unwrapOk } from '../../../test-support/outcome'
import { installTempDir } from '../../../test-support/temp-dir'
import { pathExists } from '../../lib/fs-utils'
import { installation, profile } from './index.test-helpers'
import { ORIGINAL_CONFIGS_DIR_NAME } from './original-backup'
import { ownedProfileIdFromContent } from './writer'
import { writesHarness, type WritesHarness } from './profile-writes.test-helpers'

const getDir = installTempDir('q2-launcher-assign-foreign-')
let dir: string
beforeEach(() => {
  dir = getDir()
})

const FOREIGN = 'set name "hand written"\nbind mouse2 "+attack"\n'
const AUTOEXEC = 'exec Profile.cfg\n'
const gamePath = (...segments: string[]): string => join(dir, 'baseq2', ...segments)

/** An unassigned profile `p1` ("Profile.cfg") over an installation whose baseq2 holds `existing`. */
async function unassignedProfile(existing: string | null): Promise<WritesHarness> {
  const h = await writesHarness(dir, { installations: [installation({ rootPath: dir })] })
  seedConfigProfiles(h.state, [profile({ assignments: [] })])
  await h.state.settle()
  await mkdir(gamePath(), { recursive: true })
  if (existing !== null) await writeFile(gamePath('Profile.cfg'), existing, 'latin1')
  await writeFile(gamePath('autoexec.cfg'), AUTOEXEC, 'latin1')
  return h
}

const assign = async (h: WritesHarness, overwriteForeign?: boolean): Promise<AssignProfileResult> =>
  unwrapOk<AssignProfileResult>(
    await h.writes.assign({ profileId: 'p1', installationId: 'i1', overwriteForeign }),
  )

describe('assigning over a foreign profile file', () => {
  it('a foreign profile file stops the assignment before anything is written', async () => {
    const h = await unassignedProfile(FOREIGN)

    expect(await assign(h)).toEqual({
      status: 'foreignFile',
      fileName: 'Profile.cfg',
      installationId: 'i1',
    })

    expect(h.profiles.list()[0]!.assignments).toEqual([])
    expect(await readFile(gamePath('Profile.cfg'), 'latin1')).toBe(FOREIGN)
    expect(await readFile(gamePath('autoexec.cfg'), 'latin1')).toBe(AUTOEXEC)
    expect(await pathExists(join(dir, ORIGINAL_CONFIGS_DIR_NAME))).toBe(false)
  })

  it('overwriteForeign backs the foreign file up and assigns', async () => {
    const h = await unassignedProfile(FOREIGN)

    const result = await assign(h, true)

    expect(result.status).toBe('assigned')
    expect(h.profiles.list()[0]!.assignments).toHaveLength(1)
    expect(
      await readFile(join(dir, ORIGINAL_CONFIGS_DIR_NAME, 'baseq2', 'Profile.cfg'), 'latin1'),
    ).toBe(FOREIGN)
    expect(ownedProfileIdFromContent(await readFile(gamePath('Profile.cfg'), 'latin1'))).toBe('p1')
  })

  it('a launcher-stamped file is assigned without asking', async () => {
    const h = await unassignedProfile(renderProfileFile(profile({ id: 'someone-else' })))

    expect((await assign(h)).status).toBe('assigned')

    expect(h.profiles.list()[0]!.assignments).toHaveLength(1)
    expect(ownedProfileIdFromContent(await readFile(gamePath('Profile.cfg'), 'latin1'))).toBe('p1')
  })

  it('an absent file is assigned without asking', async () => {
    const h = await unassignedProfile(null)

    expect((await assign(h)).status).toBe('assigned')

    expect(h.profiles.list()[0]!.assignments).toHaveLength(1)
    expect(await pathExists(gamePath('Profile.cfg'))).toBe(true)
  })

  it('an already-assigned installation is not re-checked', async () => {
    const h = await unassignedProfile(null)
    expect((await assign(h)).status).toBe('assigned')
    await writeFile(gamePath('Profile.cfg'), FOREIGN, 'latin1')

    expect((await assign(h)).status).toBe('assigned')

    expect(await pathExists(join(dir, ORIGINAL_CONFIGS_DIR_NAME, 'baseq2', 'Profile.cfg'))).toBe(
      false,
    )
  })
})
