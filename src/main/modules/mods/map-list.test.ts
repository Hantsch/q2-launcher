import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveExtractorPath } from '../../lib/archive/7za-path'
import type { ZipDeps } from '../../lib/zip-entries'
import { listMaps } from './map-list'

function bsp(title?: string): Buffer {
  const entities = Buffer.from(
    title === undefined ? '{\n"classname" "worldspawn"\n}\n' : `{\n"message" "${title}"\n}\n`,
    'latin1',
  )
  const header = Buffer.alloc(160)
  header.write('IBSP', 0, 'latin1')
  header.writeInt32LE(38, 4)
  header.writeInt32LE(header.length, 8)
  header.writeInt32LE(entities.length, 12)
  return Buffer.concat([header, entities])
}

function pakOf(files: Array<{ name: string; data: Buffer }>): Buffer {
  const directory = Buffer.alloc(files.length * 64)
  let offset = 12
  files.forEach((file, i) => {
    directory.write(file.name, i * 64, 56, 'latin1')
    directory.writeInt32LE(offset, i * 64 + 56)
    directory.writeInt32LE(file.data.length, i * 64 + 60)
    offset += file.data.length
  })
  const header = Buffer.alloc(12)
  header.write('PACK', 0, 'latin1')
  header.writeInt32LE(offset, 4)
  header.writeInt32LE(directory.length, 8)
  return Buffer.concat([header, ...files.map((f) => f.data), directory])
}

const realBinary = resolveExtractorPath({ isPackaged: false })

describe('the maps a mod offers', () => {
  let root: string
  const zipDeps: ZipDeps = { extractorPath: realBinary.path, extractorExists: realBinary.exists }
  const list = async (gameDir: string, engineKind: 'q2pro' | 'r1q2' = 'q2pro') =>
    (await listMaps({ rootPath: root, gameDir, engineKind }, { zipDeps })).maps

  async function makePkz(dir: string, entries: string[]): Promise<void> {
    const src = join(root, 'src')
    await mkdir(src, { recursive: true })
    for (const entry of entries) {
      await mkdir(join(src, entry, '..'), { recursive: true })
      await writeFile(join(src, entry), 'bsp')
    }
    execFileSync(realBinary.path, ['a', '-tzip', '-y', '--', join(dir, 'maps.pkz'), ...entries], {
      cwd: src,
    })
    await rm(src, { recursive: true, force: true })
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'q2-launcher-map-list-'))
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('lists loose, pak and pkz maps of the mod and baseq2, sorted', async () => {
    await mkdir(join(root, 'BaseQ2', 'MAPS'), { recursive: true })
    await writeFile(join(root, 'BaseQ2', 'MAPS', 'Q2DM1.BSP'), bsp())
    await mkdir(join(root, 'BaseQ2', 'MAPS', 'fake.bsp'))
    await writeFile(join(root, 'BaseQ2', 'pak0.pak'), 'PACKÿÿÿ\u007fgarbage')
    await writeFile(
      join(root, 'BaseQ2', 'PAK1.PAK'),
      pakOf([
        { name: 'pics/x.pcx', data: Buffer.from('x') },
        { name: 'MAPS\\PakMap.Bsp', data: bsp() },
        { name: 'maps/deeper/nope.bsp', data: bsp() },
      ]),
    )
    await mkdir(join(root, 'ctf', 'maps'), { recursive: true })
    await writeFile(join(root, 'ctf', 'maps', 'ctf1.bsp'), bsp())
    await writeFile(join(root, 'ctf', 'maps', 'readme.txt'), 'x')
    if (realBinary.exists) {
      await makePkz(join(root, 'ctf'), ['maps/ZipMap.bsp', 'maps/sub/deep.bsp', 'other/a.bsp'])
      await writeFile(join(root, 'ctf', 'broken.pkz'), 'not a zip')
    }

    const names = (await list('ctf')).map((m) => m.name)
    expect(names).toEqual(
      realBinary.exists ? ['ctf1', 'PakMap', 'Q2DM1', 'ZipMap'] : ['ctf1', 'PakMap', 'Q2DM1'],
    )
    expect((await list('')).map((m) => m.name)).toEqual(['PakMap', 'Q2DM1'])
    expect(await list('notinstalled')).toHaveLength(2)
  })

  it('a name that is not a safe token is not offered', async () => {
    await mkdir(join(root, 'baseq2', 'maps'), { recursive: true })
    await writeFile(join(root, 'baseq2', 'maps', 'my map.bsp'), bsp())
    await writeFile(join(root, 'baseq2', 'maps', 'good.bsp'), bsp())
    await writeFile(
      join(root, 'baseq2', 'pak0.pak'),
      pakOf([
        { name: 'maps/..bsp', data: bsp() },
        { name: 'maps/a b.bsp', data: bsp() },
        { name: 'maps/fine_1.bsp', data: bsp() },
      ]),
    )
    expect((await list('')).map((m) => m.name)).toEqual(['fine_1', 'good'])
    expect(await list('../baseq2')).toHaveLength(2)
  })

  it("the mod's copy wins over baseq2's", async () => {
    await mkdir(join(root, 'baseq2', 'maps'), { recursive: true })
    await mkdir(join(root, 'rogue', 'maps'), { recursive: true })
    await writeFile(join(root, 'baseq2', 'maps', 'Shared.bsp'), bsp('Base title'))
    await writeFile(join(root, 'rogue', 'maps', 'shared.bsp'), bsp('Mod title'))

    expect(await list('rogue')).toEqual([{ name: 'shared', title: 'Mod title' }])
  })

  it('pkz maps are skipped for r1q2', async () => {
    if (!realBinary.exists) return
    await mkdir(join(root, 'ctf'), { recursive: true })
    await makePkz(join(root, 'ctf'), ['maps/zipmap.bsp'])

    expect((await list('ctf', 'q2pro')).map((m) => m.name)).toEqual(['zipmap'])
    expect(await list('ctf', 'r1q2')).toEqual([])
  })

  it('titles come from loose and pak BSPs only', async () => {
    await mkdir(join(root, 'ctf', 'maps'), { recursive: true })
    await writeFile(join(root, 'ctf', 'maps', 'loose.bsp'), bsp('Loose  Title'))
    await writeFile(join(root, 'ctf', 'maps', 'untitled.bsp'), bsp())
    await writeFile(join(root, 'ctf', 'maps', 'junk.bsp'), 'not a bsp')
    await writeFile(
      join(root, 'ctf', 'pak0.pak'),
      pakOf([
        { name: 'maps/first.bsp', data: bsp('First Pak') },
        { name: 'maps/second.bsp', data: bsp('Second Pak') },
      ]),
    )
    if (realBinary.exists) await makePkz(join(root, 'ctf'), ['maps/zipmap.bsp'])

    const maps = await list('ctf')
    const byName = Object.fromEntries(maps.map((m) => [m.name, m.title]))
    expect(byName).toMatchObject({
      first: 'First Pak',
      second: 'Second Pak',
      loose: 'Loose Title',
      untitled: undefined,
      junk: undefined,
    })
    if (realBinary.exists) expect(maps.find((m) => m.name === 'zipmap')).toEqual({ name: 'zipmap' })
  })
})
