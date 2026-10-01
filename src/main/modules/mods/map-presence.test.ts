import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ZipDeps } from '../../lib/zip-entries'
import { resolveExtractorPath } from '../downloads/7za-path'
import { mapPresence } from './map-presence'
import { mapPresenceInputSchema } from './schemas'

/** Header + directory only (file data is never read, so entries may all point at offset 12). */
function pakWith(names: string[]): Buffer {
  const header = Buffer.alloc(12)
  const directory = Buffer.alloc(names.length * 64)
  names.forEach((name, i) => {
    directory.write(name, i * 64, 56, 'latin1')
    directory.writeInt32LE(12, i * 64 + 56)
  })
  header.write('PACK', 0, 'latin1')
  header.writeInt32LE(12, 4)
  header.writeInt32LE(directory.length, 8)
  return Buffer.concat([header, directory])
}

const realBinary = resolveExtractorPath({ isPackaged: false })

describe('mapPresence', () => {
  let root: string
  const zipDeps: ZipDeps = { extractorPath: realBinary.path, extractorExists: realBinary.exists }
  const has = async (map: string, gameDir?: string) =>
    (await mapPresence({ rootPath: root, gameDir, map }, { zipDeps })).available

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'q2-launcher-map-presence-'))
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('finds a map loose, in a pak and in a pkz, case-insensitively', async () => {
    // baseq2 spelled oddly on disk, loose map with upper-case maps dir and file.
    await mkdir(join(root, 'BaseQ2', 'MAPS'), { recursive: true })
    await writeFile(join(root, 'BaseQ2', 'MAPS', 'Q2DM1.BSP'), 'bsp')
    // A directory named like a bsp is not a map.
    await mkdir(join(root, 'BaseQ2', 'MAPS', 'fake.bsp'))
    // A corrupt pak first in the folder (skipped, never an error), then a real one with a backslash name.
    await writeFile(join(root, 'BaseQ2', 'pak0.pak'), 'PACK\u00ff\u00ff\u00ff\u007fgarbage')
    await writeFile(join(root, 'BaseQ2', 'PAK1.PAK'), pakWith(['pics/x.pcx', 'MAPS\\PakMap.Bsp']))
    // A .pk3 is not read, even though it is a zip with the map in it.
    await writeFile(join(root, 'BaseQ2', 'pak2.pk3'), pakWith(['maps/pk3map.bsp']))

    // A mod dir with a loose map of its own.
    await mkdir(join(root, 'rogue', 'maps'), { recursive: true })
    await writeFile(join(root, 'rogue', 'maps', 'rmap.bsp'), 'bsp')

    expect(await has('q2dm1')).toBe(true)
    expect(await has('Q2DM1', 'BASEQ2')).toBe(true)
    expect(await has('pakmap')).toBe(true)
    // Falls back to baseq2 when the mod lacks it, or the mod dir does not exist at all.
    expect(await has('q2dm1', 'rogue')).toBe(true)
    expect(await has('pakmap', 'notinstalled')).toBe(true)
    // In the mod dir only: found with the mod (any case), not without it.
    expect(await has('RMap', 'ROGUE')).toBe(true)
    expect(await has('rmap')).toBe(false)
    // Absent, a directory named like a bsp, a pk3-only map.
    expect(await has('nosuchmap')).toBe(false)
    expect(await has('fake')).toBe(false)
    expect(await has('pk3map')).toBe(false)
    // An unsafe name never reaches the disk, even without the IPC schema in front.
    expect(await has('../rogue/maps/rmap')).toBe(false)
    expect(await has('rmap', '../rogue')).toBe(false)

    // pkz: a real zip built with the vendored 7-Zip, as zip-entries.test.ts does.
    if (!realBinary.exists) return
    const src = join(root, 'src')
    await mkdir(join(src, 'Maps'), { recursive: true })
    await writeFile(join(src, 'Maps', 'ZipMap.BSP'), 'bsp')
    await mkdir(join(root, 'ctf'))
    execFileSync(
      realBinary.path,
      ['a', '-tzip', '-y', '--', join(root, 'ctf', 'Maps.PKZ'), join('Maps', 'ZipMap.BSP')],
      { cwd: src },
    )
    // A corrupt pkz next to it is skipped too.
    await writeFile(join(root, 'ctf', 'broken.pkz'), 'not a zip')

    expect(await has('zipmap', 'CTF')).toBe(true)
    expect(await has('zipmap')).toBe(false)
    // Without an extractor the pkz is simply not readable: missing, not an error.
    expect(
      (
        await mapPresence(
          { rootPath: root, gameDir: 'ctf', map: 'zipmap' },
          { zipDeps: { extractorPath: realBinary.path, extractorExists: false } },
        )
      ).available,
    ).toBe(false)
  })

  it('the mapPresence schema refuses traversal, separators, spaces, dot names and extra keys', () => {
    const accepts = (payload: unknown) => mapPresenceInputSchema.safeParse(payload).success
    expect(accepts({ installationId: 'inst-1', map: 'q2dm1' })).toBe(true)
    expect(accepts({ installationId: 'inst-1', gameDir: 'baseq2', map: 'q2dm1' })).toBe(true)
    expect(accepts({ installationId: 'inst-1', gameDir: 'my-mod_2.0', map: 'Q2CTF1' })).toBe(true)

    const bad = [
      '../x',
      'a/b',
      'a\\b',
      'my mod',
      '.',
      '..',
      '',
      '/etc/passwd',
      'C:\\Windows',
      'C:',
      'x'.repeat(65),
    ]
    for (const name of bad) {
      expect(accepts({ installationId: 'inst-1', map: name }), `map ${name}`).toBe(false)
      expect(
        accepts({ installationId: 'inst-1', gameDir: name, map: 'q2dm1' }),
        `gameDir ${name}`,
      ).toBe(false)
    }

    expect(accepts({ installationId: 'inst-1', map: 'q2dm1', rootPath: 'C:\\' })).toBe(false)
    expect(accepts({ installationId: '', map: 'q2dm1' })).toBe(false)
    expect(accepts({ map: 'q2dm1' })).toBe(false)
    expect(accepts({ installationId: 'inst-1' })).toBe(false)
    expect(accepts({ installationId: 'inst-1', map: 5 })).toBe(false)
  })
})
