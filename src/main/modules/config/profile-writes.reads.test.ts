import { beforeEach, describe, expect, it } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ConfigProfile, RawFilesResult } from '@shared/modules/config'
import type { Installation } from '@shared/types'
import { renderProfileFile } from '@shared/config/render'
import { seedConfigProfiles } from '../../../test-support/config-state'
import { unwrapOk } from '../../../test-support/outcome'
import { installTempDir } from '../../../test-support/temp-dir'
import { installation, profile } from './index.test-helpers'
import { configState } from './persisted'
import { writesHarness, type WritesHarness } from './profile-writes.test-helpers'

const getDir = installTempDir('q2-launcher-profile-writes-reads-')
let dir: string
beforeEach(() => {
  dir = getDir()
})

async function seeded(
  profiles: ConfigProfile[],
  installations: Installation[] = [],
): Promise<WritesHarness> {
  const h = await writesHarness(dir, { installations })
  seedConfigProfiles(h.state, profiles)
  await h.state.settle()
  return h
}

async function rawFiles(h: WritesHarness, profileId = 'p1'): Promise<RawFilesResult> {
  return unwrapOk<RawFilesResult>(await h.writes.rawFiles({ profileId }))
}

describe('rawFiles', () => {
  it('reports canonical onDisk: false for a freshly created, unassigned profile, then true after an explicit save', async () => {
    const h = await seeded([profile({ assignments: [] })])

    const before = await rawFiles(h)
    expect(before.canonical.onDisk).toBe(false)
    expect(before.canonical.content).toBe('')
    expect(before.installations).toEqual([])

    h.profiles.setCvars({ profileId: 'p1', cvars: { sensitivity: '9' } })
    // Only a save puts the file on disk.
    await h.writes.save({ profileId: 'p1' })

    const after = await rawFiles(h)
    expect(after.canonical.onDisk).toBe(true)
    expect(after.canonical.content).toBe(renderProfileFile(h.profiles.find('p1')!))
  })

  it('reports matches: true right after a save, and false once the on-disk copy is edited independently', async () => {
    const inst = installation({ rootPath: dir })
    const h = await seeded([profile()], [inst])
    h.profiles.setCvars({ profileId: 'p1', cvars: { sensitivity: '9' } })
    await h.writes.save({ profileId: 'p1' })

    const inSync = await rawFiles(h)
    expect(inSync.installations).toEqual([
      {
        installationId: inst.id,
        path: join(dir, 'baseq2', 'Profile.cfg'),
        onDisk: true,
        matches: true,
        playedMods: [],
      },
    ])

    await writeFile(join(dir, 'baseq2', 'Profile.cfg'), 'hand-edited\n', 'latin1')

    const outOfSync = await rawFiles(h)
    expect(outOfSync.installations[0]!.onDisk).toBe(true)
    expect(outOfSync.installations[0]!.matches).toBe(false)
  })

  it('reports one entry per assignment', async () => {
    const inst1 = installation({ id: 'i1', rootPath: dir })
    const inst2 = installation({ id: 'i2', rootPath: join(dir, 'inst2') })
    await mkdir(join(inst2.rootPath, 'baseq2'), { recursive: true })
    const h = await seeded(
      [
        profile({
          assignments: [
            { installationId: 'i1', isDefault: true },
            { installationId: 'i2', isDefault: true },
          ],
        }),
      ],
      [inst1, inst2],
    )

    const result = await rawFiles(h)

    expect(result.installations.map((i) => i.installationId).sort()).toEqual(['i1', 'i2'])
  })

  it("echoes the installation's played mods on its entry", async () => {
    const inst = installation({ rootPath: dir, gameDirs: ['baseq2', 'ctf'] })
    const h = await seeded([profile()], [inst])
    configState(h.state).playedMods.update(() => ({ i1: ['ctf'] }))

    const result = await rawFiles(h)

    expect(result.installations).toEqual([
      expect.objectContaining({ installationId: 'i1', playedMods: ['ctf'] }),
    ])
  })

  it('fails with config.error.profileNotFound for an unknown profile id', async () => {
    const h = await seeded([])

    expect(await h.writes.rawFiles({ profileId: 'nope' })).toEqual({
      ok: false,
      error: { key: 'config.error.profileNotFound' },
    })
  })
})
