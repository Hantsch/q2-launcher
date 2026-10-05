import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readBspTitle } from './bsp-title'

function buildBsp(entities: Buffer, opts: { ident?: string; version?: number } = {}): Buffer {
  const header = Buffer.alloc(160)
  header.write(opts.ident ?? 'IBSP', 0, 'latin1')
  header.writeInt32LE(opts.version ?? 38, 4)
  header.writeInt32LE(header.length, 8)
  header.writeInt32LE(entities.length, 12)
  return Buffer.concat([header, entities])
}

const worldspawn = (message: string) =>
  Buffer.from(
    `{\n"classname" "worldspawn"\n"message" "${message}"\n}\n{\n"message" "other"\n}\n`,
    'latin1',
  )

describe('readBspTitle', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'q2-launcher-bsp-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  async function write(name: string, bytes: Buffer) {
    const path = join(dir, name)
    await writeFile(path, bytes)
    return path
  }

  it('reads the worldspawn message', async () => {
    const path = await write('a.bsp', buildBsp(worldspawn('  The   Edge\\nof Doom ')))
    expect(await readBspTitle(path)).toBe('The Edge of Doom')

    const colored = Buffer.from('{ "message" "', 'latin1')
    const tail = Buffer.from([0xc1, 0xc2, 0x09, 0x43, 0x22, 0x20, 0x7d])
    expect(await readBspTitle(await write('b.bsp', buildBsp(Buffer.concat([colored, tail]))))).toBe(
      'AB C',
    )

    const long = 'x'.repeat(100)
    expect(await readBspTitle(await write('c.bsp', buildBsp(worldspawn(long))))).toBe(
      'x'.repeat(64),
    )
    expect(await readBspTitle(await write('d.bsp', buildBsp(worldspawn(' '))))).toBeUndefined()
    expect(
      await readBspTitle(
        await write('e.bsp', buildBsp(Buffer.from('{ "classname" "worldspawn" }'))),
      ),
    ).toBeUndefined()
  })

  it('a BSP inside a pak is read at its offset', async () => {
    const prefix = Buffer.alloc(100, 7)
    const bsp = buildBsp(worldspawn('Inside'))
    const suffix = Buffer.from('trailing bytes')
    const path = await write('pak.pak', Buffer.concat([prefix, bsp, suffix]))
    expect(await readBspTitle(path, prefix.length, prefix.length + bsp.length)).toBe('Inside')
    // The same bytes read from the start of the file are not a BSP.
    expect(await readBspTitle(path)).toBeUndefined()
    // A limit that cuts the entity lump short refuses.
    expect(await readBspTitle(path, prefix.length, prefix.length + bsp.length - 1)).toBeUndefined()
  })

  it('a bad ident, version or out-of-range lump is undefined', async () => {
    const ents = worldspawn('Title')
    expect(
      await readBspTitle(await write('i.bsp', buildBsp(ents, { ident: 'XBSP' }))),
    ).toBeUndefined()
    expect(
      await readBspTitle(await write('v.bsp', buildBsp(ents, { version: 29 }))),
    ).toBeUndefined()

    const outside = buildBsp(ents)
    outside.writeInt32LE(ents.length + 1000, 12)
    expect(await readBspTitle(await write('o.bsp', outside))).toBeUndefined()
    const negative = buildBsp(ents)
    negative.writeInt32LE(-1, 8)
    expect(await readBspTitle(await write('n.bsp', negative))).toBeUndefined()

    expect(await readBspTitle(await write('s.bsp', Buffer.from('IBSP')))).toBeUndefined()
    expect(await readBspTitle(join(dir, 'missing.bsp'))).toBeUndefined()
    expect(await readBspTitle(dir)).toBeUndefined()
  })

  it('a huge entity lump is read only up to the cap', async () => {
    const head = Buffer.from('{ "message" "Capped" "classname" "worldspawn" }', 'latin1')
    const filler = Buffer.alloc(5 * 1024 * 1024, 0x20)
    const path = await write('huge.bsp', buildBsp(Buffer.concat([head, filler])))
    expect(await readBspTitle(path)).toBe('Capped')

    // A message that only starts past the cap is not found.
    const late = Buffer.concat([
      Buffer.from('{ "classname" "worldspawn" ', 'latin1'),
      Buffer.alloc(20 * 1024, 0x20),
      Buffer.from('"message" "Late" }', 'latin1'),
    ])
    expect(await readBspTitle(await write('late.bsp', buildBsp(late)))).toBeUndefined()
  })
})
