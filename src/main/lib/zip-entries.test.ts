import { execFileSync, type ChildProcess, type spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveExtractorPath } from '../modules/downloads/7za-path'
import {
  listZipEntries,
  parseSltListing,
  readZipEntry,
  ZIP_CALL_TIMEOUT_MS,
  ZIP_ENTRY_MAX_BYTES,
  ZIP_LISTING_MAX_BYTES,
  type ZipDeps,
} from './zip-entries'

/**
 * A stand-in for a spawned 7za (mirrors `extractor.test.ts`'s `FakeChild`): real streams and real
 * `close`/`error` events, timing under the test's control. `emittedBytes` is the fake's own count
 * of stdout bytes it handed out, so a cap test can assert on what was actually delivered rather
 * than only on the return value. `kill()` behaves like a real process: it records the kill and
 * then fires `close` - which the reader must ignore if it has already settled.
 */
class FakeChild extends EventEmitter {
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  killed = false
  emittedBytes = 0

  kill(): boolean {
    this.killed = true
    queueMicrotask(() => this.emit('close', null, 'SIGTERM'))
    return true
  }

  send(chunk: Buffer): void {
    this.emittedBytes += chunk.length
    this.stdout.emit('data', chunk)
  }

  /** Emits `chunk` repeatedly until killed or `limit` bytes were handed out. */
  flood(chunk: Buffer, limit: number): void {
    while (!this.killed && this.emittedBytes < limit) this.send(chunk)
  }

  finish(code: number | null): void {
    this.emit('close', code, null)
  }

  asChildProcess(): ChildProcess {
    return this as unknown as ChildProcess
  }
}

interface SpawnCall {
  command: string
  args: string[]
  options: Record<string, unknown>
}

function fakeDeps(child: FakeChild): { deps: ZipDeps; calls: SpawnCall[] } {
  const calls: SpawnCall[] = []
  const fakeSpawn = ((command: string, args: string[], options: Record<string, unknown>) => {
    calls.push({ command, args, options })
    return child.asChildProcess()
  }) as unknown as typeof spawn
  return {
    deps: { extractorPath: 'C:/vendored/bin/7za.exe', extractorExists: true, spawn: fakeSpawn },
    calls,
  }
}

const MIB = 1024 * 1024

afterEach(() => {
  vi.useRealTimers()
})

describe('fake 7za process', () => {
  it('7za is spawned with the exact list and read argument shapes', async () => {
    const listChild = new FakeChild()
    const list = fakeDeps(listChild)
    const listing = listZipEntries('C:/demos/pack.zip', list.deps)
    listChild.send(Buffer.from('Path = a.dm2\r\nSize = 5\r\n\r\n'))
    listChild.finish(0)
    expect(await listing).toEqual({
      ok: true,
      entries: [{ path: 'a.dm2', isFolder: false, size: 5, modified: null, encrypted: false }],
    })

    const readChild = new FakeChild()
    const read = fakeDeps(readChild)
    const reading = readZipEntry('C:/demos/pack.zip', 'sub/a.dm2', 5, read.deps)
    readChild.send(Buffer.from('hello'))
    readChild.finish(0)
    const outcome = await reading
    expect(outcome.ok).toBe(true)
    expect(outcome.ok && Buffer.from(outcome.bytes).toString()).toBe('hello')

    expect(list.calls).toHaveLength(1)
    expect(list.calls[0].command).toBe('C:/vendored/bin/7za.exe')
    expect(list.calls[0].args).toEqual([
      'l',
      '-slt',
      '-ba',
      '-sccUTF-8',
      '-tzip',
      '-p-',
      'C:/demos/pack.zip',
    ])
    expect(read.calls).toHaveLength(1)
    expect(read.calls[0].args).toEqual([
      'e',
      '-so',
      '-spd',
      '-bd',
      '-sccUTF-8',
      '-tzip',
      '-p-',
      'C:/demos/pack.zip',
      '--',
      'sub/a.dm2',
    ])
    for (const call of [...list.calls, ...read.calls]) {
      expect(call.options).toMatchObject({
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      // Read-only: no archive-writing command and no output-directory switch, anywhere.
      expect(call.args[0]).not.toMatch(/^[audx]$/)
      expect(call.args.some((arg) => arg.startsWith('-o'))).toBe(false)
    }
  })

  it('an entry listed above the cap is refused without spawning a read', async () => {
    const spawnSpy = vi.fn()
    const deps: ZipDeps = {
      extractorPath: 'C:/vendored/bin/7za.exe',
      extractorExists: true,
      spawn: spawnSpy as unknown as typeof spawn,
    }

    expect(
      await readZipEntry('C:/demos/pack.zip', 'big.dm2', ZIP_ENTRY_MAX_BYTES + 1, deps),
    ).toEqual({ ok: false, code: 'entry-too-large' })
    expect(spawnSpy).not.toHaveBeenCalled()
  })

  it('a missing extractor is reported without spawning', async () => {
    const spawnSpy = vi.fn()
    const deps: ZipDeps = {
      extractorPath: 'C:/nowhere/7za.exe',
      extractorExists: false,
      spawn: spawnSpy as unknown as typeof spawn,
    }

    expect(await listZipEntries('C:/demos/pack.zip', deps)).toEqual({
      ok: false,
      code: 'extractor-missing',
    })
    expect(await readZipEntry('C:/demos/pack.zip', 'a.dm2', 5, deps)).toEqual({
      ok: false,
      code: 'extractor-missing',
    })
    expect(spawnSpy).not.toHaveBeenCalled()
  })

  it('a stream that runs past the cap is killed and never held beyond cap plus one chunk', async () => {
    const child = new FakeChild()
    const { deps } = fakeDeps(child)
    const chunk = Buffer.alloc(MIB)

    // The entry claims to fit under the cap, the stream then keeps going (a lying header).
    const reading = readZipEntry('C:/demos/pack.zip', 'liar.dm2', ZIP_ENTRY_MAX_BYTES, deps)
    child.flood(chunk, ZIP_ENTRY_MAX_BYTES * 4)

    expect(await reading).toEqual({ ok: false, code: 'entry-too-large' })
    expect(child.killed).toBe(true)
    expect(child.emittedBytes).toBeGreaterThan(ZIP_ENTRY_MAX_BYTES)
    expect(child.emittedBytes).toBeLessThanOrEqual(ZIP_ENTRY_MAX_BYTES + chunk.length)

    // A late exit after the kill must not change or re-resolve the settled outcome.
    child.finish(0)
    expect(await reading).toEqual({ ok: false, code: 'entry-too-large' })
  })

  it('a size mismatch or a missing entry is unreadable', async () => {
    const cases: Array<{ expected: number; sent: number; code: number }> = [
      { expected: 10, sent: 4, code: 0 }, // fewer bytes than listed
      { expected: 10, sent: 12, code: 0 }, // more bytes than listed
      { expected: 10, sent: 0, code: 0 }, // missing entry: 7za exits 0 with no output
      { expected: 10, sent: 10, code: 2 }, // right size, but 7za reported an error
    ]
    for (const { expected, sent, code } of cases) {
      const child = new FakeChild()
      const { deps } = fakeDeps(child)
      const reading = readZipEntry('C:/demos/pack.zip', 'a.dm2', expected, deps)
      if (sent > 0) child.send(Buffer.alloc(sent))
      child.finish(code)
      expect(await reading).toEqual({ ok: false, code: 'unreadable' })
    }

    const errored = new FakeChild()
    const reading = readZipEntry('C:/demos/pack.zip', 'a.dm2', 10, fakeDeps(errored).deps)
    errored.emit('error', new Error('spawn ENOENT'))
    expect(await reading).toEqual({ ok: false, code: 'unreadable' })
  })

  it('a listing flood or timeout is an archive error, a garbage or truncated zip cannot be opened', async () => {
    const flooded = new FakeChild()
    const listing = listZipEntries('C:/demos/pack.zip', fakeDeps(flooded).deps)
    flooded.flood(Buffer.alloc(MIB), ZIP_LISTING_MAX_BYTES * 4)
    expect(await listing).toEqual({ ok: false, code: 'archive-too-large' })
    expect(flooded.killed).toBe(true)
    expect(flooded.emittedBytes).toBeLessThanOrEqual(ZIP_LISTING_MAX_BYTES + MIB)

    vi.useFakeTimers()

    const hungList = new FakeChild()
    const hungListing = listZipEntries('C:/demos/pack.zip', fakeDeps(hungList).deps)
    vi.advanceTimersByTime(ZIP_CALL_TIMEOUT_MS + 1)
    expect(await hungListing).toEqual({ ok: false, code: 'archive-unreadable' })
    expect(hungList.killed).toBe(true)

    const hungRead = new FakeChild()
    const hungReading = readZipEntry('C:/demos/pack.zip', 'a.dm2', 10, fakeDeps(hungRead).deps)
    vi.advanceTimersByTime(ZIP_CALL_TIMEOUT_MS + 1)
    expect(await hungReading).toEqual({ ok: false, code: 'unreadable' })
    expect(hungRead.killed).toBe(true)

    vi.useRealTimers()

    const broken = new FakeChild()
    const brokenListing = listZipEntries('C:/demos/garbage.zip', fakeDeps(broken).deps)
    broken.finish(2)
    expect(await brokenListing).toEqual({ ok: false, code: 'archive-unreadable' })
  })

  it('parseSltListing on a captured real listing', () => {
    const listing = [
      'Path = maps\\q2dm1',
      'Folder = +',
      'Size = 0',
      'Packed Size = 0',
      'Modified = 2024-05-17 21:03:09',
      'Attributes = D',
      'Encrypted = -',
      'Comment = ',
      '',
      'Path = maps\\q2dm1\\duel [1].dm2',
      'Folder = -',
      'Size = 123456',
      'Packed Size = 45678',
      'Modified = 2024-05-17 21:04:10.1234567',
      'Encrypted = -',
      'CRC = 1A2B3C4D',
      'Method = Deflate',
      '',
      'Path = secret.dm2',
      'Folder = -',
      'Size = not-a-number',
      'Modified = garbage',
      'Encrypted = +',
      '',
      'Size = 99',
      'Folder = -',
      '',
    ].join('\r\n')

    expect(parseSltListing(listing)).toEqual([
      {
        path: 'maps/q2dm1',
        isFolder: true,
        size: 0,
        modified: new Date(2024, 4, 17, 21, 3, 9, 0),
        encrypted: false,
      },
      {
        path: 'maps/q2dm1/duel [1].dm2',
        isFolder: false,
        size: 123456,
        modified: new Date(2024, 4, 17, 21, 4, 10, 123),
        encrypted: false,
      },
      { path: 'secret.dm2', isFolder: false, size: null, modified: null, encrypted: true },
    ])
    expect(parseSltListing('')).toEqual([])
    expect(parseSltListing('not a listing at all\n\n\n')).toEqual([])
  })
})

describe('real zip (only when the vendored binary is present)', () => {
  const realBinary = resolveExtractorPath({ isPackaged: false })
  const fixture = resolve(__dirname, '../../../docs/fixtures/demos/test.dm2')
  const entryNames = ['a.dm2', 'sub/a.dm2', '-dash.dm2', 'b [1].DM2']

  let dir: string
  let zipPath: string
  const sources = new Map<string, Buffer>()

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'q2-launcher-zip-entries-'))
    zipPath = join(dir, 'pack.zip')
    if (!realBinary.exists) return

    const src = join(dir, 'src')
    await mkdir(join(src, 'sub'), { recursive: true })
    await copyFile(fixture, join(src, 'a.dm2'))
    await writeFile(join(src, 'sub', 'a.dm2'), Buffer.from('a different demo in a subfolder'))
    await writeFile(join(src, '-dash.dm2'), Buffer.from('starts with a dash'))
    await writeFile(join(src, 'b [1].DM2'), Buffer.from('brackets are not a wildcard'))
    sources.clear()
    for (const name of entryNames) sources.set(name, await readFile(join(src, name)))

    execFileSync(
      realBinary.path,
      ['a', '-tzip', '-y', '-spd', '--', zipPath, ...entryNames.map((n) => n.replace('/', '\\'))],
      { cwd: src },
    )
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  const deps = (): ZipDeps => ({ extractorPath: realBinary.path, extractorExists: true })

  async function readEveryEntry(): Promise<Map<string, Uint8Array>> {
    const listing = await listZipEntries(zipPath, deps())
    expect(listing.ok).toBe(true)
    const out = new Map<string, Uint8Array>()
    if (!listing.ok) return out
    for (const entry of listing.entries.filter((e) => !e.isFolder)) {
      const read = await readZipEntry(zipPath, entry.path, entry.size ?? -1, deps())
      expect(read, entry.path).toMatchObject({ ok: true })
      if (read.ok) out.set(entry.path, read.bytes)
    }
    return out
  }

  it.skipIf(!realBinary.exists)(
    'each entry of a real zip reads back its own exact bytes',
    async () => {
      const listing = await listZipEntries(zipPath, deps())
      expect(listing.ok && listing.entries.map((e) => e.path).sort()).toEqual(
        [...entryNames].sort(),
      )

      const read = await readEveryEntry()
      expect([...read.keys()].sort()).toEqual([...entryNames].sort())
      for (const name of entryNames) {
        expect(
          Buffer.from(read.get(name) ?? new Uint8Array()).equals(
            sources.get(name) ?? Buffer.alloc(1),
          ),
          name,
        ).toBe(true)
      }
    },
  )

  it.skipIf(!realBinary.exists)(
    'a garbage file and a truncated zip are archive-unreadable',
    async () => {
      const garbage = join(dir, 'garbage.zip')
      await writeFile(
        garbage,
        Buffer.from('this is not a zip file at all, just some text'.repeat(20)),
      )
      expect(await listZipEntries(garbage, deps())).toEqual({
        ok: false,
        code: 'archive-unreadable',
      })

      const whole = await readFile(zipPath)
      const truncated = join(dir, 'truncated.zip')
      await writeFile(truncated, whole.subarray(0, Math.floor(whole.length / 2)))
      expect(await listZipEntries(truncated, deps())).toEqual({
        ok: false,
        code: 'archive-unreadable',
      })
    },
  )

  it.skipIf(!realBinary.exists)(
    "listing and reading every entry leaves the archive's size, mtime and content unchanged",
    async () => {
      const sha256 = async (): Promise<string> =>
        createHash('sha256')
          .update(await readFile(zipPath))
          .digest('hex')
      const before = await stat(zipPath)
      const hashBefore = await sha256()

      const read = await readEveryEntry()
      expect(read.size).toBe(entryNames.length)

      const after = await stat(zipPath)
      expect(after.size).toBe(before.size)
      expect(after.mtimeMs).toBe(before.mtimeMs)
      expect(await sha256()).toBe(hashBefore)
    },
  )
})
