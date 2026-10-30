import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { copyFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  REPO_ROOT,
  assertOutsideRepo,
  ensureEngineData,
  extractArchive,
  resolveCacheDir,
  sevenZipPath,
} from './data.mjs'

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const PAK = Buffer.from('not a real pak, just bytes')
const HAS_7Z = existsSync(sevenZipPath())

let work
beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'engine-data-'))
})
afterEach(() => rmSync(work, { recursive: true, force: true }))

/** Packs Install/Data/baseq2/pak0.pak with the vendored 7-Zip; returns the archive path. */
function packFixtureArchive() {
  const src = join(work, 'src')
  mkdirSync(join(src, 'Install', 'Data', 'baseq2'), { recursive: true })
  writeFileSync(join(src, 'Install', 'Data', 'baseq2', 'pak0.pak'), PAK)
  const archive = join(work, 'fixture.7z')
  execFileSync(sevenZipPath(), ['a', archive, 'Install'], { cwd: src, stdio: 'ignore' })
  return archive
}

function makeLock(archive, pakSha = sha(PAK)) {
  return {
    archive: {
      url: 'https://example.invalid/a',
      mirrors: [],
      sizeBytes: 1,
      sha256: sha(readFileSync(archive)),
      fileName: 'fixture.7z',
    },
    pak0: { path: 'baseq2/pak0.pak', sha256: pakSha },
  }
}

function counters(archive) {
  const calls = { download: 0, extract: 0 }
  return {
    calls,
    download: async (_url, dest) => {
      calls.download += 1
      await copyFile(archive, dest)
    },
    extract: (a, out) => {
      calls.extract += 1
      extractArchive(a, out)
    },
  }
}

describe('engine data cache', () => {
  test('resolves the cache dir per platform and honours Q2L_ENGINE_DATA', () => {
    expect(resolveCacheDir({ LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' }, 'win32')).toBe(
      'C:\\Users\\u\\AppData\\Local\\q2l-engine-test',
    )
    expect(resolveCacheDir({ XDG_CACHE_HOME: '/x/cache' }, 'linux')).toBe(
      '/x/cache/q2l-engine-test',
    )
    expect(resolveCacheDir({ Q2L_ENGINE_DATA: '/over/ride', XDG_CACHE_HOME: '/x' }, 'linux')).toBe(
      '/over/ride',
    )
  })

  test('refuses a cache dir inside the repo', () => {
    expect(() => assertOutsideRepo('/repo', '/repo', 'linux')).toThrow(/inside the repo/)
    expect(() => assertOutsideRepo('/repo/.cache/x', '/repo', 'linux')).toThrow(/inside the repo/)
    expect(() => assertOutsideRepo('C:\\Repo\\sub', 'c:\\repo', 'win32')).toThrow(/inside the repo/)
    expect(() => assertOutsideRepo('/repo/../elsewhere', '/repo', 'linux')).not.toThrow()
    expect(() => assertOutsideRepo('/repo..foo', '/repo', 'linux')).not.toThrow()
    expect(() => assertOutsideRepo(join(work, 'cache'), REPO_ROOT)).not.toThrow()
  })

  test.skipIf(!HAS_7Z)(
    'a fresh fetch writes baseq2/pak0.pak and prints the cache path last',
    async () => {
      const archive = packFixtureArchive()
      const cacheDir = join(work, 'cache')
      const lines = []
      const { download, extract } = counters(archive)

      await ensureEngineData({
        lock: makeLock(archive),
        cacheDir,
        download,
        extract,
        log: (l) => lines.push(l),
      })

      expect(readFileSync(join(cacheDir, 'baseq2', 'pak0.pak'))).toEqual(PAK)
      expect(lines.at(-1)).toBe(cacheDir)
      expect(existsSync(join(cacheDir, '.tmp'))).toBe(false)
    },
  )

  test.skipIf(!HAS_7Z)(
    'a cached call downloads and extracts nothing and prints cached',
    async () => {
      const archive = packFixtureArchive()
      const cacheDir = join(work, 'cache')
      const lock = makeLock(archive)
      const first = counters(archive)
      await ensureEngineData({ lock, cacheDir, ...first, log: () => {} })

      const second = counters(archive)
      const lines = []
      await ensureEngineData({ lock, cacheDir, ...second, log: (l) => lines.push(l) })

      expect(second.calls).toEqual({ download: 0, extract: 0 })
      expect(lines).toEqual(['cached', cacheDir])
    },
  )

  test('an archive hash mismatch fails naming the archive', async () => {
    const archive = join(work, 'bogus.bin')
    writeFileSync(archive, 'bogus')
    const lock = makeLock(archive)
    lock.archive.sha256 = '1'.repeat(64)
    const { download, extract, calls } = counters(archive)

    await expect(
      ensureEngineData({ lock, cacheDir: join(work, 'cache'), download, extract, log: () => {} }),
    ).rejects.toThrow(/archive SHA-256 mismatch/)
    expect(calls.extract).toBe(0)
  })

  test.skipIf(!HAS_7Z)('a pak0 hash mismatch fails naming pak0.pak', async () => {
    const archive = packFixtureArchive()
    const { download, extract } = counters(archive)
    const cacheDir = join(work, 'cache')

    await expect(
      ensureEngineData({
        lock: makeLock(archive, '0'.repeat(64)),
        cacheDir,
        download,
        extract,
        log: () => {},
      }),
    ).rejects.toThrow(/pak0\.pak SHA-256 mismatch/)
    expect(existsSync(join(cacheDir, 'baseq2', 'pak0.pak'))).toBe(false)
  })

  describe('without the vendored 7-Zip', () => {
    const ARCHIVE_BYTES = Buffer.from('fake archive')
    const fakeLock = (pakSha = sha(PAK), archiveSha = sha(ARCHIVE_BYTES)) => ({
      archive: {
        url: 'https://primary.invalid/a',
        mirrors: ['https://mirror.invalid/a'],
        sha256: archiveSha,
        fileName: 'a.bin',
      },
      pak0: { path: 'baseq2/pak0.pak', sha256: pakSha },
    })
    const writePak = (dir) => {
      mkdirSync(join(dir, 'baseq2'), { recursive: true })
      writeFileSync(join(dir, 'baseq2', 'pak0.pak'), PAK)
    }
    const fakeExtract = (_archive, out) => {
      writePak(join(out, 'Install', 'Data'))
    }

    test('a cached call re-hashes pak0.pak and fails naming it on a mismatch', async () => {
      const cacheDir = join(work, 'cache')
      const lock = fakeLock('0'.repeat(64))
      writePak(cacheDir)
      writeFileSync(join(cacheDir, 'data.lock.json'), JSON.stringify(lock))
      let downloads = 0

      await expect(
        ensureEngineData({
          lock,
          cacheDir,
          download: async () => {
            downloads += 1
          },
          extract: fakeExtract,
          log: () => {},
        }),
      ).rejects.toThrow(/pak0\.pak SHA-256 mismatch/)
      expect(downloads).toBe(0)
    })

    test('downloads fall back to the next mirror when the first host fails', async () => {
      const cacheDir = join(work, 'cache')
      const tried = []

      await ensureEngineData({
        lock: fakeLock(),
        cacheDir,
        download: async (url, dest) => {
          tried.push(url)
          if (url.startsWith('https://primary')) throw new Error('host down')
          writeFileSync(dest, ARCHIVE_BYTES)
        },
        extract: fakeExtract,
        log: () => {},
      })

      expect(tried).toEqual(['https://primary.invalid/a', 'https://mirror.invalid/a'])
      expect(readFileSync(join(cacheDir, 'baseq2', 'pak0.pak'))).toEqual(PAK)
    })

    test('a marker with a different archive hash refetches', async () => {
      const cacheDir = join(work, 'cache')
      writePak(cacheDir)
      writeFileSync(
        join(cacheDir, 'data.lock.json'),
        JSON.stringify(fakeLock(sha(PAK), '2'.repeat(64))),
      )
      let downloads = 0

      const result = await ensureEngineData({
        lock: fakeLock(),
        cacheDir,
        download: async (_url, dest) => {
          downloads += 1
          writeFileSync(dest, ARCHIVE_BYTES)
        },
        extract: fakeExtract,
        log: () => {},
      })

      expect(result.cached).toBe(false)
      expect(downloads).toBe(1)
    })
  })

  test("the lock's archive matches the shipped manifest's demo package", () => {
    const read = (path) => JSON.parse(readFileSync(join(REPO_ROOT, path), 'utf8'))
    const manifest = read('content/q2_community_content/gamedata/manifest.json')
    const entry = manifest.packages.find((p) => p.id === 'q2-314-demo-x86')
    const { archive } = read('tests/engine/data.lock.json')

    expect(archive).toMatchObject({
      url: entry.url,
      mirrors: entry.mirrors,
      sizeBytes: entry.sizeBytes,
      sha256: entry.sha256,
    })
  })
})
