import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { FIXTURE_VARIANTS, VARIANTS, writeFixture } from '../fixture.mjs'
import { DOWNLOADS_CACHE_ITEM_COUNT, writeDownloadsCacheArchives } from './downloads.mjs'

const MAX_LINES = 1500
const here = dirname(fileURLToPath(import.meta.url))

describe('fixture layout', () => {
  it('every fixture file stays under 1,500 lines and every variant has a writer', () => {
    const files = [
      join(here, '..', 'fixture.mjs'),
      ...readdirSync(here)
        .filter((f) => f.endsWith('.mjs') && !f.endsWith('.test.mjs'))
        .map((f) => join(here, f)),
    ]
    for (const file of files) {
      expect(readFileSync(file, 'utf8').split('\n').length, file).toBeLessThanOrEqual(MAX_LINES)
    }
    expect(Object.keys(VARIANTS)).toEqual(FIXTURE_VARIANTS)
    for (const writer of Object.values(VARIANTS)) expect(typeof writer).toBe('function')
    expect(() => writeFixture('nope')).toThrow(/unknown fixture variant/)
  })

  it("a reseed over leftover archives leaves exactly the fixture's archives", () => {
    const userData = mkdtempSync(join(tmpdir(), 'q2l-fixture-'))
    try {
      const cacheDir = join(userData, 'cache', 'downloads')
      writeDownloadsCacheArchives(userData)
      writeFileSync(join(cacheDir, 'leftover-from-another-flow.pk3'), 'x')
      writeDownloadsCacheArchives(userData)
      expect(readdirSync(cacheDir)).toHaveLength(DOWNLOADS_CACHE_ITEM_COUNT)
    } finally {
      rmSync(userData, { recursive: true, force: true })
    }
  })
})
