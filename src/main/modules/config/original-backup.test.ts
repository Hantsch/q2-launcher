import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { sentinelLine } from '@shared/config/render/render'
import { makeInstallation } from '../../../test-support/fixtures'
import { installTempDir } from '../../../test-support/temp-dir'
import { pathExists } from '../../lib/fs-utils'
import { BACKUP_SUFFIX } from './backup'
import {
  backupOriginals,
  hasOriginalBackup,
  ORIGINAL_CONFIGS_DIR_NAME,
  readManifest,
  restoreOriginals,
} from './original-backup'
import { writeInstallationFiles } from './writer'

const PROFILE_FILE = 'Duel.cfg'
const PROFILE_CONTENT = `${sentinelLine('p1')}\nset sensitivity "3"\n`
const LOADER_CONTENT = `${sentinelLine('p1')}\nexec ${PROFILE_FILE}\n`
const HAND_WRITTEN = 'bind mouse2 "+attack"\nset name "player"\n'
const HAND_EDITED_LATER = 'set name "someone else"\n'

const getDir = installTempDir('q2-launcher-original-backup-')

/** Each test's installation lives one level down, so "outside the root" is still in the temp dir. */
const root = (): string => join(getDir(), 'quake2')

function write(rootPath = root(), playedMods: string[] = []) {
  return writeInstallationFiles({
    installation: makeInstallation({ rootPath, gameDirs: ['baseq2', 'ctf'] }),
    profileFileName: PROFILE_FILE,
    profileFileContent: PROFILE_CONTENT,
    loaderFileContent: LOADER_CONTENT,
    playedMods,
  })
}

async function seed(path: string, content: string | Buffer): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, content)
}

const game = (...segments: string[]): string => join(root(), ...segments)
const backedUp = (...segments: string[]): string =>
  join(root(), ORIGINAL_CONFIGS_DIR_NAME, ...segments)
const text = (path: string): Promise<string> => readFile(path, 'latin1')

async function manifestEntries(rootPath = root()): Promise<unknown> {
  const json = JSON.parse(
    await readFile(join(rootPath, ORIGINAL_CONFIGS_DIR_NAME, 'manifest.json'), 'utf8'),
  ) as { entries: unknown }
  return json.entries
}

describe('original config backup', () => {
  it('backs up every existing target before the first write', async () => {
    await seed(game('baseq2', 'autoexec.cfg'), HAND_WRITTEN)
    await seed(game('baseq2', PROFILE_FILE), HAND_EDITED_LATER)
    await seed(game('ctf', 'autoexec.cfg'), 'set ctf "1"\n')

    await write(root(), ['ctf'])

    expect(await text(backedUp('baseq2', 'autoexec.cfg'))).toBe(HAND_WRITTEN)
    expect(await text(backedUp('baseq2', PROFILE_FILE))).toBe(HAND_EDITED_LATER)
    expect(await text(backedUp('ctf', 'autoexec.cfg'))).toBe('set ctf "1"\n')
    expect(await manifestEntries()).toEqual([
      { path: `baseq2/${PROFILE_FILE}`, kind: 'copied' },
      { path: 'baseq2/autoexec.cfg', kind: 'copied' },
      { path: 'ctf/autoexec.cfg', kind: 'copied' },
    ])
    expect(await text(game('baseq2', 'autoexec.cfg'))).toBe(LOADER_CONTENT)

    // A backup that cannot be made stops the write before any target is touched: here a file
    // sits where the backup folder has to go.
    const blocked = join(getDir(), 'blocked')
    await seed(join(blocked, 'baseq2', 'autoexec.cfg'), HAND_WRITTEN)
    await seed(join(blocked, 'ctf', 'autoexec.cfg'), HAND_WRITTEN)
    await seed(join(blocked, ORIGINAL_CONFIGS_DIR_NAME), 'not a folder')

    await expect(write(blocked, ['ctf'])).rejects.toThrow()

    expect(await text(join(blocked, 'baseq2', 'autoexec.cfg'))).toBe(HAND_WRITTEN)
    expect(await text(join(blocked, 'ctf', 'autoexec.cfg'))).toBe(HAND_WRITTEN)
    expect(await pathExists(join(blocked, 'baseq2', PROFILE_FILE))).toBe(false)
  })

  it('a backup that fails on a later target leaves every target unwritten', async () => {
    await seed(game('baseq2', PROFILE_FILE), HAND_EDITED_LATER)
    await seed(game('baseq2', 'autoexec.cfg'), HAND_WRITTEN)
    // A folder where the second target's copy has to go: the first copy lands, the second cannot.
    await mkdir(backedUp('baseq2', 'autoexec.cfg'), { recursive: true })

    await expect(write()).rejects.toThrow()

    expect(await text(backedUp('baseq2', PROFILE_FILE))).toBe(HAND_EDITED_LATER)
    expect(await text(game('baseq2', PROFILE_FILE))).toBe(HAND_EDITED_LATER)
    expect(await text(game('baseq2', 'autoexec.cfg'))).toBe(HAND_WRITTEN)
    expect(await pathExists(backedUp('manifest.json'))).toBe(false)
  })

  it('concurrent backups on one installation keep every original', async () => {
    await seed(game('baseq2', 'autoexec.cfg'), HAND_WRITTEN)
    await seed(game('ctf', 'autoexec.cfg'), HAND_EDITED_LATER)

    await Promise.all([
      backupOriginals(root(), [game('baseq2', 'autoexec.cfg')]),
      backupOriginals(root(), [game('ctf', 'autoexec.cfg')]),
    ])

    expect(await manifestEntries()).toEqual([
      { path: 'baseq2/autoexec.cfg', kind: 'copied' },
      { path: 'ctf/autoexec.cfg', kind: 'copied' },
    ])
    expect(await text(backedUp('baseq2', 'autoexec.cfg'))).toBe(HAND_WRITTEN)
    expect(await text(backedUp('ctf', 'autoexec.cfg'))).toBe(HAND_EDITED_LATER)
  })

  it('a failed backup does not block the next one on the same installation', async () => {
    await seed(game('baseq2', 'autoexec.cfg'), HAND_WRITTEN)

    await expect(backupOriginals(root(), [join(getDir(), 'outside.cfg')])).rejects.toThrow()
    await backupOriginals(root(), [game('baseq2', 'autoexec.cfg')])

    expect(await text(backedUp('baseq2', 'autoexec.cfg'))).toBe(HAND_WRITTEN)
  })

  it('missing targets are recorded as created, not copied', async () => {
    await write()

    expect(await manifestEntries()).toEqual([
      { path: `baseq2/${PROFILE_FILE}`, kind: 'created' },
      { path: 'baseq2/autoexec.cfg', kind: 'created' },
    ])
    expect(await readdir(backedUp())).toEqual(['manifest.json'])
  })

  it('files the launcher does not write are untouched', async () => {
    await seed(game('baseq2', 'config.cfg'), HAND_WRITTEN)
    // Not a played mod, so its autoexec is not a target either.
    await seed(game('ctf', 'autoexec.cfg'), HAND_WRITTEN)

    await write()

    expect(await text(game('baseq2', 'config.cfg'))).toBe(HAND_WRITTEN)
    expect(await text(game('ctf', 'autoexec.cfg'))).toBe(HAND_WRITTEN)
    expect(await pathExists(backedUp('baseq2', 'config.cfg'))).toBe(false)
    expect(await pathExists(backedUp('ctf'))).toBe(false)
    expect(JSON.stringify(await manifestEntries())).not.toMatch(/config\.cfg|ctf/)
  })

  it('a later write never replaces a backed-up original', async () => {
    await seed(game('baseq2', 'autoexec.cfg'), HAND_WRITTEN)
    await write()
    const entries = await manifestEntries()

    // The user edits our output by hand: unstamped now, but not their original any more.
    await writeFile(game('baseq2', 'autoexec.cfg'), HAND_EDITED_LATER, 'latin1')
    await write()

    expect(await text(backedUp('baseq2', 'autoexec.cfg'))).toBe(HAND_WRITTEN)
    expect(await manifestEntries()).toEqual(entries)
    expect(await text(game('baseq2', 'autoexec.cfg'))).toBe(LOADER_CONTENT)
  })

  it('a later new target joins the existing backup', async () => {
    await seed(game('baseq2', 'autoexec.cfg'), HAND_WRITTEN)
    await write()
    await seed(game('ctf', 'autoexec.cfg'), HAND_EDITED_LATER)

    await write(root(), ['ctf'])

    expect(await manifestEntries()).toEqual([
      { path: `baseq2/${PROFILE_FILE}`, kind: 'created' },
      { path: 'baseq2/autoexec.cfg', kind: 'copied' },
      { path: 'ctf/autoexec.cfg', kind: 'copied' },
    ])
    expect(await text(backedUp('baseq2', 'autoexec.cfg'))).toBe(HAND_WRITTEN)
    expect(await text(backedUp('ctf', 'autoexec.cfg'))).toBe(HAND_EDITED_LATER)
  })

  it('a launcher-owned target takes its legacy sibling as the original', async () => {
    const legacySibling = game('baseq2', `autoexec.cfg${BACKUP_SUFFIX}`)
    await seed(game('baseq2', 'autoexec.cfg'), `${sentinelLine('p0')}\nexec Old.cfg\n`)
    await seed(legacySibling, HAND_WRITTEN)

    await write()

    expect(await text(backedUp('baseq2', 'autoexec.cfg'))).toBe(HAND_WRITTEN)
    expect(await manifestEntries()).toContainEqual({ path: 'baseq2/autoexec.cfg', kind: 'copied' })
    expect(await text(legacySibling)).toBe(HAND_WRITTEN)
    expect(await pathExists(game('baseq2', `${PROFILE_FILE}${BACKUP_SUFFIX}`))).toBe(false)
  })

  it('restore puts originals back byte-identical and removes created files', async () => {
    // Bytes no text encoding round-trip would keep: high latin1 bytes, CRLF, a NUL.
    const original = Buffer.from([0x73, 0x65, 0x74, 0x20, 0xe9, 0xff, 0x00, 0x0d, 0x0a, 0x80])
    await seed(game('baseq2', 'autoexec.cfg'), original)
    await write()

    expect(await restoreOriginals(root())).toEqual({ status: 'restored' })

    expect((await readFile(game('baseq2', 'autoexec.cfg'))).equals(original)).toBe(true)
    expect(await pathExists(game('baseq2', PROFILE_FILE))).toBe(false)
    expect(await pathExists(backedUp())).toBe(false)
  })

  it('restore keeps a created path the user replaced with an unstamped file', async () => {
    await write()
    await writeFile(game('baseq2', PROFILE_FILE), HAND_WRITTEN, 'latin1')

    expect(await restoreOriginals(root())).toEqual({ status: 'restored' })

    expect(await text(game('baseq2', PROFILE_FILE))).toBe(HAND_WRITTEN)
    // The other created path still carried our stamp, so it went.
    expect(await pathExists(game('baseq2', 'autoexec.cfg'))).toBe(false)
  })

  it('a tampered manifest path is refused and nothing is touched', async () => {
    await seed(game('baseq2', 'autoexec.cfg'), HAND_WRITTEN)
    await write()
    // Stamped, so a `created` entry that reached it would delete it.
    const outside = join(getDir(), 'outside.cfg')
    await seed(outside, LOADER_CONTENT)
    const manifestFile = backedUp('manifest.json')

    for (const path of [
      '../outside.cfg',
      'baseq2/../../outside.cfg',
      '..\\outside.cfg',
      `${outside.replace(/\\/g, '/')}`,
      'C:/outside.cfg',
      'baseq2/sub/x.cfg',
      'baseq2/autoexec.txt',
      `${ORIGINAL_CONFIGS_DIR_NAME}/manifest.cfg`,
      '../baseq2/autoexec.cfg',
    ]) {
      await writeFile(
        manifestFile,
        JSON.stringify({
          version: 1,
          entries: [
            { path: 'baseq2/autoexec.cfg', kind: 'copied' },
            { path, kind: 'created' },
          ],
        }),
      )

      expect(await readManifest(root())).toEqual({ status: 'invalid' })
      expect(await hasOriginalBackup(root())).toBe(false)
      expect(await restoreOriginals(root())).toEqual({ status: 'invalid' })

      expect(await text(outside)).toBe(LOADER_CONTENT)
      expect(await text(game('baseq2', 'autoexec.cfg'))).toBe(LOADER_CONTENT)
      expect(await text(game('baseq2', PROFILE_FILE))).toBe(PROFILE_CONTENT)
      expect(await text(backedUp('baseq2', 'autoexec.cfg'))).toBe(HAND_WRITTEN)
    }
  })

  it('after restore no backup exists and the next write starts a fresh one', async () => {
    await seed(game('baseq2', 'autoexec.cfg'), HAND_WRITTEN)
    await write()
    await restoreOriginals(root())

    expect(await hasOriginalBackup(root())).toBe(false)
    expect(await pathExists(backedUp())).toBe(false)

    // The user's config has moved on since; that is the original the next backup keeps.
    await writeFile(game('baseq2', 'autoexec.cfg'), HAND_EDITED_LATER, 'latin1')
    await write()

    expect(await hasOriginalBackup(root())).toBe(true)
    expect(await text(backedUp('baseq2', 'autoexec.cfg'))).toBe(HAND_EDITED_LATER)
  })
})
