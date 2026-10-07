import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PAK_ENTRY_BYTES, PAK_MAX_ENTRIES, readPakDirectory } from './pak-directory'

/** A real pak: header, the files' bytes, then the directory (as Quake II's own tools lay it out). */
function buildPak(files: { name: string; data: Buffer }[]): Buffer {
  const header = Buffer.alloc(12)
  const blobs: Buffer[] = []
  const directory = Buffer.alloc(files.length * PAK_ENTRY_BYTES)
  let offset = 12
  files.forEach((file, i) => {
    directory.write(file.name, i * PAK_ENTRY_BYTES, 56, 'latin1')
    directory.writeInt32LE(offset, i * PAK_ENTRY_BYTES + 56)
    directory.writeInt32LE(file.data.length, i * PAK_ENTRY_BYTES + 60)
    blobs.push(file.data)
    offset += file.data.length
  })
  header.write('PACK', 0, 'latin1')
  header.writeInt32LE(offset, 4)
  header.writeInt32LE(directory.length, 8)
  return Buffer.concat([header, ...blobs, directory])
}

function rawHeader(magic: string, dirofs: number, dirlen: number, padTo = 12): Buffer {
  const buf = Buffer.alloc(Math.max(12, padTo))
  buf.write(magic, 0, 'latin1')
  buf.writeInt32LE(dirofs, 4)
  buf.writeInt32LE(dirlen, 8)
  return buf
}

describe('readPakDirectory', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'q2-launcher-pak-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  async function read(name: string, bytes: Buffer) {
    const path = join(dir, name)
    await writeFile(path, bytes)
    return readPakDirectory(path)
  }

  it('reads the entry names of a valid pak, including a full 56-byte and a latin1 name', async () => {
    const long = 'maps/' + 'x'.repeat(51) // exactly 56 bytes, no NUL terminator
    const result = await read(
      'pak0.pak',
      buildPak([
        { name: 'maps/q2dm1.bsp', data: Buffer.from('bsp bytes') },
        { name: 'pics/café.pcx', data: Buffer.from('pcx') },
        { name: long, data: Buffer.alloc(0) },
      ]),
    )
    expect(result).toMatchObject({ ok: true, names: ['maps/q2dm1.bsp', 'pics/café.pcx', long] })
    expect(await read('empty.pak', buildPak([]))).toMatchObject({ ok: true, names: [] })
  })

  it("entries carry each file's offset and length", async () => {
    const a = Buffer.from('first file')
    const b = Buffer.from('second')
    const result = await read(
      'offsets.pak',
      buildPak([
        { name: 'maps/a.bsp', data: a },
        { name: 'maps/b.bsp', data: b },
      ]),
    )
    expect(result).toMatchObject({
      ok: true,
      entries: [
        { name: 'maps/a.bsp', offset: 12, length: a.length },
        { name: 'maps/b.bsp', offset: 12 + a.length, length: b.length },
      ],
    })
  })

  it('refuses a bad magic, an oversized directory and a truncated file', async () => {
    const valid = buildPak([{ name: 'maps/a.bsp', data: Buffer.from('data') }])

    // Bad magic (a zip renamed to .pak, lowercase magic).
    expect(
      await read('zip.pak', Buffer.concat([Buffer.from('PK\u0003\u0004'), valid.subarray(4)])),
    ).toEqual({ ok: false })
    expect(
      await read('lower.pak', Buffer.concat([Buffer.from('pack'), valid.subarray(4)])),
    ).toEqual({ ok: false })

    // Oversized directory: more than 65 536 entries, even though the file really is that large.
    const entries = PAK_MAX_ENTRIES + 1
    const huge = rawHeader('PACK', 12, entries * PAK_ENTRY_BYTES, 12 + entries * PAK_ENTRY_BYTES)
    expect(await read('huge.pak', huge)).toEqual({ ok: false })
    // ...a dirlen that is no whole number of entries...
    expect(await read('ragged.pak', rawHeader('PACK', 12, 63, 12 + 63))).toEqual({ ok: false })
    // ...and negative offsets/lengths (int32 0xFFFFFFFF etc.).
    expect(await read('negofs.pak', rawHeader('PACK', -64, 64, 200))).toEqual({ ok: false })
    expect(await read('neglen.pak', rawHeader('PACK', 12, -64, 200))).toEqual({ ok: false })
    // A directory claimed to be 2 GiB is refused on the size check, never allocated.
    expect(await read('claims2g.pak', rawHeader('PACK', 12, 0x7fffffc0))).toEqual({ ok: false })

    // Truncated: directory runs past the end of the file, or the file is shorter than its header.
    expect(await read('cut.pak', valid.subarray(0, valid.length - 1))).toEqual({ ok: false })
    expect(await read('stub.pak', Buffer.from('PACK\u0000\u0000'))).toEqual({ ok: false })
    expect(await read('zero.pak', Buffer.alloc(0))).toEqual({ ok: false })

    // Not readable as a file at all: never throws.
    expect(await readPakDirectory(join(dir, 'missing.pak'))).toEqual({ ok: false })
    expect(await readPakDirectory(dir)).toEqual({ ok: false })

    // The untouched fixture still reads, so the refusals above are about the damage.
    expect(await read('ok.pak', valid)).toMatchObject({ ok: true, names: ['maps/a.bsp'] })
  })
})
