import { beforeEach, describe, expect, it } from 'vitest'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { renderProfileFile } from '@shared/config/render/render'
import { seedConfigProfiles } from '../../../test-support/config-state'
import { installTempDir } from '../../../test-support/temp-dir'
import { installation, profile } from './index.test-helpers'
import { configState } from './persisted'
import { fakeLog, writesHarness } from './profile-writes.test-helpers'

const getDir = installTempDir('q2-launcher-profile-writes-')
let dir: string
beforeEach(() => {
  dir = getDir()
})

const canonicalPath = (fileName: string): string => join(dir, 'userData', fileName)

describe('profile writes', () => {
  it('never overwrites canonical bytes it has not read', async () => {
    const log = fakeLog()
    const h = await writesHarness(dir, { installations: [installation({ rootPath: dir })], log })
    seedConfigProfiles(h.state, [profile()])
    await h.state.settle()
    await h.writes.save({ profileId: 'p1' })
    const clean = h.profiles.find('p1')!
    expect(clean.dirty).toBe(false)
    expect(clean.fileHash).toBeTypeOf('string')

    // An external edit lands after the launcher last read the file; the profile itself is clean.
    const handEdited = `${await readFile(canonicalPath('Profile.cfg'), 'latin1')}// hand-edited\n`
    await writeFile(canonicalPath('Profile.cfg'), handEdited, 'latin1')

    // What `assign`/`setDefault`/the startup retry sweep run: a sync without `overwriteProfileId`.
    await h.writes.syncAndPersist(h.profiles.find('p1')!, h.profiles.list())

    expect(await readFile(canonicalPath('Profile.cfg'), 'latin1')).toBe(handEdited)
    expect(configState(h.state).writeFailures.get()).toEqual({})
    expect(h.profiles.find('p1')!.fileHash).toBe(clean.fileHash)
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('leaving canonical file'))
  })

  it("only save writes a dirty profile's canonical file", async () => {
    const h = await writesHarness(dir, { installations: [installation({ rootPath: dir })] })
    seedConfigProfiles(h.state, [profile()])
    await h.state.settle()
    await h.writes.save({ profileId: 'p1' })
    const savedBytes = await readFile(canonicalPath('Profile.cfg'), 'latin1')

    h.profiles.setCvars({ profileId: 'p1', cvars: { sensitivity: '9' } })
    h.profiles.setDirty('p1', true)
    await h.writes.syncAndPersist(h.profiles.find('p1')!, h.profiles.list())

    expect(await readFile(canonicalPath('Profile.cfg'), 'latin1')).toBe(savedBytes)
    expect(h.profiles.find('p1')!.dirty).toBe(true)

    const result = await h.writes.save({ profileId: 'p1' })

    if (!result.ok || result.value.status !== 'saved') throw new Error('expected save to succeed')
    const written = await readFile(canonicalPath('Profile.cfg'), 'latin1')
    expect(written).toBe(renderProfileFile(result.value.profile))
    expect(written).not.toBe(savedBytes)
    expect(h.profiles.find('p1')!.dirty).toBe(false)
  })

  it('the service runs a save on injected deps alone', async () => {
    const log = fakeLog()
    const h = await writesHarness(dir, { log })
    seedConfigProfiles(h.state, [profile({ assignments: [] })])
    await h.state.settle()

    const result = await h.writes.save({ profileId: 'p1' })

    if (!result.ok || result.value.status !== 'saved') throw new Error('expected save to succeed')
    expect(await readFile(join(h.canonicalDir, 'Profile.cfg'), 'latin1')).toBe(
      renderProfileFile(result.value.profile),
    )
    expect(result.value.sync.own.status).toBe('inSync')
    expect(log.error).not.toHaveBeenCalled()
  })

  it('never re-renders the bytes a raw save wrote', async () => {
    const h = await writesHarness(dir, { installations: [installation({ rootPath: dir })] })
    seedConfigProfiles(h.state, [profile()])
    await h.state.settle()
    await h.writes.save({ profileId: 'p1' })
    const onDisk = await readFile(canonicalPath('Profile.cfg'), 'latin1')
    // Hand formatting is not a render fixed point: a cascade that re-rendered would change these.
    const typed = `${onDisk}	set q2l_typed_raw   "1"   
`

    const result = await h.writes.saveRawText({ profileId: 'p1', text: typed })

    if (!result.ok || result.value.status !== 'saved') throw new Error('expected a raw save')
    expect(await readFile(canonicalPath('Profile.cfg'), 'latin1')).toBe(typed)
    expect(await readFile(join(dir, 'baseq2', 'Profile.cfg'), 'latin1')).toBe(typed)
  })
})
