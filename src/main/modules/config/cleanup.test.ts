import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Installation } from '@shared/types'
import { pathExists } from '../../lib/fs-utils'
import { BACKUP_SUFFIX } from './backup'
import { OWNERSHIP_MARKER } from './render'
import { removeRedundantCopies, restoreRemovedCopies, scanRedundantCopies } from './cleanup'

const HAND_WRITTEN = 'bind mouse2 "+attack"\nset name "player"\n'
const HAND_WRITTEN_VARIANT = 'bind mouse2 "+attack2"\nset name "someone else"\n'
const GENERATED = `${OWNERSHIP_MARKER} p1 - hand-edited changes are read back\nexec q2l-profile-p1.cfg\n`

/**
 * Every path below is built from `dir`, a throwaway temp directory created per
 * test - this suite writes real files, so it must never be able to touch a real
 * installation.
 */
let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'q2-launcher-cleanup-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function installation(overrides: Partial<Installation> = {}): Installation {
  return {
    id: 'test',
    name: 'Test',
    rootPath: dir,
    engineKind: 'r1q2',
    launchArgs: [],
    activeGameDir: '',
    source: 'manual',
    status: 'ok',
    checks: [],
    gameDirs: ['baseq2'],
    favorite: false,
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    totalPlaytimeSeconds: 0,
    ...overrides,
  }
}

async function seed(relativePath: string, content: string): Promise<void> {
  const target = join(dir, relativePath)
  await mkdir(join(target, '..'), { recursive: true })
  await writeFile(target, content, 'latin1')
}

function read(...segments: string[]): Promise<string> {
  return readFile(join(dir, ...segments), 'latin1')
}

function exists(...segments: string[]): Promise<boolean> {
  return pathExists(join(dir, ...segments))
}

describe('scanRedundantCopies', () => {
  it('finds a mod-folder cfg with a byte-identical baseq2 twin', async () => {
    await seed('baseq2/hud.cfg', HAND_WRITTEN)
    await seed('ctf/hud.cfg', HAND_WRITTEN)

    const findings = await scanRedundantCopies(installation({ gameDirs: ['baseq2', 'ctf'] }))

    expect(findings).toEqual([
      { gameDir: 'ctf', fileName: 'hud.cfg', identical: true, size: HAND_WRITTEN.length },
    ])
  })

  it('finds a mod-folder cfg whose baseq2 twin differs, identical: false', async () => {
    await seed('baseq2/hud.cfg', HAND_WRITTEN)
    await seed('ctf/hud.cfg', HAND_WRITTEN_VARIANT)

    const findings = await scanRedundantCopies(installation({ gameDirs: ['baseq2', 'ctf'] }))

    expect(findings).toEqual([
      { gameDir: 'ctf', fileName: 'hud.cfg', identical: false, size: HAND_WRITTEN_VARIANT.length },
    ])
  })

  it('never reports autoexec.cfg, with or without a baseq2 twin', async () => {
    await seed('baseq2/autoexec.cfg', GENERATED)
    await seed('ctf/autoexec.cfg', GENERATED)
    // Different-cased on disk, which real Quake II folders do.
    await seed('xatrix/AUTOEXEC.CFG', HAND_WRITTEN)

    const findings = await scanRedundantCopies(
      installation({ gameDirs: ['baseq2', 'ctf', 'xatrix'] }),
    )

    expect(findings).toEqual([])
  })

  it('never reports a launcher-generated file (ownership marker sentinel)', async () => {
    await seed('baseq2/hud.cfg', HAND_WRITTEN)
    await seed(
      'ctf/hud.cfg',
      `${OWNERSHIP_MARKER} p1 - hand-edited changes are read back\nset sensitivity "3"\n`,
    )

    const findings = await scanRedundantCopies(installation({ gameDirs: ['baseq2', 'ctf'] }))

    expect(findings).toEqual([])
  })

  it('never reports a mod-only cfg with no baseq2 twin', async () => {
    await seed('ctf/ctf-hud.cfg', HAND_WRITTEN)

    const findings = await scanRedundantCopies(installation({ gameDirs: ['baseq2', 'ctf'] }))

    expect(findings).toEqual([])
  })

  it('never reports a cfg living inside a mod folder subdirectory (non-recursive)', async () => {
    await seed('baseq2/hud.cfg', HAND_WRITTEN)
    await seed('ctf/nested/hud.cfg', HAND_WRITTEN)

    const findings = await scanRedundantCopies(installation({ gameDirs: ['baseq2', 'ctf'] }))

    expect(findings).toEqual([])
  })

  it('never scans baseq2 itself as a source of findings', async () => {
    // baseq2 listed as its own gameDir entry (should never happen in practice,
    // but decision 9 says it is never a source even if it is present).
    await seed('baseq2/hud.cfg', HAND_WRITTEN)

    const findings = await scanRedundantCopies(installation({ gameDirs: ['baseq2', 'BASEQ2'] }))

    expect(findings).toEqual([])
  })

  it('ignores a non-.cfg file even with a matching baseq2 name', async () => {
    await seed('baseq2/players.txt', HAND_WRITTEN)
    await seed('ctf/players.txt', HAND_WRITTEN)

    const findings = await scanRedundantCopies(installation({ gameDirs: ['baseq2', 'ctf'] }))

    expect(findings).toEqual([])
  })

  it('ignores a baseq2 "counterpart" that is actually a directory', async () => {
    await mkdir(join(dir, 'baseq2', 'hud.cfg'), { recursive: true })
    await seed('ctf/hud.cfg', HAND_WRITTEN)

    const findings = await scanRedundantCopies(installation({ gameDirs: ['baseq2', 'ctf'] }))

    expect(findings).toEqual([])
  })

  it('returns no findings for an installation with no mod folders beyond baseq2', async () => {
    await seed('baseq2/hud.cfg', HAND_WRITTEN)

    const findings = await scanRedundantCopies(installation({ gameDirs: ['baseq2'] }))

    expect(findings).toEqual([])
  })
})

/** The normal case for the two suites below: `ctf/hud.cfg` duplicates `baseq2/hud.cfg`. */
async function seedRedundantHud(): Promise<Installation> {
  await seed('baseq2/hud.cfg', HAND_WRITTEN)
  await seed('ctf/hud.cfg', HAND_WRITTEN)
  return installation({ gameDirs: ['baseq2', 'ctf'] })
}

describe('removeRedundantCopies', () => {
  it('backs the file up before deleting it, and leaves baseq2 alone', async () => {
    const install = await seedRedundantHud()

    const result = await removeRedundantCopies(install, [{ gameDir: 'ctf', fileName: 'hud.cfg' }])

    expect(result).toEqual({ removed: [{ gameDir: 'ctf', fileName: 'hud.cfg' }], rejected: [] })
    expect(await exists('ctf', 'hud.cfg')).toBe(false)
    // The backup holds the bytes that were on disk a moment ago - had the
    // unlink run first, this file could not exist with this content.
    expect(await read('ctf', `hud.cfg${BACKUP_SUFFIX}`)).toBe(HAND_WRITTEN)
    expect(await read('baseq2', 'hud.cfg')).toBe(HAND_WRITTEN)
    expect(await exists('baseq2', `hud.cfg${BACKUP_SUFFIX}`)).toBe(false)
  })

  it('never clobbers a backup that is already there', async () => {
    // The user's original, backed up by an earlier write-pipeline save. What is
    // in `ctf/hud.cfg` now is a later state of the file - re-copying it over the
    // backup would destroy the only copy of what the user actually wrote.
    await seed('baseq2/hud.cfg', HAND_WRITTEN)
    await seed('ctf/hud.cfg', HAND_WRITTEN_VARIANT)
    await seed(`ctf/hud.cfg${BACKUP_SUFFIX}`, HAND_WRITTEN)
    const install = installation({ gameDirs: ['baseq2', 'ctf'] })

    const result = await removeRedundantCopies(install, [{ gameDir: 'ctf', fileName: 'hud.cfg' }])

    expect(result.removed).toEqual([{ gameDir: 'ctf', fileName: 'hud.cfg' }])
    expect(await read('ctf', `hud.cfg${BACKUP_SUFFIX}`)).toBe(HAND_WRITTEN)
    expect(await exists('ctf', 'hud.cfg')).toBe(false)
  })

  it('removes several entries and reports each one', async () => {
    await seed('baseq2/hud.cfg', HAND_WRITTEN)
    await seed('baseq2/keys.cfg', HAND_WRITTEN)
    await seed('ctf/hud.cfg', HAND_WRITTEN)
    await seed('ctf/keys.cfg', HAND_WRITTEN_VARIANT)
    const install = installation({ gameDirs: ['baseq2', 'ctf'] })

    const result = await removeRedundantCopies(install, [
      { gameDir: 'ctf', fileName: 'hud.cfg' },
      { gameDir: 'ctf', fileName: 'keys.cfg' },
    ])

    expect(result.removed).toEqual([
      { gameDir: 'ctf', fileName: 'hud.cfg' },
      { gameDir: 'ctf', fileName: 'keys.cfg' },
    ])
    expect(result.rejected).toEqual([])
    expect(await read('ctf', `hud.cfg${BACKUP_SUFFIX}`)).toBe(HAND_WRITTEN)
    expect(await read('ctf', `keys.cfg${BACKUP_SUFFIX}`)).toBe(HAND_WRITTEN_VARIANT)
  })

  it('rejects an entry the fresh scan no longer reports, without deleting it', async () => {
    // A real file in a real mod folder, but no baseq2 twin - so it is not a
    // finding and must be structurally undeletable through this call.
    await seed('ctf/ctf-hud.cfg', HAND_WRITTEN)
    const install = installation({ gameDirs: ['baseq2', 'ctf'] })

    const result = await removeRedundantCopies(install, [
      { gameDir: 'ctf', fileName: 'ctf-hud.cfg' },
    ])

    expect(result).toEqual({ removed: [], rejected: [{ gameDir: 'ctf', fileName: 'ctf-hud.cfg' }] })
    expect(await read('ctf', 'ctf-hud.cfg')).toBe(HAND_WRITTEN)
    expect(await exists('ctf', `ctf-hud.cfg${BACKUP_SUFFIX}`)).toBe(false)
  })

  it('rejects autoexec.cfg even though both folders have one', async () => {
    // Story 004's write pipeline puts this there on purpose; the scan excludes
    // it, so the intersection is what keeps it out of the delete path too.
    await seed('baseq2/autoexec.cfg', GENERATED)
    await seed('ctf/autoexec.cfg', GENERATED)
    const install = installation({ gameDirs: ['baseq2', 'ctf'] })

    const result = await removeRedundantCopies(install, [
      { gameDir: 'ctf', fileName: 'autoexec.cfg' },
    ])

    expect(result.removed).toEqual([])
    expect(result.rejected).toEqual([{ gameDir: 'ctf', fileName: 'autoexec.cfg' }])
    expect(await read('ctf', 'autoexec.cfg')).toBe(GENERATED)
  })

  it('rejects a repeated entry rather than unlinking the same file twice', async () => {
    const install = await seedRedundantHud()

    const result = await removeRedundantCopies(install, [
      { gameDir: 'ctf', fileName: 'hud.cfg' },
      { gameDir: 'ctf', fileName: 'hud.cfg' },
    ])

    expect(result.removed).toEqual([{ gameDir: 'ctf', fileName: 'hud.cfg' }])
    expect(result.rejected).toEqual([{ gameDir: 'ctf', fileName: 'hud.cfg' }])
    expect(await read('ctf', `hud.cfg${BACKUP_SUFFIX}`)).toBe(HAND_WRITTEN)
  })

  it('rejects a gamedir the installation does not know', async () => {
    await seed('baseq2/hud.cfg', HAND_WRITTEN)
    await seed('xatrix/hud.cfg', HAND_WRITTEN)
    // xatrix exists on disk but is not one of the installation's gamedirs.
    const install = installation({ gameDirs: ['baseq2', 'ctf'] })

    const result = await removeRedundantCopies(install, [
      { gameDir: 'xatrix', fileName: 'hud.cfg' },
    ])

    expect(result.removed).toEqual([])
    expect(result.rejected).toEqual([{ gameDir: 'xatrix', fileName: 'hud.cfg' }])
    expect(await read('xatrix', 'hud.cfg')).toBe(HAND_WRITTEN)
    expect(await exists('xatrix', `hud.cfg${BACKUP_SUFFIX}`)).toBe(false)
  })

  it('rejects a traversing gamedir even when gameDirs itself carries it', async () => {
    // gameDirs is persisted in state.json and parsed forgivingly, so a
    // hand-edited state file must not be enough to delete outside the install.
    await seed('baseq2/hud.cfg', HAND_WRITTEN)
    const install = installation({ gameDirs: ['baseq2', '..', '.'] })

    const result = await removeRedundantCopies(install, [
      { gameDir: '..', fileName: 'hud.cfg' },
      { gameDir: '.', fileName: 'hud.cfg' },
    ])

    expect(result.removed).toEqual([])
    expect(result.rejected).toEqual([
      { gameDir: '..', fileName: 'hud.cfg' },
      { gameDir: '.', fileName: 'hud.cfg' },
    ])
    // Nothing was created or deleted a level up from the installation root.
    expect(await pathExists(join(dir, '..', 'hud.cfg'))).toBe(false)
    expect(await read('baseq2', 'hud.cfg')).toBe(HAND_WRITTEN)
  })

  it('rejects an absolute-path gamedir even when gameDirs itself carries it', async () => {
    const install = await seedRedundantHud()
    const withAbsolute = installation({
      gameDirs: [...install.gameDirs, 'C:\\Windows', '/etc'],
    })

    const result = await removeRedundantCopies(withAbsolute, [
      { gameDir: 'C:\\Windows', fileName: 'hud.cfg' },
      { gameDir: '/etc', fileName: 'hud.cfg' },
    ])

    expect(result.removed).toEqual([])
    expect(result.rejected).toEqual([
      { gameDir: 'C:\\Windows', fileName: 'hud.cfg' },
      { gameDir: '/etc', fileName: 'hud.cfg' },
    ])
    // The one real finding was never named, so it is still on disk untouched.
    expect(await read('ctf', 'hud.cfg')).toBe(HAND_WRITTEN)
  })

  it('rejects a file name that is not a bare *.cfg name', async () => {
    const install = await seedRedundantHud()
    // Canary one level up from `ctf`, still inside the temp tree: `../hud.cfg`
    // would resolve onto it if the name check were missing.
    await seed('hud.cfg', HAND_WRITTEN_VARIANT)

    const entries = [
      { gameDir: 'ctf', fileName: '../hud.cfg' },
      { gameDir: 'ctf', fileName: '..\\hud.cfg' },
      { gameDir: 'ctf', fileName: 'sub/hud.cfg' },
      { gameDir: 'ctf', fileName: 'hud.txt' },
      { gameDir: 'ctf', fileName: '' },
    ]
    const result = await removeRedundantCopies(install, entries)

    expect(result.removed).toEqual([])
    expect(result.rejected).toEqual(entries)
    expect(await read('hud.cfg')).toBe(HAND_WRITTEN_VARIANT)
    expect(await read('ctf', 'hud.cfg')).toBe(HAND_WRITTEN)
    expect(await exists(`hud.cfg${BACKUP_SUFFIX}`)).toBe(false)
  })

  it('never removes from baseq2, in any casing', async () => {
    await seed('baseq2/hud.cfg', HAND_WRITTEN)
    await seed('ctf/hud.cfg', HAND_WRITTEN)
    // `baseq2` passes gameDirBelongsToInstallation (it is a valid gamedir for
    // the import feature), so the explicit exclusion is what keeps it out.
    const install = installation({ gameDirs: ['baseq2', 'BASEQ2', 'ctf'] })

    const result = await removeRedundantCopies(install, [
      { gameDir: 'baseq2', fileName: 'hud.cfg' },
      { gameDir: 'BASEQ2', fileName: 'hud.cfg' },
    ])

    expect(result.removed).toEqual([])
    expect(result.rejected).toEqual([
      { gameDir: 'baseq2', fileName: 'hud.cfg' },
      { gameDir: 'BASEQ2', fileName: 'hud.cfg' },
    ])
    expect(await read('baseq2', 'hud.cfg')).toBe(HAND_WRITTEN)
    expect(await exists('baseq2', `hud.cfg${BACKUP_SUFFIX}`)).toBe(false)
  })

  it('does nothing at all when every entry is rejected', async () => {
    const install = await seedRedundantHud()

    const result = await removeRedundantCopies(install, [{ gameDir: '..', fileName: 'hud.cfg' }])

    expect(result.removed).toEqual([])
    expect(await read('ctf', 'hud.cfg')).toBe(HAND_WRITTEN)
  })
})

describe('restoreRemovedCopies', () => {
  it('brings the file back byte-for-byte and keeps the backup', async () => {
    const install = await seedRedundantHud()
    const removal = await removeRedundantCopies(install, [{ gameDir: 'ctf', fileName: 'hud.cfg' }])

    const result = await restoreRemovedCopies(install, removal.removed)

    expect(result).toEqual({ restored: [{ gameDir: 'ctf', fileName: 'hud.cfg' }], rejected: [] })
    expect(await read('ctf', 'hud.cfg')).toBe(HAND_WRITTEN)
    // The backup is permanent - undoing the undo has to stay possible.
    expect(await read('ctf', `hud.cfg${BACKUP_SUFFIX}`)).toBe(HAND_WRITTEN)
    // And the restored file is a finding again.
    expect(await scanRedundantCopies(install)).toEqual([
      { gameDir: 'ctf', fileName: 'hud.cfg', identical: true, size: HAND_WRITTEN.length },
    ])
  })

  it('is a no-op when the file reappeared since the removal', async () => {
    const install = await seedRedundantHud()
    await removeRedundantCopies(install, [{ gameDir: 'ctf', fileName: 'hud.cfg' }])
    // Something put a file back at that path - a re-copy, a mod reinstall.
    await seed('ctf/hud.cfg', HAND_WRITTEN_VARIANT)

    const result = await restoreRemovedCopies(install, [{ gameDir: 'ctf', fileName: 'hud.cfg' }])

    expect(result.restored).toEqual([])
    expect(result.rejected).toEqual([{ gameDir: 'ctf', fileName: 'hud.cfg' }])
    expect(await read('ctf', 'hud.cfg')).toBe(HAND_WRITTEN_VARIANT)
    expect(await read('ctf', `hud.cfg${BACKUP_SUFFIX}`)).toBe(HAND_WRITTEN)
  })

  it('rejects an entry that has no backup on disk', async () => {
    const install = await seedRedundantHud()
    await rm(join(dir, 'ctf', 'hud.cfg'))

    const result = await restoreRemovedCopies(install, [{ gameDir: 'ctf', fileName: 'hud.cfg' }])

    expect(result.restored).toEqual([])
    expect(result.rejected).toEqual([{ gameDir: 'ctf', fileName: 'hud.cfg' }])
    expect(await exists('ctf', 'hud.cfg')).toBe(false)
  })

  it('never restores into baseq2, even with a backup sitting there', async () => {
    await seed(`baseq2/hud.cfg${BACKUP_SUFFIX}`, HAND_WRITTEN)
    const install = installation({ gameDirs: ['baseq2', 'BASEQ2', 'ctf'] })

    const result = await restoreRemovedCopies(install, [
      { gameDir: 'baseq2', fileName: 'hud.cfg' },
      { gameDir: 'BASEQ2', fileName: 'hud.cfg' },
    ])

    expect(result.restored).toEqual([])
    expect(result.rejected).toEqual([
      { gameDir: 'baseq2', fileName: 'hud.cfg' },
      { gameDir: 'BASEQ2', fileName: 'hud.cfg' },
    ])
    expect(await exists('baseq2', 'hud.cfg')).toBe(false)
  })

  it('rejects an untrusted gamedir or file name without touching the disk', async () => {
    await seed('baseq2/hud.cfg', HAND_WRITTEN)
    await seed(`ctf/hud.cfg${BACKUP_SUFFIX}`, HAND_WRITTEN)
    const install = installation({ gameDirs: ['baseq2', 'ctf', '..', 'C:\\Windows'] })

    const entries = [
      { gameDir: '..', fileName: 'hud.cfg' },
      { gameDir: 'C:\\Windows', fileName: 'hud.cfg' },
      { gameDir: 'xatrix', fileName: 'hud.cfg' },
      { gameDir: 'ctf', fileName: '../hud.cfg' },
      { gameDir: 'ctf', fileName: 'sub/hud.cfg' },
    ]
    const result = await restoreRemovedCopies(install, entries)

    expect(result.restored).toEqual([])
    expect(result.rejected).toEqual(entries)
    // Nothing was written anywhere: not a level up, not into the mod folder.
    expect(await pathExists(join(dir, '..', 'hud.cfg'))).toBe(false)
    expect(await exists('hud.cfg')).toBe(false)
    expect(await exists('ctf', 'hud.cfg')).toBe(false)
    expect(await exists('xatrix')).toBe(false)
  })
})
