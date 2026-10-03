import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ConfigProfile } from '@shared/modules/config'
import { fail, type Outcome } from '@shared/types'
import { diffProfileAgainstBaseline } from '@shared/config/profile-diff'
import { pathExists } from '../../lib/fs-utils'
import { seedConfigProfiles } from '../../../test-support/config-state'
import { installTempDir } from '../../../test-support/temp-dir'
import { installation, profile } from './index.test-helpers'
import {
  markUnsaved,
  profileRecord,
  writesHarness,
  type WritesHarness,
} from './profile-writes.test-helpers'
import { ownedProfileIdFromContent, writeTargetFile } from './writer'

const getDir = installTempDir('q2-launcher-profile-writes-commit-cvars-')
let dir: string
beforeEach(() => {
  dir = getDir()
})

describe('commit cvars', () => {
  const canonicalPath = (fileName: string): string => join(dir, 'userData', fileName)
  const copyPath = (fileName: string): string => join(dir, 'baseq2', fileName)
  const ADDRESS = '203.0.113.7:27910'

  async function harness(withInstallation = true): Promise<WritesHarness> {
    const h = await writesHarness(dir, {
      installations: withInstallation ? [installation({ rootPath: dir })] : [],
      // Delegates to the real writer; a test fails one call with `mockRejectedValueOnce`.
      writeTargetFile: vi.fn(writeTargetFile),
    })
    seedConfigProfiles(h.state, [profile(withInstallation ? {} : { assignments: [] })])
    await h.state.settle()
    return h
  }

  async function commit(
    h: WritesHarness,
    cvars: Record<string, string> = { adr0: ADDRESS },
  ): Promise<Outcome<ConfigProfile>> {
    return h.writes.commitCvars({ profileId: 'p1', cvars })
  }

  it('a clean profile gets the cvar on disk and in its installation copy and stays clean', async () => {
    const h = await harness()
    await h.writes.save({ profileId: 'p1' })

    const result = await commit(h)

    if (!result.ok) throw new Error(`expected the commit to succeed, got ${result.error}`)
    expect(result.value.cvars.adr0).toBe(ADDRESS)
    const onDisk = await readFile(canonicalPath('Profile.cfg'), 'latin1')
    expect(onDisk).toContain('adr0')
    expect(onDisk).toContain(ADDRESS)
    expect(await readFile(copyPath('Profile.cfg'), 'latin1')).toBe(onDisk)

    const committed = profileRecord(h)
    expect(committed.dirty).not.toBe(true)
    expect(committed.cvars.adr0).toBe(ADDRESS)
    expect(diffProfileAgainstBaseline(committed).count).toBe(0)
    // The launcher's own commit is not later mistaken for an external edit: a save goes through.
    const again = await h.writes.save({ profileId: 'p1' })
    if (!again.ok) throw new Error('expected the follow-up save to answer')
    expect(again.value.status).toBe('saved')
  })

  it('a dirty profile writes only the committed cvar: pending cvar and bind edits stay off disk and stay unsaved', async () => {
    const h = await harness()
    await h.writes.save({ profileId: 'p1' })
    h.profiles.setCvars({ profileId: 'p1', cvars: { sensitivity: '9.25' } })
    markUnsaved(h)
    h.profiles.setBinds({ profileId: 'p1', binds: { F5: 'say pendingbind' } })
    markUnsaved(h)

    const result = await commit(h)

    if (!result.ok) throw new Error(`expected the commit to succeed, got ${result.error}`)
    for (const path of [canonicalPath('Profile.cfg'), copyPath('Profile.cfg')]) {
      const bytes = await readFile(path, 'latin1')
      expect(bytes).toContain('adr0')
      expect(bytes).toContain(ADDRESS)
      expect(bytes).not.toContain('9.25')
      expect(bytes).not.toContain('pendingbind')
    }

    const after = profileRecord(h)
    expect(after.dirty).toBe(true)
    expect(after.cvars.sensitivity).toBe('9.25')
    expect(after.binds.F5).toBe('say pendingbind')
    const diff = diffProfileAgainstBaseline(after)
    expect(diff.count).toBe(2)
    expect(diff.keys.cvars.has('sensitivity')).toBe(true)
    expect(diff.keys.cvars.has('adr0')).toBe(false)
    expect(diff.keys.binds.size).toBe(1)
  })

  it('a canonical file changed on disk is not overwritten and nothing changes', async () => {
    const h = await harness()
    await h.writes.save({ profileId: 'p1' })
    const handEdited = `${await readFile(canonicalPath('Profile.cfg'), 'latin1')}// hand-edited\n`
    await writeFile(canonicalPath('Profile.cfg'), handEdited, 'latin1')
    const before = profileRecord(h)

    const result = await commit(h)

    expect(result).toEqual(fail('config.error.commitConflict'))
    expect(await readFile(canonicalPath('Profile.cfg'), 'latin1')).toBe(handEdited)
    expect(await readFile(copyPath('Profile.cfg'), 'latin1')).not.toContain(ADDRESS)
    expect(profileRecord(h)).toEqual(before)
  })

  it('a write failure leaves the file and the profile record untouched', async () => {
    const h = await harness()
    await h.writes.save({ profileId: 'p1' })
    const fileBefore = await readFile(canonicalPath('Profile.cfg'), 'latin1')
    const before = profileRecord(h)
    vi.mocked(h.deps.writeTargetFile).mockRejectedValueOnce(new Error('disk full'))

    const result = await commit(h)

    expect(result).toEqual(fail('config.error.writeFailed'))
    expect(await readFile(canonicalPath('Profile.cfg'), 'latin1')).toBe(fileBefore)
    expect(await readFile(copyPath('Profile.cfg'), 'latin1')).toBe(fileBefore)
    expect(profileRecord(h)).toEqual(before)
  })

  it('a clean profile without a baseline commits against its live fields and stays clean', async () => {
    const h = await harness()
    expect(profileRecord(h).baseline).toBeUndefined()

    const result = await commit(h)

    if (!result.ok) throw new Error(`expected the commit to succeed, got ${result.error}`)
    const onDisk = await readFile(canonicalPath('Profile.cfg'), 'latin1')
    expect(onDisk).toContain(ADDRESS)
    expect(onDisk).toContain('sensitivity')
    const committed = profileRecord(h)
    expect(committed.dirty).not.toBe(true)
    expect(committed.baseline?.cvars.adr0).toBe(ADDRESS)
    expect(committed.baseline?.cvars.sensitivity).toBe('3')
    expect(diffProfileAgainstBaseline(committed).count).toBe(0)
    // The file is exactly the live render: a plain save rewrites the same bytes.
    const again = await h.writes.save({ profileId: 'p1' })
    if (!again.ok) throw new Error('expected the follow-up save to answer')
    expect(await readFile(canonicalPath('Profile.cfg'), 'latin1')).toBe(onDisk)
  })

  it('a dirty profile without a baseline is refused', async () => {
    const h = await writesHarness(dir, { installations: [installation({ rootPath: dir })] })
    seedConfigProfiles(h.state, [profile({ dirty: true })])
    await h.state.settle()
    const before = profileRecord(h)

    const result = await commit(h)

    expect(result).toEqual(fail('config.error.commitNeedsSave'))
    expect(await pathExists(canonicalPath('Profile.cfg'))).toBe(false)
    expect(profileRecord(h)).toEqual(before)
  })

  it('a dirty rename writes to the file the profile still owns, not to a new name', async () => {
    const h = await harness(false)
    await h.writes.save({ profileId: 'p1' })
    h.profiles.rename({ id: 'p1', name: 'Renamed' })
    markUnsaved(h)

    const result = await commit(h)

    if (!result.ok) throw new Error(`expected the commit to succeed, got ${result.error}`)
    const owned = await readFile(canonicalPath('Profile.cfg'), 'latin1')
    expect(ownedProfileIdFromContent(owned)).toBe('p1')
    expect(owned).toContain(ADDRESS)
    // The pending rename is not in the file either - it is still the user's to save.
    expect(owned).not.toContain('Renamed')
    expect(await pathExists(canonicalPath('Renamed.cfg'))).toBe(false)
    expect(profileRecord(h).dirty).toBe(true)
    expect(profileRecord(h).name).toBe('Renamed')
  })
})
