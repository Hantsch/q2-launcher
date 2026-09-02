import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { bindValueFor } from '@shared/config/action-mirror'
import { resolveProfileFileNames } from '@shared/config/profile-files'
import { OWNERSHIP_MARKER, renderProfileFile, sentinelLine } from '@shared/config/render'
import type { ConfigProfile } from '@shared/modules/config'
import { scopedLogger } from '../../lib/logger'
import { StateStore } from '../../services/state'
import { BACKUP_SUFFIX } from './backup'
import { writeCanonicalProfileFile } from './canonical'
import { hashCanonicalFileContent, readFileState } from './file-source'
import { ProfilesStore } from './profiles'
import {
  detectSectionHeaderStyle,
  detectWriteUnbindall,
  recoverProfileName,
  runFileSourceStartup,
  type FileSourceStartupDeps,
} from './rebuild'

/**
 * Story 043 D3. Everything below runs against a real temp directory and a real, temp-file-backed
 * `StateStore` + `ProfilesStore` - the same precedent `profiles.test.ts` and `index.test.ts` set -
 * rather than a faked store, because the whole point of this deliverable is that a rebuilt record
 * goes through the *same* persistence path a normally-created one does. Nothing here boots
 * `configModule.setup()`; `runFileSourceStartup` takes plain callbacks for exactly that reason.
 */

const log = scopedLogger('config-rebuild-test')

/** Fixed epoch ms, so `fileSeenAt`/the migration guard are assertable literals. */
const NOW = Date.parse('2026-08-23T10:00:00.000Z')

let dir: string
let state: StateStore
let profiles: ProfilesStore

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'q2-launcher-rebuild-'))
  await mkdir(join(dir, 'userData'), { recursive: true })
  state = new StateStore(join(dir, 'state.json'))
  await state.load()
  profiles = new ProfilesStore(state)
})

afterEach(async () => {
  await state.settle()
  await rm(dir, { recursive: true, force: true })
})

/** The canonical directory - deliberately a *different* directory from the one `state.json` sits
 * in for these tests, so an assertion about "no file was created/deleted here" cannot be confused
 * by `state.json`/`state.json.bak`. */
function canonicalDir(): string {
  return join(dir, 'userData')
}

function deps(overrides: Partial<FileSourceStartupDeps> = {}): FileSourceStartupDeps {
  return {
    baseDir: canonicalDir(),
    listProfiles: () => profiles.list(),
    replaceProfile: (profile) => void profiles.replaceProfile(profile),
    addProfile: (profile) => void profiles.addRebuilt(profile),
    migratedAt: () => state.configFileSourceMigratedAt(),
    setMigratedAt: (at) => void state.setConfigFileSourceMigratedAt(at),
    log,
    now: () => NOW,
    ...overrides,
  }
}

/** Creates a profile through the normal store path and writes its canonical file the way a save
 * would, i.e. the state a real installation is in before anything below runs. */
async function seedProfileWithFile(
  name: string,
  edit: (profile: ConfigProfile) => ConfigProfile = (profile) => profile,
): Promise<ConfigProfile> {
  const created = profiles.create({ name, from: 'template' })
  const seeded = edit(created[created.length - 1]!)
  const list = profiles.replaceProfile(seeded)
  const profile = list.find((p) => p.id === seeded.id)!
  const fileName = resolveProfileFileNames(list).get(profile.id)!
  await writeCanonicalProfileFile(canonicalDir(), profile, fileName)
  return profile
}

async function fileNamesInCanonicalDir(): Promise<string[]> {
  return (await readdir(canonicalDir())).sort()
}

// ---------------------------------------------------------------------------
// Rebuild-on-missing-record (AC2)
// ---------------------------------------------------------------------------

describe('runFileSourceStartup: rebuilding a lost record', () => {
  it('rebuilds a profile whose record was deleted from state.json, keeping the sentinel id', async () => {
    const original = await seedProfileWithFile('Frag Setup')
    // "Deleting the profile's record from state.json" - the store is left with no record at all,
    // exactly what a hand-deleted (or dropped-because-unparseable) row leaves behind.
    state.setConfigProfiles([])
    expect(profiles.list()).toEqual([])

    const report = await runFileSourceStartup(deps())

    expect(report.rebuiltProfileIds).toEqual([original.id])
    const rebuilt = profiles.list()
    expect(rebuilt).toHaveLength(1)
    expect(rebuilt[0]!.id).toBe(original.id)
    expect(rebuilt[0]!.name).toBe('Frag Setup')
    // Story 048 D3: the file now states every catalogue cvar (D2's always-write), and the rebuild
    // strips the ones sitting at `def.default` back out again - so what comes back is the template's
    // genuine deviations, not the ~30 lines the file physically carries. `m_pitch` is the one
    // template value that IS its catalogue default ('0.022'), and a file cannot express the
    // difference between "the user picked the default" and "the writer restated it"; every other
    // template cvar deviates and survives, `volume` because the catalogue does not know it at all.
    expect(rebuilt[0]!.cvars).toEqual({
      sensitivity: '3',
      cl_run: '0',
      crosshair: '0',
      cl_gun: '1',
      volume: '0.7',
    })
    expect(Object.keys(original.cvars).sort()).toEqual(
      ['m_pitch', ...Object.keys(rebuilt[0]!.cvars)].sort(),
    )
    expect(rebuilt[0]!.binds).toEqual(original.binds)
  })

  it('loses the installation assignments and nothing else', async () => {
    const original = await seedProfileWithFile('Assigned', (profile) => ({
      ...profile,
      cvars: { ...profile.cvars, sensitivity: '4.25' },
      assignments: [{ installationId: 'inst-1', isDefault: true }],
    }))
    state.setConfigProfiles([])

    await runFileSourceStartup(deps())

    const rebuilt = profiles.list()[0]!
    expect(rebuilt.assignments).toEqual([])
    expect(rebuilt.cvars.sensitivity).toBe('4.25')
    expect(rebuilt.binds).toEqual(original.binds)
  })

  it('seeds the rebuilt record with the hash of the bytes on disk, so the next read is unchanged', async () => {
    const original = await seedProfileWithFile('Hashed')
    const fileName = resolveProfileFileNames([original]).get(original.id)!
    state.setConfigProfiles([])

    await runFileSourceStartup(deps())

    const rebuilt = profiles.list()[0]!
    expect(rebuilt.fileSeenAt).toBe(NOW)
    expect(rebuilt.dirty).toBe(false)
    expect(rebuilt.fileState).toBe('unchanged')
    const read = await readFileState(canonicalDir(), fileName, rebuilt.fileHash)
    expect(read.state).toBe('unchanged')
  })

  it('keeps the profile-level settings the file records (writeUnbindall off, bracket banners)', async () => {
    const original = await seedProfileWithFile('Styled', (profile) => ({
      ...profile,
      writeUnbindall: false,
      sectionHeaderStyle: 'brackets',
    }))
    state.setConfigProfiles([])

    await runFileSourceStartup(deps())

    const rebuilt = profiles.list()[0]!
    expect(rebuilt.writeUnbindall).toBe(false)
    expect(rebuilt.sectionHeaderStyle).toBe('brackets')
    expect(original.id).toBe(rebuilt.id)
  })

  it('does not adopt a foreign .cfg that carries no ownership marker', async () => {
    await writeFile(
      join(canonicalDir(), 'handmade.cfg'),
      ['// my own config', 'set sensitivity "9"', 'bind x "+attack"'].join('\n'),
      'latin1',
    )

    const report = await runFileSourceStartup(deps())

    expect(report.rebuiltProfileIds).toEqual([])
    expect(profiles.list()).toEqual([])
    // Nothing deleted, nothing rewritten.
    expect(await fileNamesInCanonicalDir()).toEqual(['handmade.cfg'])
  })

  it("does not adopt a .cfg carrying a different tool's ownership marker", async () => {
    await writeFile(
      join(canonicalDir(), 'other-tool.cfg'),
      ['// some-other-launcher profile 1234 - generated', 'set sensitivity "9"'].join('\n'),
      'latin1',
    )

    const report = await runFileSourceStartup(deps())

    expect(report.rebuiltProfileIds).toEqual([])
    expect(profiles.list()).toEqual([])
  })

  it('does not adopt a file whose marker is our word but carries no profile id', async () => {
    // `ownedProfileId` returns null for a marker with no id after it, which is the one shape that
    // is closest to ours and must still be refused - a rebuild with no id has nothing to key on.
    await writeFile(join(canonicalDir(), 'nameless.cfg'), `${OWNERSHIP_MARKER}\nset volume "1"\n`, 'latin1')

    const report = await runFileSourceStartup(deps())

    expect(report.rebuiltProfileIds).toEqual([])
    expect(profiles.list()).toEqual([])
  })

  it('leaves a profile whose record still exists completely alone (no duplicate record)', async () => {
    const original = await seedProfileWithFile('Live')

    const report = await runFileSourceStartup(deps())

    expect(report.rebuiltProfileIds).toEqual([])
    const list = profiles.list()
    expect(list).toHaveLength(1)
    expect(list[0]!.id).toBe(original.id)
  })

  it('reports the file and leaves it on disk when the record cannot be stored', async () => {
    const original = await seedProfileWithFile('Unstorable')
    const fileName = resolveProfileFileNames([original]).get(original.id)!
    state.setConfigProfiles([])

    const report = await runFileSourceStartup(
      deps({
        addProfile: () => {
          throw new Error('store refused')
        },
      }),
    )

    expect(report.rebuiltProfileIds).toEqual([])
    expect(report.ignoredFileNames).toEqual([fileName])
    expect(profiles.list()).toEqual([])
    // Nothing is ever deleted, not even a file whose rebuild failed.
    expect(await fileNamesInCanonicalDir()).toContain(fileName)
  })
})

// ---------------------------------------------------------------------------
// The one-time format migration (AC8)
// ---------------------------------------------------------------------------

describe('runFileSourceStartup: AC8 one-time migration', () => {
  /** A profile whose canonical file is in a pre-043 shape: the old "generated, do not edit"
   * sentinel wording and a stale body. Still recognisably ours (`ownedProfileId` is wording
   * tolerant since D1), so the migration is expected to rewrite it in place with no backup. */
  async function seedProfileWithLegacyFile(name: string): Promise<{ profile: ConfigProfile; fileName: string }> {
    const created = profiles.create({ name, from: 'template' })
    const profile = created[created.length - 1]!
    const fileName = resolveProfileFileNames(created).get(profile.id)!
    await writeFile(
      join(canonicalDir(), fileName),
      [
        `${OWNERSHIP_MARKER} ${profile.id} - generated, do not edit`,
        'set sensitivity "1"',
        'bind w "+forward"',
      ].join('\n') + '\n',
      'latin1',
    )
    return { profile, fileName }
  }

  it('brings every existing profile file to the current format and seeds its fileHash', async () => {
    const first = await seedProfileWithLegacyFile('One')
    const second = await seedProfileWithLegacyFile('Two')
    expect(state.configFileSourceMigratedAt()).toBeNull()

    const report = await runFileSourceStartup(deps())

    expect(report.migration).toBe('completed')
    expect(report.failedProfileIds).toEqual([])
    expect(report.migratedProfileIds).toEqual([first.profile.id, second.profile.id])

    for (const seeded of [first, second]) {
      const stored = profiles.find(seeded.profile.id)!
      const onDisk = await readFile(join(canonicalDir(), seeded.fileName), 'latin1')
      expect(onDisk).toBe(renderProfileFile(stored))
      expect(onDisk.startsWith(sentinelLine(stored.id))).toBe(true)
      expect(stored.fileHash).toBe(hashCanonicalFileContent(onDisk))
      expect(stored.fileSeenAt).toBe(NOW)
      expect(stored.dirty).toBe(false)
      // The seeded hash is the whole point: the launcher's own migration write must not read back
      // as an external edit on the very first refresh.
      expect((await readFileState(canonicalDir(), seeded.fileName, stored.fileHash)).state).toBe(
        'unchanged',
      )
    }
  })

  it('sets the guard and never touches the files again on a second start', async () => {
    const seeded = await seedProfileWithLegacyFile('Once')

    const first = await runFileSourceStartup(deps())
    expect(first.migration).toBe('completed')
    const guard = state.configFileSourceMigratedAt()
    expect(guard).toBe(new Date(NOW).toISOString())

    // A hand-edit made *after* the migration ran. A second run must leave it exactly as it is -
    // this is the assertion a diff-skip alone could not satisfy, so it pins the guard itself and
    // not merely `writeTargetFile`'s "identical content, nothing to do".
    const path = join(canonicalDir(), seeded.fileName)
    const handEdited = `${await readFile(path, 'latin1')}\nset cl_gun "0" // typed by hand\n`
    await writeFile(path, handEdited, 'latin1')
    const before = await stat(path)

    const second = await runFileSourceStartup(deps({ now: () => NOW + 60_000 }))

    expect(second.migration).toBe('skipped')
    expect(second.migratedProfileIds).toEqual([])
    expect(await readFile(path, 'latin1')).toBe(handEdited)
    expect((await stat(path)).mtimeMs).toBe(before.mtimeMs)
    // Write-once: the guard keeps its original value even though the second run had a later clock.
    expect(state.configFileSourceMigratedAt()).toBe(guard)
  })

  it('deletes nothing and creates no backup file while migrating our own file', async () => {
    const seeded = await seedProfileWithLegacyFile('NoBackup')

    await runFileSourceStartup(deps())

    const names = await fileNamesInCanonicalDir()
    expect(names).toContain(seeded.fileName)
    expect(names.filter((name) => name.endsWith(BACKUP_SUFFIX))).toEqual([])
  })

  it('sets the guard on a fresh install with no profiles at all', async () => {
    const report = await runFileSourceStartup(deps())

    expect(report.migration).toBe('completed')
    expect(report.migratedProfileIds).toEqual([])
    expect(state.configFileSourceMigratedAt()).toBe(new Date(NOW).toISOString())
  })

  it('leaves the guard unset when a profile fails to migrate, so the next start retries', async () => {
    const seeded = await seedProfileWithLegacyFile('Blocked')
    // A *live* other profile's canonical file sitting at exactly the name this profile resolves to
    // is the one case `writeCanonicalProfileFile` refuses outright rather than overwriting.
    const squatter = profiles.create({ name: 'Squatter', from: 'empty' })
    const squatterProfile = squatter[squatter.length - 1]!
    await writeFile(
      join(canonicalDir(), seeded.fileName),
      `${sentinelLine(squatterProfile.id)}\nset volume "1"\n`,
      'latin1',
    )
    // ...and this profile's own file elsewhere, so the write is a *rename* into that occupied name.
    await writeFile(
      join(canonicalDir(), 'stale-name.cfg'),
      `${sentinelLine(seeded.profile.id)}\nset volume "1"\n`,
      'latin1',
    )

    const report = await runFileSourceStartup(deps())

    expect(report.failedProfileIds).toContain(seeded.profile.id)
    expect(report.migration).toBe('incomplete')
    expect(state.configFileSourceMigratedAt()).toBeNull()
    // Neither file was clobbered: the blocked profile's own file is still where it was, and the
    // squatter's content survived (its own migration step, later in the same loop, renamed it onto
    // its properly resolved name rather than losing it).
    expect(await readFile(join(canonicalDir(), 'stale-name.cfg'), 'latin1')).toContain(
      seeded.profile.id,
    )
    expect(await readFile(join(canonicalDir(), 'Squatter.cfg'), 'latin1')).toContain(
      squatterProfile.id,
    )
  })

  it('migrates the pre-existing records only - a profile rebuilt in the same run is not rewritten', async () => {
    // A launcher-owned file with a hand-added, unrecognised comment: the rebuild recovers the
    // profile from it, and the migration must not then re-render over it in the same run, which is
    // what would drop that line. This is the ordering guarantee `rebuild.ts` documents.
    const original = await seedProfileWithFile('Rebuilt')
    const fileName = resolveProfileFileNames([original]).get(original.id)!
    const path = join(canonicalDir(), fileName)
    const withComment = `${await readFile(path, 'latin1')}// a line only the file knows about\n`
    await writeFile(path, withComment, 'latin1')
    state.setConfigProfiles([])

    const report = await runFileSourceStartup(deps())

    expect(report.migratedProfileIds).toEqual([])
    expect(report.rebuiltProfileIds).toEqual([original.id])
    expect(await readFile(path, 'latin1')).toBe(withComment)
  })
})

// ---------------------------------------------------------------------------
// The header/format recovery the rebuild leans on
// ---------------------------------------------------------------------------

describe('recoverProfileName', () => {
  it('reads the name a rendered file actually carries, spaces and all', () => {
    const profile: ConfigProfile = {
      id: randomUUID(),
      name: 'My Config (LAN)',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      cvars: { sensitivity: '3' },
      binds: {},
      assignments: [],
    }

    expect(recoverProfileName(renderProfileFile(profile))).toBe('My Config (LAN)')
  })

  it('reads a pre-042 header that carries no [q2l v=...] marker', () => {
    const content = [
      `${OWNERSHIP_MARKER} abc - generated, do not edit`,
      `// ${'='.repeat(77)}`,
      '//  Old Profile',
      '//  Q2 Launcher - generated file, do not edit',
      `// ${'='.repeat(77)}`,
      'set sensitivity "3"',
    ].join('\n')

    expect(recoverProfileName(content)).toBe('Old Profile')
  })

  it('returns null for a file with no header block at all', () => {
    expect(recoverProfileName(`${OWNERSHIP_MARKER} abc\nset sensitivity "3"\n`)).toBeNull()
  })

  it('never adopts the hand-edit sentence as a name when the name line is gone', () => {
    const content = [
      `${OWNERSHIP_MARKER} abc - hand-edited changes are read back`,
      `// ${'='.repeat(77)}`,
      '//  Q2 Launcher - hand-edited changes to this file are read back',
      `// ${'='.repeat(77)}`,
    ].join('\n')

    expect(recoverProfileName(content)).toBeNull()
  })

  it('falls back to the file base name when the header carries nothing usable', async () => {
    const id = randomUUID()
    await writeFile(
      join(canonicalDir(), 'Hand-Named.cfg'),
      `${sentinelLine(id)}\nset sensitivity "3"\n`,
      'latin1',
    )

    await runFileSourceStartup(deps())

    expect(profiles.list()[0]!.name).toBe('Hand-Named')
  })
})

describe('detectWriteUnbindall / detectSectionHeaderStyle', () => {
  it('sees a bare unbindall line and ignores one that is only mentioned', () => {
    expect(detectWriteUnbindall('unbindall\nset volume "1"\n')).toBe(true)
    expect(detectWriteUnbindall('unbindall\r\nset volume "1"\r\n')).toBe(true)
    expect(detectWriteUnbindall('// unbindall\nalias x "unbindall"\n')).toBe(false)
    expect(detectWriteUnbindall('set volume "1"\n')).toBe(false)
  })

  it('recognises each of the three banner styles by its own fixed anchor', () => {
    // A bind an *action* owns, so the file carries a `Binds: <category>` banner - the only anchor
    // `plain` style leaves behind, since plain banners have no decoration at all. `Other binds`
    // (an unowned bind's section) deliberately carries no such prefix.
    const action = {
      id: 'action-1',
      categoryId: 'movement',
      name: 'Forward',
      kind: 'bind' as const,
      commands: [{ kind: 'raw' as const, text: '+forward' }],
      key: 'w',
    }

    for (const style of ['dashes', 'brackets', 'plain'] as const) {
      const profile: ConfigProfile = {
        id: randomUUID(),
        name: 'Styles',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        cvars: { sensitivity: '3' },
        binds: { w: bindValueFor(action) },
        assignments: [],
        actions: [action],
        sectionHeaderStyle: style,
      }
      expect(detectSectionHeaderStyle(renderProfileFile(profile))).toBe(style)
    }
  })

  it('reports no style for a file with no section at all', () => {
    expect(detectSectionHeaderStyle(`${OWNERSHIP_MARKER} abc\nunbindall\n`)).toBeUndefined()
  })
})
