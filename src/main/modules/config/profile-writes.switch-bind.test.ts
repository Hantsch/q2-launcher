import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fail, ok } from '@shared/types'
import { pathExists } from '../../lib/fs-utils'
import { seedConfigProfiles } from '../../../test-support/config-state'
import { installTempDir } from '../../../test-support/temp-dir'
import { installation, profile } from './index.test-helpers'
import { configState } from './persisted'
import {
  markUnsaved,
  profileRecord,
  writesHarness,
  type WritesHarness,
} from './profile-writes.test-helpers'
import { LOADER_FILE_NAME, writeTargetFile } from './writer'

const getDir = installTempDir('q2-launcher-profile-writes-switch-bind-')
let dir: string
beforeEach(() => {
  dir = getDir()
})

describe('switch bind', () => {
  const canonicalPath = (fileName: string): string => join(dir, 'userData', fileName)
  const copyPath = (fileName: string): string => join(dir, 'baseq2', fileName)
  const loaderPath = (): string => copyPath(LOADER_FILE_NAME)

  async function harness(
    withInstallation = true,
    second?: { id: string; name: string },
  ): Promise<WritesHarness> {
    const h = await writesHarness(dir, {
      installations: [installation({ rootPath: dir })],
      // Delegates to the real writer; a test fails one call with `mockRejectedValueOnce`.
      writeTargetFile: vi.fn(writeTargetFile),
    })
    const assignments = withInstallation ? [{ installationId: 'i1', isDefault: true }] : []
    seedConfigProfiles(h.state, [
      profile({ assignments }),
      ...(second
        ? [profile({ ...second, assignments: [{ installationId: 'i1', isDefault: false }] })]
        : []),
    ])
    await h.state.settle()
    return h
  }

  const switchBinds = (h: WritesHarness): Record<string, string> =>
    configState(h.state).switchBinds.get()

  it('a switch bind leaves unsaved edits off disk', async () => {
    const h = await harness(true, { id: 'p2', name: 'Second' })
    await h.writes.save({ profileId: 'p1' })
    await h.writes.save({ profileId: 'p2' })
    const savedBytes = await readFile(canonicalPath('Profile.cfg'), 'latin1')
    h.profiles.setCvars({ profileId: 'p1', cvars: { sensitivity: '9.25' } })
    markUnsaved(h)

    const result = await h.writes.setSwitchBind({ installationId: 'i1', key: 'F9' })

    expect(result).toEqual(ok({ i1: 'F9' }))
    expect(switchBinds(h)).toEqual({ i1: 'F9' })
    expect(await readFile(canonicalPath('Profile.cfg'), 'latin1')).toBe(savedBytes)
    expect(await readFile(copyPath('Profile.cfg'), 'latin1')).toBe(savedBytes)
    const loader = await readFile(loaderPath(), 'latin1')
    expect(loader).toContain('F9')
    expect(loader).toContain('Second.cfg')
    const after = profileRecord(h)
    expect(after.dirty).toBe(true)
    expect(after.cvars.sensitivity).toBe('9.25')
  })

  it('a switch bind on an externally edited profile is refused and stores nothing', async () => {
    const h = await harness()
    await h.writes.save({ profileId: 'p1' })
    const loaderBefore = await readFile(loaderPath(), 'latin1')
    const handEdited = `${await readFile(canonicalPath('Profile.cfg'), 'latin1')}// hand-edited\n`
    await writeFile(canonicalPath('Profile.cfg'), handEdited, 'latin1')

    const result = await h.writes.setSwitchBind({ installationId: 'i1', key: 'F9' })

    expect(result).toEqual(fail('config.error.commitConflict'))
    expect(switchBinds(h)).toEqual({})
    expect(await readFile(canonicalPath('Profile.cfg'), 'latin1')).toBe(handEdited)
    expect(await readFile(copyPath('Profile.cfg'), 'latin1')).not.toContain('hand-edited')
    expect(await readFile(loaderPath(), 'latin1')).toBe(loaderBefore)
  })

  it('a switch bind with no default profile only stores the bind', async () => {
    const h = await harness(false)

    const result = await h.writes.setSwitchBind({ installationId: 'i1', key: 'F9' })

    expect(result).toEqual(ok({ i1: 'F9' }))
    expect(switchBinds(h)).toEqual({ i1: 'F9' })
    expect(h.deps.writeTargetFile).not.toHaveBeenCalled()
    expect(await pathExists(loaderPath())).toBe(false)
  })

  it('a switch bind whose loader write fails is reported, not swallowed', async () => {
    const h = await harness()
    await h.writes.save({ profileId: 'p1' })
    // A directory where the loader goes makes the installation write throw on every platform.
    await rm(loaderPath())
    await mkdir(loaderPath())

    const result = await h.writes.setSwitchBind({ installationId: 'i1', key: 'F9' })

    expect(result).toEqual(fail('config.error.writeFailed'))
    expect(configState(h.state).writeFailures.get()['p1|i1']?.messageKey).toBe(
      'config.error.writeFailed',
    )
  })
})
