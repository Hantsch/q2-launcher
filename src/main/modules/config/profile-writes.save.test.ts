import { beforeEach, describe, expect, it } from 'vitest'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ConfigProfile } from '@shared/modules/config'
import { renderProfileFile } from '@shared/config/render'
import { pathExists } from '../../lib/fs-utils'
import { seedConfigProfiles } from '../../../test-support/config-state'
import { installTempDir } from '../../../test-support/temp-dir'
import { hashCanonicalFileContent } from './file-source'
import { installation, profile, runningState } from './index.test-helpers'
import { configState } from './persisted'
import { writesHarness, type WritesHarness } from './profile-writes.test-helpers'

const getDir = installTempDir('q2-launcher-profile-writes-save-')
let dir: string
beforeEach(() => {
  dir = getDir()
})

/**
 * Content mutations stop writing and only `save` does, after re-reading the file it is about to
 * overwrite.
 *
 * The failure this block exists to catch is a hand-edit clobbered by a write the launcher made
 * without reading the file first. Everything is asserted on the real temp-dir bytes, never on the
 * return value alone - a report of a write that did not happen, or of a skip that actually wrote,
 * would look identical from the outside.
 */
describe('save', () => {
  const canonicalPath = (fileName: string): string => join(dir, 'userData', fileName)
  const copyPath = (fileName: string): string => join(dir, 'baseq2', fileName)

  /** What the `setCvars` handler does: persist the edit, then mark the profile unsaved. */
  function editCvars(h: WritesHarness, cvars: Record<string, string>): void {
    h.profiles.setCvars({ profileId: 'p1', cvars })
    h.profiles.setDirty('p1', true)
  }

  /** What the `rename` handler does: rename, then mark the profile unsaved. */
  function rename(h: WritesHarness, name: string): void {
    h.profiles.rename({ id: 'p1', name })
    h.profiles.setDirty('p1', true)
  }

  function only(h: WritesHarness, profileId = 'p1'): ConfigProfile {
    return configState(h.state)
      .profiles.get()
      .find((p) => p.id === profileId)!
  }

  it('writes the canonical file and the installation copy, clears dirty and seeds the hash baseline', async () => {
    const h = await writesHarness(dir, { installations: [installation({ rootPath: dir })] })
    seedConfigProfiles(h.state, [profile()])
    await h.state.settle()
    editCvars(h, { sensitivity: '7' })

    const result = await h.writes.save({ profileId: 'p1' })

    if (!result.ok) throw new Error('expected save to succeed')
    if (result.value.status !== 'saved')
      throw new Error(`expected saved, got ${result.value.status}`)
    const expected = renderProfileFile(result.value.profile)
    expect(await readFile(canonicalPath('Profile.cfg'), 'latin1')).toBe(expected)
    // The installation cascade still runs, from the same canonical content.
    expect(await readFile(copyPath('Profile.cfg'), 'latin1')).toBe(expected)
    expect(result.value.sync.own.status).toBe('inSync')

    const saved = only(h)
    expect(saved.dirty).toBe(false)
    // Seeded from exactly the bytes on disk, which is what keeps this write from being read back as
    // an external edit by the very next save.
    expect(saved.fileHash).toBe(hashCanonicalFileContent(expected))
    expect(saved.fileSeenAt).toBeTypeOf('number')

    // Proof of that property: an immediate second save sees `unchanged`, not a conflict.
    const again = await h.writes.save({ profileId: 'p1' })
    if (!again.ok) throw new Error('expected the second save to succeed')
    expect(again.value.status).toBe('saved')
  })

  it('a save while the game runs writes the copy and reads inSync, nothing is persisted as pending', async () => {
    const inst = installation({ rootPath: dir })
    const h = await writesHarness(dir, {
      installations: [inst],
      launchState: runningState(inst.id),
    })
    seedConfigProfiles(h.state, [profile()])
    await h.state.settle()

    const result = await h.writes.save({ profileId: 'p1' })

    if (!result.ok) throw new Error('expected save to succeed')
    if (result.value.status !== 'saved')
      throw new Error(`expected saved, got ${result.value.status}`)
    const expected = renderProfileFile(result.value.profile)
    // A running game defers nothing - the canonical file and the installation copy are written
    // exactly as they would be if the installation were idle.
    expect(await readFile(canonicalPath('Profile.cfg'), 'latin1')).toBe(expected)
    expect(await readFile(copyPath('Profile.cfg'), 'latin1')).toBe(expected)
    expect(result.value.sync.own.status).toBe('inSync')
    expect(result.value.sync.installations).toEqual([
      {
        installationId: 'i1',
        path: copyPath('Profile.cfg'),
        fileName: 'Profile.cfg',
        status: 'inSync',
      },
    ])

    // Nothing is left behind to retry.
    expect(configState(h.state).writeFailures.get()).toEqual({})
  })

  it('refuses to write and reports a whole-file conflict when the file changed underneath', async () => {
    const h = await writesHarness(dir, { installations: [installation({ rootPath: dir })] })
    seedConfigProfiles(h.state, [profile()])
    await h.state.settle()
    await h.writes.save({ profileId: 'p1' })
    const seededHash = only(h).fileHash

    // A hand-edit in Notepad: the launcher's own file, one line appended.
    const handEdited = `${await readFile(canonicalPath('Profile.cfg'), 'latin1')}// hand-edited\n`
    await writeFile(canonicalPath('Profile.cfg'), handEdited, 'latin1')
    editCvars(h, { sensitivity: '9' })

    const result = await h.writes.save({ profileId: 'p1' })

    if (!result.ok) throw new Error('expected save to answer, not fail')
    if (result.value.status !== 'conflict') {
      throw new Error(`expected conflict, got ${result.value.status}`)
    }
    expect(result.value.fileName).toBe('Profile.cfg')
    expect(result.value.diskContent).toBe(handEdited)
    expect(result.value.ourContent).toBe(renderProfileFile(only(h)))
    expect(result.value.ourContent).not.toBe(handEdited)
    // The whole point: nothing was written, and the edits are still recorded as unsaved.
    expect(await readFile(canonicalPath('Profile.cfg'), 'latin1')).toBe(handEdited)
    expect(only(h).dirty).toBe(true)
    expect(only(h).fileHash).toBe(seededHash)
  })

  it('force: true bypasses the conflict, writes our version and clears dirty', async () => {
    const h = await writesHarness(dir, { installations: [installation({ rootPath: dir })] })
    seedConfigProfiles(h.state, [profile()])
    await h.state.settle()
    await h.writes.save({ profileId: 'p1' })

    // A hand-edit in Notepad, plus an unsaved UI edit - the exact conflict shape `save` (without
    // `force`) still refuses, and the shape `ConfigConflictDialog` is built from.
    const handEdited = `${await readFile(canonicalPath('Profile.cfg'), 'latin1')}// hand-edited\n`
    await writeFile(canonicalPath('Profile.cfg'), handEdited, 'latin1')
    editCvars(h, { sensitivity: '9' })

    const ordinary = await h.writes.save({ profileId: 'p1' })
    if (!ordinary.ok || ordinary.value.status !== 'conflict') {
      throw new Error('expected the ordinary save to still refuse')
    }

    const forced = await h.writes.save({ profileId: 'p1', force: true })

    if (!forced.ok) throw new Error('expected the forced save to succeed')
    if (forced.value.status !== 'saved') {
      throw new Error(`expected saved, got ${forced.value.status}`)
    }
    const expected = renderProfileFile(forced.value.profile)
    expect(expected).not.toBe(handEdited)
    expect(await readFile(canonicalPath('Profile.cfg'), 'latin1')).toBe(expected)
    expect(only(h).dirty).toBe(false)
    expect(only(h).fileHash).toBe(hashCanonicalFileContent(expected))
  })

  it('looks the file up by its ownership sentinel, so a rename cannot make a hand-edit invisible', async () => {
    const h = await writesHarness(dir)
    seedConfigProfiles(h.state, [profile({ assignments: [] })])
    await h.state.settle()
    await h.writes.save({ profileId: 'p1' })

    // A rename does not move the file, so the profile's file still sits under its OLD name -
    // exactly where a naive "read the name this profile now resolves to" check would find nothing
    // and conclude it was free to write.
    rename(h, 'Renamed')
    const handEdited = `${await readFile(canonicalPath('Profile.cfg'), 'latin1')}// hand-edited\n`
    await writeFile(canonicalPath('Profile.cfg'), handEdited, 'latin1')

    const result = await h.writes.save({ profileId: 'p1' })

    if (!result.ok) throw new Error('expected save to answer, not fail')
    if (result.value.status !== 'conflict') {
      throw new Error(`expected conflict, got ${result.value.status}`)
    }
    expect(result.value.fileName).toBe('Profile.cfg')
    expect(await readFile(canonicalPath('Profile.cfg'), 'latin1')).toBe(handEdited)
    expect(await pathExists(canonicalPath('Renamed.cfg'))).toBe(false)
  })

  it('saving a renamed profile with nothing changed on disk moves the file to its new name', async () => {
    const h = await writesHarness(dir)
    seedConfigProfiles(h.state, [profile({ assignments: [] })])
    await h.state.settle()
    await h.writes.save({ profileId: 'p1' })
    rename(h, 'Renamed')

    const result = await h.writes.save({ profileId: 'p1' })

    if (!result.ok) throw new Error('expected save to succeed')
    if (result.value.status !== 'saved')
      throw new Error(`expected saved, got ${result.value.status}`)
    expect(await readFile(canonicalPath('Renamed.cfg'), 'latin1')).toBe(
      renderProfileFile(result.value.profile),
    )
    expect(await pathExists(canonicalPath('Profile.cfg'))).toBe(false)
    expect(only(h).dirty).toBe(false)
  })

  it('reports a file it cannot read at all instead of writing over it', async () => {
    const h = await writesHarness(dir)
    seedConfigProfiles(h.state, [profile({ assignments: [] })])
    await h.state.settle()
    // A directory where the canonical file should be: unreadable, and specifically NOT ENOENT - so
    // it must not be treated as "nothing there, free to create".
    await mkdir(canonicalPath('Profile.cfg'), { recursive: true })

    const result = await h.writes.save({ profileId: 'p1' })

    if (!result.ok) throw new Error('expected save to answer, not fail')
    expect(result.value.status).toBe('unreadable')
    if (result.value.status !== 'unreadable') return
    expect(result.value.reason).toBe('readError')
  })

  it('fails with profileNotFound for an unknown id and writes nothing', async () => {
    const h = await writesHarness(dir)
    seedConfigProfiles(h.state, [profile({ assignments: [] })])
    await h.state.settle()

    const result = await h.writes.save({ profileId: 'nope' })

    expect(result).toEqual({ ok: false, error: { key: 'config.error.profileNotFound' } })
    expect(await pathExists(canonicalPath('Profile.cfg'))).toBe(false)
  })
})
